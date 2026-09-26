#!/usr/bin/env node
// Compact each routed armor quad into its own layer so the vertex stage can
// decode it without reconstructing the wearer first. Keep the original first
// layer: vanilla applies equipment foil only to that layer.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {readEncodedGeometryInfo} from './build-bvh.mjs';

const u24=(d,i)=>d[i]*65536+d[i+1]*256+d[i+2];
function put24(d,i,n){if(n<0||n>0xffffff)throw Error('RGB24 overflow');d[i]=n>>>16;d[i+1]=n>>>8;d[i+2]=n;d[i+3]=255;}
function put16(d,i,n){if(n<0||n>65535)throw Error('RGB16 overflow');d[i]=n>>>8;d[i+1]=n;}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  if(e.isSymbolicLink())throw Error('Symbolic links are unsupported');
  const p=path.join(dir,e.name);return e.isDirectory()?files(p):[p];
});}
const routeHeader={2:14,3:8,4:17,5:11},emissionChannel={2:2,3:0,4:3,5:1};

export function compactArmorQuad(png,info,body,face,quad){
  const W=info.width,F=info.frames,textureRow=3;
  const positionRow=textureRow+info.textureHeight*info.textures;
  const positionHeight=Math.ceil(F*4*3/W),uvHeight=Math.ceil(F*4*2/W);
  if(uvHeight>65535)throw Error('Compact UV table exceeds header capacity');
  const uvRow=positionRow+positionHeight,indexRow=uvRow+uvHeight;
  const height=Math.ceil((indexRow+Math.ceil(F*4*2/W))/16)*16;
  const out=new PNG({width:W,height});
  png.data.copy(out.data,0,0,W*2*4);
  png.data.copy(out.data,textureRow*W*4,info.textureRow*W*4,
                (info.textureRow+info.textureHeight*info.textures)*W*4);
  const target=png.data[(8+body)*4+2];
  const boxes=Math.min(Math.max(png.data[8*4+3],1),3);
  const inner=Array.from({length:boxes},(_,b)=>png.data[(8+b)*4+2]).some(p=>p===4||p===5);
  // Counts and row sizes change, while clocks, texture bands and material flags
  // retain their original bytes.
  out.data.set([0,0,0],2*4);out.data[7*4+1]=4;
  put16(out.data,5*4,positionHeight);
  out.data[5*4+2]=uvHeight>>>8;out.data[7*4+2]=uvHeight;
  for(let b=0;b<3;b++){
    for(const h of Object.values(routeHeader))put16(out.data,(h+b)*4,65535);
    out.data.fill(0,(20+b)*4,(21+b)*4);
  }
  out.data[8*4+2]=target;out.data[8*4+3]=1;
  put16(out.data,routeHeader[face]*4,0);
  out.data[20*4+emissionChannel[face]]=png.data[(20+body)*4+emissionChannel[face]];
  out.data.fill(0,23*4,26*4); // Remove any AB1 table pointer from the old layout.
  out.data.set([65,83,49,255],26*4); // AS1
  out.data.set([target,face,Number(inner),255],27*4);
  let checked=0;
  for(let frame=0;frame<F;frame++)for(let corner=0;corner<4;corner++){
    const old=(frame*info.vertices+quad*4+corner)*2;
    const pi=u24(png.data,(info.indexRow*W+old)*4);
    const ui=u24(png.data,(info.indexRow*W+old+1)*4);
    if(pi*3+2>=info.positionHeight*W||ui*2+1>=info.uvHeight*W)throw Error('Source index out of bounds');
    const index=frame*4+corner;
    for(let a=0;a<3;a++){
      const from=(info.positionRow*W+pi*3+a)*4,to=(positionRow*W+index*3+a)*4;
      png.data.copy(out.data,to,from,from+4);checked++;
    }
    for(let a=0;a<2;a++){
      const from=((info.positionRow+info.positionHeight)*W+ui*2+a)*4,to=(uvRow*W+index*2+a)*4;
      png.data.copy(out.data,to,from,from+4);checked++;
    }
    put24(out.data,(indexRow*W+index*2)*4,index);
    put24(out.data,(indexRow*W+index*2+1)*4,index);
  }
  const decoded=readEncodedGeometryInfo(out,253);
  if(decoded.vertices!==4||decoded.frames!==F)throw Error('Invalid compact header');
  return {png:out,target,inner,checked};
}

export function buildArmorVertexPack(source,destination,{preserveFirstLayer=true}={}){
  source=fs.realpathSync(source);
  const requested=path.resolve(destination);
  destination=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
  if(fs.existsSync(destination))throw Error('Destination must be new');
  if(destination.startsWith(source+path.sep))throw Error('Destination cannot be inside source');
  if(!fs.existsSync(path.join(source,'pack.mcmeta')))throw Error('Source must be a resource pack');
  const changes=new Map(),cache=new Map();
  const manifest={format:'objcubed-portable-armor-vertices-v1',source:path.basename(source),
    destination:path.basename(destination),preserveFirstLayer,converted:[],skipped:[],equipment:[]};
  for(const file of files(source).filter(p=>/[/\\]equipment[/\\][^/\\]+\.json$/.test(p))){
    const asset=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!asset.layers)continue;
    let altered=false;
    for(const [kind,layers]of Object.entries(asset.layers)){
      if(!Array.isArray(layers))continue;
      const output=[];
      for(let li=0;li<layers.length;li++){
        const layer=layers[li],id=layer.texture;
        if(typeof id!=='string'||layer.use_player_texture||(preserveFirstLayer&&li===0)){output.push(layer);continue;}
        const [namespace,name]=id.includes(':')?id.split(':',2):['minecraft',id];
        const relative=`assets/${namespace}/textures/entity/equipment/${kind}/${name}.png`;
        const texture=path.join(source,relative);
        if(!fs.existsSync(texture)){output.push(layer);continue;}
        let converted=cache.get(relative);
        if(!converted){
          const png=PNG.sync.read(fs.readFileSync(texture)),info=readEncodedGeometryInfo(png,253);
          if(!info||info.width<28||png.data[26*4]===65&&png.data[26*4+1]===83&&png.data[26*4+2]===49){output.push(layer);continue;}
          converted=[];
          const count=Math.min(Math.max(png.data[8*4+3],1),3);
          for(let body=0;body<count;body++)for(const face of [3,5,2,4]){
            const at=(routeHeader[face]+body)*4,quad=png.data[at]*256+png.data[at+1];
            if(quad===65535)continue;
            if(quad>=info.faces)throw Error('Armor route exceeds source geometry');
            const result=compactArmorQuad(png,info,body,face,quad);
            const newName=`${name}_as1_p${result.target}_f${face}`;
            const outputPath=`assets/${namespace}/textures/entity/equipment/${kind}/${newName}.png`;
            if(fs.existsSync(path.join(source,outputPath))||changes.has(outputPath))throw Error('Compact texture name collision');
            changes.set(outputPath,PNG.sync.write(result.png));
            converted.push(`${namespace}:${newName}`);
            manifest.converted.push({source:relative,texture:outputPath,part:result.target,face,quad,
              oldSize:[png.width,png.height],newSize:[result.png.width,result.png.height],frames:info.frames,
              exactCopiedPositionAndUvTexels:result.checked,innerLayer:result.inner});
          }
          cache.set(relative,converted);
        }
        if(converted.length){for(const id of converted)output.push({...layer,texture:id});altered=true;}
        else output.push(layer);
      }
      if(output.length!==layers.length)manifest.equipment.push({file:path.relative(source,file),kind,oldLayers:layers.length,newLayers:output.length});
      asset.layers[kind]=output;
    }
    if(altered)changes.set(path.relative(source,file),Buffer.from(JSON.stringify(asset,null,2)+'\n'));
  }
  try{
    fs.cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});
    for(const [relative,bytes]of changes){const p=path.join(destination,relative);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);}
    fs.writeFileSync(path.join(destination,'portable-armor-vertices-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  }catch(error){fs.rmSync(destination,{recursive:true,force:true});throw error;}
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [source,destination,...extra]=process.argv.slice(2);
  if(!source||!destination||extra.some(a=>a!=='--split-first'))throw Error('Usage: node tools/portable-renderer/build-armor-vertices.mjs SOURCE_PACK NEW_DESTINATION [--split-first]');
  console.log(JSON.stringify(buildArmorVertexPack(source,destination,{preserveFirstLayer:!extra.includes('--split-first')}),null,2));
}
