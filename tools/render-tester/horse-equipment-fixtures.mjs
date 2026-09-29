// Native horse carrier versus independently transformed source OBJ vertices.
// No decoder/basis reconstruction is used by the reference geometry.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
const require=createRequire(import.meta.url),{loadPlugin}=require('../../test/helpers/load-plugin.cjs'),{makeMemFs}=require('../../test/helpers/mem-fs.cjs');
const out=path.resolve(process.argv[2]??'audit/2026-09-29/horse-equipment-red');fs.mkdirSync(out,{recursive:true});
const probe=JSON.parse(fs.readFileSync('audit/2026-09-29/animal-equipment/probe.json','utf8'));
const source=path.resolve('objcubed');
for(const [ext,stage]of [['vsh','vert'],['fsh','frag']])fs.writeFileSync(path.join(out,'entity.'+stage),expandShader(path.join(source,'assets/minecraft/shaders/core/entity.'+ext),[source,path.resolve('audit/2026-09-28/vanilla')]).replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n'));
function floats(file,values){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));fs.writeFileSync(file,b);}
const image={width:32,height:32,data:Buffer.alloc(32*32*4)};
for(let y=0;y<32;y++)for(let x=0;x<32;x++)image.data.set([x<16?220:80,y<16?60:190,110,255],(y*32+x)*4);
function load(){const memfs=makeMemFs();class Image{set src(s){queueMicrotask(()=>this.onload?.());}get naturalWidth(){return 32;}get naturalHeight(){return 32;}}
 const api=loadPlugin(path.resolve('objcubed.js'),{requireImpl:id=>id==='fs'?memfs:id==='path'?{...path,...path.posix}:require(id),globals:{Buffer,Image,setTimeout,process,console:{log(){},warn(){},error:console.error},document:{createElement(){return{getContext(){return{drawImage(){},getImageData(){return image;}};}};}},Texture:{all:[{uuid:'t0',name:'pattern',source:'data:0',img:{src:'data:0'},uv_height:32,uv_width:32,frameCount:1}]},Outliner:{root:[]},Blockbench:{export(){throw Error('Unexpected dialog');},pickDirectory(){return '/rp';}},Project:{name:'horse',export_path:''},BarItems:{}}});return{api,memfs};}
const quads=[];for(let face=0;face<6;face++){let x=(face%3)*.42-.62,y=Math.floor(face/3)*.42+.02;quads.push([[x,y,0],[x+.36,y,0],[x+.36,y+.36,0],[x,y+.36,0]]);}
const uv=[[0,0],[1,0],[1,1],[0,1]],lines=[];for(let f=0;f<quads.length;f++){lines.push('o ocp1e0i'+f);for(const p of quads[f])lines.push('v '+p.join(' '));for(const v of uv)lines.push('vt '+v.join(' '));lines.push('f '+[0,1,2,3].map(k=>(f*4+k+1)+'/'+(f*4+k+1)).join(' '));}
const cases=[];
for(const kind of ['horse_body','horse_saddle']){const{api,memfs}=load(),cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['time','time','time'],duration:4,autoplay:false,easing:0,interpolation:0,noshadow:true,autorotate:0,visibility:7,displaySlots:{},flipuv:false,useAtlas:false,texAnimEnabled:false,resourcePackDir:'/rp',baseItem:'stick',generateDatapack:false,cmdName:'horse',exportAsEquipment:true,equipmentTarget:kind,selectedPieces:[]};
 const exp=await api.buildOutput(cfg,[lines.join('\n')],'');await api.saveSingleOutput(exp,api.buildDisplayTransforms(cfg),cfg);
 const textures=[...memfs.writes].filter(([name])=>name.includes('/equipment/'+kind+'/')&&name.endsWith('.png'));if(textures.length!==1)throw Error('Expected real horse export layer, got '+textures.length);
 const texture=PNG.sync.read(Buffer.from(textures[0][1])),dir=path.join(out,kind);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'texture.rgba'),texture.data);fs.writeFileSync(path.join(dir,'texture.png'),Buffer.from(textures[0][1]));fs.writeFileSync(path.join(dir,'reference.rgba'),image.data);
 const parts=probe.models[kind],root=parts.find(p=>p.path==='root'),body=parts.find(p=>p.path==='root/body');
 const transform=p=>p.map((v,k)=>(v+body.position[k]/16)*root.scale[k]+root.position[k]/16);
 const carrier=[];for(const f of body.cubes[0].faces)for(const v of f.vertices_xyz_uv64)carrier.push(...transform(v.slice(0,3).map(x=>x/16)),v[3]/64,v[4]/64,...f.normal);
 const reference=[];for(const q of quads)for(let i=0;i<4;i++)reference.push(...transform([q[i][0],-q[i][1],q[i][2]]),uv[i][0],1-uv[i][1],0,0,1);
 floats(path.join(dir,'carrier.f32'),carrier);floats(path.join(dir,'reference.f32'),reference);
 cases.push({id:kind,directory:dir,width:texture.width,height:texture.height,carrierCount:carrier.length/8,referenceCount:reference.length/8});
}
fs.writeFileSync(path.join(out,'cases.tsv'),cases.map(c=>[c.id,c.directory,c.width,c.height,c.carrierCount,c.referenceCount].join('\t')).join('\n'));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),pluginSHA256:crypto.createHash('sha256').update(fs.readFileSync('objcubed.js')).digest('hex'),method:'Real buildOutput/saveSingleOutput horse export; actual baked 26.3 body carrier polygons; independent source-OBJ reference transformed by body pivot and baked root scale. Preliminary rest-pose contract test.',cases},null,2));console.log('Prepared '+cases.length+' horse cases');
