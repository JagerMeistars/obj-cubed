#!/usr/bin/env node
// Append conservative all-frame bounds to exported marker-253 equipment PNGs.
// No armor faces, transparency, animation, or equipment layers are removed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {readEncodedGeometryInfo,decodePositions,faceBounds} from './build-bvh.mjs';
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Symbolic links are unsupported');return e.isDirectory()?files(p):[p];
});}
function put24(data,offset,value){
  if(!Number.isInteger(value)||value<0||value>0xffffff)throw Error('RGB24 overflow');
  data[offset]=value>>>16;data[offset+1]=value>>>8;data[offset+2]=value;data[offset+3]=255;
}
function get24(data,offset){return data[offset]*65536+data[offset+1]*256+data[offset+2];}
export function buildArmorBoundsPack(source,destination){
  source=path.resolve(source);destination=path.resolve(destination);
  if(!fs.existsSync(path.join(source,'pack.mcmeta')))throw Error('Source must be a resource pack');
  if(fs.existsSync(destination))throw Error('Destination must not exist');
  if(destination.startsWith(source+path.sep))throw Error('Destination cannot be inside source');
  const manifest={format:'objcubed-portable-armor-bounds-v1',source:path.basename(source),destination:path.basename(destination),converted:[],skipped:[]},changes=[];
  for(const file of files(source).filter(p=>p.endsWith('.png'))){
    const relative=path.relative(source,file),png=PNG.sync.read(fs.readFileSync(file));
    const info=readEncodedGeometryInfo(png,253);if(!info)continue;
    if(info.width<26){manifest.skipped.push({file:relative,reason:'texture too narrow for armor bounds header'});continue;}
    if(png.data[23*4]===65&&png.data[23*4+1]===66&&png.data[23*4+2]===49){manifest.skipped.push({file:relative,reason:'armor bounds already present'});continue;}
    const positions=decodePositions(png,info),bounds=faceBounds(positions,info);
    const boundsRow=png.height,newHeight=Math.ceil((png.height+Math.ceil(info.faces*6/png.width))/16)*16;
    const out=new PNG({width:png.width,height:newHeight});png.data.copy(out.data);
    out.data.set([65,66,49,255],23*4);put24(out.data,24*4,boundsRow);put24(out.data,25*4,info.faces);
    for(let face=0;face<info.faces;face++)for(let a=0;a<6;a++) {
      const value=a<3?bounds[face].min[a]:bounds[face].max[a-3];
      put24(out.data,(boundsRow*png.width+face*6+a)*4,Math.round((value+256)*32768));
    }
    const bytes=PNG.sync.write(out),decoded=PNG.sync.read(bytes);
    let checked=0;
    for(let frame=0;frame<info.frames;frame++)for(let vertex=0;vertex<info.vertices;vertex++)for(let a=0;a<3;a++) {
      const face=vertex>>2,base=(boundsRow*png.width+face*6)*4;
      const lo=get24(decoded.data,base+a*4)/32768-256,hi=get24(decoded.data,base+(a+3)*4)/32768-256;
      const p=positions[(frame*info.vertices+vertex)*3+a];if(p<lo||p>hi)throw Error('Decoded frame escaped armor bounds');checked++;
    }
    for(let i=0;i<png.data.length;i++)if((i<23*4||i>=26*4)&&png.data[i]!==decoded.data[i])throw Error('Original armor texel changed');
    changes.push([relative,bytes]);manifest.converted.push({file:relative,width:png.width,oldHeight:png.height,newHeight,
      boundsRow,faces:info.faces,frames:info.frames,tableBytes:info.faces*6*4,addedRgbaBytes:(newHeight-png.height)*png.width*4,
      checkedFrameCoordinates:checked,allFrameAndCatmullBounds:true,originalPixelsPreservedExceptHeader23to25:true});
  }
  fs.cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});
  for(const[file,data]of changes)fs.writeFileSync(path.join(destination,file),data);
  fs.writeFileSync(path.join(destination,'portable-armor-bounds-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [source,dest,...extra]=process.argv.slice(2);if(!source||!dest||extra.length)throw Error('Usage: node tools/portable-renderer/build-armor-bounds.mjs SOURCE_PACK NEW_DESTINATION');
  console.log(JSON.stringify(buildArmorBoundsPack(source,dest),null,2));
}
