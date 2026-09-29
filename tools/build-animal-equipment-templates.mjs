// Native assembled Blockbench templates. CPU-only, no editor/profile changes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist'));
const carriers = JSON.parse(fs.readFileSync(path.join(root, 'tools/equipment-carriers.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(root, 'tools/equipment-template-models.json'), 'utf8'));
const version = '0.9.3';
const names = {
  horse_body: ['Конская броня','leather_horse_armor'],
  horse_saddle: ['Седло лошади','saddle'], donkey_saddle: ['Седло осла','saddle'],
  mule_saddle: ['Седло мула','saddle'], zombie_horse_saddle: ['Седло лошади-зомби','saddle'],
  skeleton_horse_saddle: ['Седло лошади-скелета','saddle'],
  wolf_body: ['Волчья броня','wolf_armor'], llama_body: ['Попона ламы','white_carpet'],
  happy_ghast_body: ['Упряжь счастливого гаста','white_harness'], wings: ['Элитры','elytra'],
  camel_saddle: ['Седло верблюда','saddle'], camel_husk_saddle: ['Седло верблюда-кадавра','saddle'],
  pig_saddle: ['Седло свиньи','saddle'], strider_saddle: ['Седло лавомерки','saddle'],
  nautilus_body: ['Броня наутилуса','iron_nautilus_armor'], nautilus_saddle: ['Седло наутилуса','saddle'],
};
const partNames = {
  left_ear: 'Левое ухо', right_ear: 'Правое ухо', reins: 'Поводья — с наездником', body: 'Корпус', head: 'Голова', legs: 'Одна нога → повтор на четырёх', tail: 'Хвост',
  upper_body: 'Грудь', harness: 'Упряжь', goggles: 'Очки', wings: 'Одно крыло → зеркальная пара',
  right_front_leg: 'Правая передняя нога', left_front_leg: 'Левая передняя нога',
  right_hind_leg: 'Правая задняя нога', left_hind_leg: 'Левая задняя нога',
  right_leg: 'Правая нога', left_leg: 'Левая нога', shell: 'Раковина',
};
const palette = [[111,181,192],[234,175,96],[150,185,123],[185,145,197],[223,139,138],[135,170,218]];
const round = x => +x.toFixed(8);
const id = value => {
  const bytes = crypto.createHash('sha256').update('objcubed-assembled-template-v2:' + value).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex');
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
};

// S*M*S, where S flips native ModelPart +Y down to Blockbench +Y up.
function frame(part) {
  const m = part.modelMatrixColumnMajor, s = [1,-1,1];
  const basis = [];
  for (let col=0; col<3; col++) for (let row=0; row<3; row++)
    basis.push(m[col*4+row]*s[row]*s[col]);
  const scales = [0,3,6].map(i => Math.hypot(...basis.slice(i,i+3)));
  if (scales.some(s=>s<=0))throw Error('Invalid native scale: ' + part.path);
  const r = basis.map((v,i)=>v/scales[Math.floor(i/3)]);
  const sheared=[[0,3],[0,6],[3,6]].some(([a,b])=>
    Math.abs(r[a]*r[b]+r[a+1]*r[b+1]+r[a+2]*r[b+2])>1e-5);
  return {
    basis: basis.map(round), scales, sheared,
    origin: [m[12]*16,24-m[13]*16,m[14]*16].map(round),
    rotation: rotationOf(r),
  };
}
function rotationOf(r) {
  // Blockbench Group/Cube use THREE Euler ZYX, not the default XYZ order.
  const ry = Math.asin(Math.max(-1,Math.min(1,-r[2])));
  const rx = Math.abs(r[2])<.9999999 ? Math.atan2(r[5],r[8]) : 0;
  const rz = Math.abs(r[2])<.9999999 ? Math.atan2(r[1],r[0]) : Math.atan2(-r[3],r[4]);
  return [rx,ry,rz].map(v=>round(v*180/Math.PI));
}
const faceIndices = {
  north:[1,4,6,3], east:[0,1,3,2], south:[5,0,2,7],
  west:[4,5,7,6], up:[4,1,0,5], down:[7,2,3,6],
};
function cubeGeometry(cube) {
  // ModelPart.Cube.bounds omit inflation; polygon vertices are authoritative.
  const points = cube.faces.flatMap(f=>f.verticesLocalPixelsUVPixels.map(p=>[p[0],-p[1],p[2]]));
  const from = [0,1,2].map(i=>Math.min(...points.map(p=>p[i])));
  const to = [0,1,2].map(i=>Math.max(...points.map(p=>p[i])));
  const [x0,y0,z0]=from, [x1,y1,z1]=to;
  const vertices = [[x1,y1,z1],[x1,y1,z0],[x1,y0,z1],[x1,y0,z0],
    [x0,y1,z0],[x0,y1,z1],[x0,y0,z0],[x0,y0,z1]];
  const faces = {};
  for (const f of cube.faces) {
    const n=[f.normalLocal[0],-f.normalLocal[1],f.normalLocal[2]];
    const side = n[0]>.5?'east':n[0]<-.5?'west':n[1]>.5?'up':n[1]<-.5?'down':n[2]>.5?'south':'north';
    const wanted = faceIndices[side].map(index=>{
      const at=vertices[index];
      const v=f.verticesLocalPixelsUVPixels.find(p=>Math.hypot(p[0]-at[0],-p[1]-at[1],p[2]-at[2])<1e-5);
      if(!v)throw Error('Native face/cube corner mismatch: '+side);
      return v.slice(3,5);
    });
    const u0=Math.min(...wanted.map(p=>p[0])),u1=Math.max(...wanted.map(p=>p[0]));
    const v0=Math.min(...wanted.map(p=>p[1])),v1=Math.max(...wanted.map(p=>p[1]));
    let match;
    for(const flipU of [false,true]) for(const flipV of [false,true]) {
      const uv=[flipU?u1:u0,flipV?v1:v0,flipU?u0:u1,flipV?v0:v1];
      const corners=[[uv[0],uv[1]],[uv[2],uv[1]],[uv[2],uv[3]],[uv[0],uv[3]]];
      for(let rotation=0;rotation<360;rotation+=90) {
        if(corners.every((p,i)=>p.every((v,k)=>Math.abs(v-wanted[i][k])<1e-5))) {
          match={uv:uv.map(round),rotation}; break;
        }
        corners.unshift(corners.pop());
      }
      if(match)break;
    }
    if(!match)throw Error('Native UV cannot map to Blockbench cube: '+side);
    faces[side]=match;
  }
  return {from,to,faces};
}
function texture(width,height,guide,paintedFaces) {
  const png = new PNG({width,height});
  const rectangles = paintedFaces.flatMap(({faces,color})=>Object.values(faces).map(({uv})=>({uv,color})));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    let color=guide?[102,112,126]:[185,192,198];
    if(!guide) for(const rect of rectangles) {
      const [u,v,U,V]=rect.uv;
      if(x>=Math.min(u,U)&&x<Math.max(u,U)&&y>=Math.min(v,V)&&y<Math.max(v,V)) color=rect.color;
    }
    const shade=((x>>2)+(y>>2))%2?8:-8, at=(y*width+x)*4;
    for(let channel=0;channel<3;channel++)png.data[at+channel]=Math.min(255,Math.max(0,color[channel]+shade));
    png.data[at+3]=255;
  }
  return 'data:image/png;base64,'+PNG.sync.write(png).toString('base64');
}
function referenceMesh(cube,part,uuid,index) {
  const m=part.modelMatrixColumnMajor,vertices={},faces={},keys=new Map();
  for(const [faceIndex,face] of cube.faces.entries()) {
    const order=[],uv={};
    for(const p of [...face.verticesLocalPixelsUVPixels].reverse()) {
      const point=[0,1,2].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]*16);
      const bb=[point[0],24-point[1],point[2]].map(round),key=bb.join(',');
      if(!keys.has(key)){const name='v'+keys.size;keys.set(key,name);vertices[name]=bb;}
      const name=keys.get(key);order.push(name);uv[name]=p.slice(3,5);
    }
    faces['f'+faceIndex]={vertices:order,uv,texture:1};
  }
  return {uuid,type:'mesh',name:'Ориентир · '+part.path.split('/').at(-1)+' '+(index+1),
    origin:[0,0,0],rotation:[0,0,0],vertices,faces,
    export:false,locked:true,visibility:part.effectivelyVisible,color:7};
}
function compileTemplate(target) {
  const model=source.models[target], catalog=carriers[target];
  if(!model||!names[target])throw Error('Missing template source: '+target);
  const bindings=Object.entries(catalog.bindings);
  const elements=[],groups=[],outliner=[],guideChildren=[],paintedFaces=[];
  const equipmentPartTags={},equipmentRestTransforms={},nativePartMap={},nativeCubeMap={};
  const editGroups=new Map();
  for(const [index,[key,info]] of bindings.entries()) {
    const f=frame(model.parts.find(p=>p.path===info.path)),uuid=id(target+'/'+info.path);
    if(f.sheared||Math.max(...f.scales)-Math.min(...f.scales)>1e-5)
      throw Error('Unsupported nonuniform attachment scale: '+target+'/'+info.path);
    const group={uuid,name:partNames[key]+' · '+key,origin:f.origin,rotation:f.rotation,
      color:index%palette.length,export:true,locked:false,visibility:true,isOpen:true,
      children:[],reset:false,shade:true,mirror_uv:false,autouv:0,
      objcubed_equipment_part:key,objcubed_equipment_rest:{target,part:key,basis:f.basis}};
    groups.push(group);editGroups.set(key,{key,index,group,frame:f});
    equipmentPartTags[uuid]=key;equipmentRestTransforms[uuid]=group.objcubed_equipment_rest;
    nativePartMap[uuid]=info.path;
  }
  for(const part of model.parts) {
    if(!part.cubes.length)continue;
    const binding=editGroups.get(model.partBindings[part.path]),editable=!!binding,f=frame(part);
    if(editable&&f.sheared)throw Error('Sheared editable native part: '+target+'/'+part.path);
    const group=editable?binding.group:{
      uuid:id(target+'/'+part.path),name:part.path.replace(/^root\//,''),
      origin:f.sheared?[0,0,0]:f.origin,rotation:f.sheared?[0,0,0]:f.rotation,color:7,
      export:false,locked:true,visibility:part.effectivelyVisible,isOpen:false,children:[],
    };
    const children=group.children;
    let cubeOrigin=f.origin,cubeRotation=[0,0,0];
    if(editable) {
      // A rigid child (saddle pad, ear, bridle) shares its attachment group.
      // Express its pivot/axes before the attachment's displayed rest rotation.
      const parent=binding.frame;
      const a=parent.basis.map((v,i)=>v/parent.scales[Math.floor(i/3)]);
      const b=f.basis.map((v,i)=>v/f.scales[Math.floor(i/3)]);
      const delta=f.origin.map((v,k)=>v-parent.origin[k]);
      cubeOrigin=parent.origin.map((v,row)=>round(v+a[3*row]*delta[0]+a[3*row+1]*delta[1]+a[3*row+2]*delta[2]));
      const relative=[];
      for(let col=0;col<3;col++)for(let row=0;row<3;row++)
        relative.push(a[3*row]*b[3*col]+a[3*row+1]*b[3*col+1]+a[3*row+2]*b[3*col+2]);
      cubeRotation=rotationOf(relative);
    } else {
      groups.push(group);nativePartMap[group.uuid]=part.path;
    }
    for(const [index,cube] of part.cubes.entries()) {
      const elementUuid=id(target+'/'+part.path+'/cube'+index);
      nativeCubeMap[elementUuid]={path:part.path,index};
      if(f.sheared) {
        elements.push(referenceMesh(cube,part,elementUuid,index));children.push(elementUuid);continue;
      }
      const geometry=cubeGeometry(cube);
      const faces=Object.fromEntries(Object.entries(geometry.faces).map(([side,value])=>
        [side,{...value,texture:editable?(value.uv[0]===value.uv[2]||value.uv[1]===value.uv[3]?null:0):1,tint:-1}]));
      const element={
        uuid:elementUuid,type:'cube',name:(editable?'Модель':'Ориентир')+' · '+part.path.split('/').at(-1)+' '+(index+1),
        from:geometry.from.map((v,k)=>round(cubeOrigin[k]+v*f.scales[k])),
        to:geometry.to.map((v,k)=>round(cubeOrigin[k]+v*f.scales[k])),
        origin:cubeOrigin,rotation:cubeRotation,faces,box_uv:false,shade:true,inflate:0,
        export:editable,locked:!editable,visibility:editable||part.effectivelyVisible,
        color:editable?binding.index%palette.length:7,autouv:0,render_order:'default',light_emission:0,
      };
      elements.push(element);children.push(elementUuid);
      if(editable)paintedFaces.push({faces:geometry.faces,color:palette[binding.index%palette.length]});
    }
    if(!editable)guideChildren.push({uuid:group.uuid,isOpen:false,children:[...children]});
  }
  for(const {group} of editGroups.values())
    outliner.push({uuid:group.uuid,isOpen:true,children:[...group.children]});
  // Native duplicates/unsupported parts provide context but never export.
  const guideUuid=id(target+'/reference');
  groups.push({uuid:guideUuid,name:'ОРИЕНТИРЫ · не экспортируются',origin:[0,0,0],rotation:[0,0,0],
    export:false,locked:true,visibility:true,isOpen:false,children:guideChildren.map(g=>g.uuid)});
  outliner.push({uuid:guideUuid,isOpen:false,children:guideChildren});
  const [width,height]=model.textureSize;
  return {
    meta:{format_version:'5.0',model_format:'free',box_uv:false},
    name:'objcubed_'+target,model_identifier:'',resolution:{width,height},
    visible_box:[4,4,0],variable_placeholders:'',elements,groups,outliner,animations:[],
    textures:[false,true].map(guide=>({
      name:guide?'reference.png':target+'.png',path:'',relative_path:'',id:guide?'1':'0',
      width,height,uv_width:width,uv_height:height,use_as_default:!guide,
      render_mode:'default',render_sides:'auto',visible:true,internal:false,saved:true,
      uuid:id(target+(guide?'/reference-texture':'/model-texture')),
      source:texture(width,height,guide,paintedFaces),
    })),
    objcubed:{
      version:1,settings:{exportAsEquipment:true,equipmentTarget:target,baseItem:names[target][1],
        cmdName:'custom_'+target,scale:1},
      equipmentPartTags,equipmentRestTransforms,
      template:{version:2,target,title:names[target][0],nativePose:'rest',minimumPluginVersion:version,
        nativePartMap,nativeCubeMap,sourceClientSha256:source.source.clientJarSha256},
    },
  };
}
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);crcTable[n]=c>>>0;}
function crc32(data){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zip(files) {
  const local=[],central=[];let offset=0;
  for(const file of [...files].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
    const name=Buffer.from(file.name),data=file.bytes,compressed=zlib.deflateRawSync(data,{level:9}),crc=crc32(data);
    const a=Buffer.alloc(30),b=Buffer.alloc(46);
    a.writeUInt32LE(0x04034b50);a.writeUInt16LE(20,4);a.writeUInt16LE(0x800,6);a.writeUInt16LE(8,8);a.writeUInt16LE(33,12);a.writeUInt32LE(crc,14);a.writeUInt32LE(compressed.length,18);a.writeUInt32LE(data.length,22);a.writeUInt16LE(name.length,26);
    b.writeUInt32LE(0x02014b50);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt16LE(0x800,8);b.writeUInt16LE(8,10);b.writeUInt16LE(33,14);b.writeUInt32LE(crc,16);b.writeUInt32LE(compressed.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(name.length,28);b.writeUInt32LE(offset,42);
    local.push(a,name,compressed);central.push(b,name);offset+=a.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
const readme=[
  '# Шаблоны objcubed — собранные модели',
  '',
  '16 нативных моделей экипировки Minecraft 26.3 в формате Blockbench 5.0. Требуется objcubed '+version+' или новее.',
  '',
  '## Как начать',
  '',
  '1. Установите новую версию objcubed.js, затем откройте нужный .bbmodel.',
  '2. Модель уже собрана в естественной позе. Цветные части редактируются и экспортируются. Серые части в папке «ОРИЕНТИРЫ» показывают остальные нативные детали, заблокированы и исключены из экспорта.',
  '3. Меняйте форму цветных кубов, добавляйте кубы и меши в нужную помеченную группу. Не обнуляйте её исходный поворот перед экспортом: например, корпус волка уже имеет −90° по X, и этот поворот должен оставаться.',
  '4. Origin и исходные оси групп уже настроены. Положение модели в редакторе соответствует показанной исходной позе. Экспортёр переводит её в координаты нативных частей автоматически.',
  '5. Тип экипировки и базовый предмет заполнены. Задайте своё имя CustomModelData, экспортируйте, возьмите команду из _give.txt.',
  '',
  'Исходная ориентация хранится отдельно от редактируемого поворота. Поэтому дополнительный поворот автора не исчезает при экспорте. Если изменить сам Origin, изменится и точка крепления.',
  '',
  '## Ноги, крылья и ориентиры',
  '',
  'У лошади, волка, ламы и свиньи цветная одна нога повторяется на четырёх ногах в игре. Остальные серые ноги — ориентиры: они не являются дополнительными экспортируемыми деталями и не обновляются автоматически при редактировании цветной ноги.',
  'У элитр редактируется одно цветное крыло, второе показано серым; игра создаёт зеркальную пару. У верблюда и лавомерки каждая нога редактируется отдельно.',
  'У обоих верблюдов уши редактируются в отдельных цветных группах «Левое ухо · left_ear» и «Правое ухо · right_ear»: каждая следует за своим ухом, включая движение относительно головы. Накладки добавляйте внутрь соответствующей группы. Уши видны и без наездника.',
  'У обоих верблюдов группа «Поводья — с наездником · reins» видна в редакторе для моделирования, а в игре появляется только при наличии наездника. Уздечка в группе головы остаётся видимой без наездника. Повороты и видимость перед экспортом менять не нужно. Для поводьев доступны две грани на слой; пустые грани плоских кубов исключены.',
  'В неэкспортируемой папке могут быть части, для которых привязка пока не поддержана. Добавляйте новую геометрию внутрь цветных групп, а не в папку ориентиров. Не включайте экспорт ориентиров.',
  '',
  '## Текстуры и совместимость',
  '',
  'Кубы, масштаб, шарниры и UV взяты из нативных моделей Minecraft 26.3, включая увеличение оболочки (inflate) и зеркальные грани. Встроенные клетчатые текстуры созданы для шаблонов; это не оригинальные текстуры Minecraft.',
  'Поза является неподвижным образцом стоящего моба, а не симуляцией его поведения. Игра добавляет движение частей. Для новых шаблонов нужен обновлённый плагин; прежние проекты без сохранённых осей продолжают экспортироваться по старым правилам.',
  'Подробности и ограничения повторяемых привязок — в ANIMAL_EQUIPMENT_RU.md.',
  '',
  '## Файлы',
  '',
  ...Object.keys(carriers).map(target=>'- '+target+'.bbmodel — '+names[target][0]),
  '',
].join('\n');
fs.mkdirSync(output,{recursive:true});
const directory=path.join(root,'templates/animal-equipment');
fs.mkdirSync(directory,{recursive:true});
const files=[];
let editableCubes=0,referenceElements=0;
for(const target of Object.keys(carriers)) {
  const doc=compileTemplate(target),name=target+'.bbmodel',bytes=Buffer.from(JSON.stringify(doc,null,2)+'\n');
  fs.writeFileSync(path.join(directory,name),bytes);files.push({name,bytes});
  editableCubes+=doc.elements.filter(e=>e.export).length;
  referenceElements+=doc.elements.filter(e=>!e.export).length;
}
fs.writeFileSync(path.join(directory,'README-RU.md'),readme);
files.push({name:'README-RU.md',bytes:Buffer.from(readme)});
files.push({name:'ANIMAL_EQUIPMENT_RU.md',bytes:fs.readFileSync(path.join(root,'docs/ANIMAL_EQUIPMENT_RU.md'))});
const archive=zip(files),archivePath=path.join(output,'objcubed-blockbench-templates.zip');
fs.writeFileSync(archivePath,archive);
const manifest={version,templateVersion:2,blockbenchFormat:'5.0',minecraft:'26.3',
  targets:Object.keys(carriers).length,bindings:Object.values(carriers).reduce((n,t)=>n+Object.keys(t.bindings).length,0),
  editableCubes,referenceElements,archive:archivePath,bytes:archive.length,
  sha256:crypto.createHash('sha256').update(archive).digest('hex'),sourceFiles:files.map(file=>file.name)};
fs.writeFileSync(path.join(output,'objcubed-blockbench-templates.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
