#!/usr/bin/env node
// Group compatible opaque AS1 quads into one AS2 BVH carrier per material/part.
// The first equipment layer and every unsupported texture remain unchanged.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {readEncodedGeometryInfo,decodePositions,faceBounds,buildNodes,buildSegmentBounds} from './build-bvh.mjs';
const INTERNAL=0xffffff;
const u24=(d,i)=>d[i]*65536+d[i+1]*256+d[i+2];
const digest=d=>createHash('sha256').update(d).digest('hex');
function put24(d,i,n){if(!Number.isInteger(n)||n<0||n>INTERNAL)throw Error(`RGB24 overflow: ${n}`);d[i]=n>>>16;d[i+1]=n>>>8;d[i+2]=n;d[i+3]=255;}
function put16(d,i,n){if(!Number.isInteger(n)||n<0||n>65535)throw Error(`16-bit overflow: ${n}`);d[i]=n>>>8;d[i+1]=n;}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{if(e.isSymbolicLink())throw Error('Symbolic links are unsupported');const p=path.join(dir,e.name);return e.isDirectory()?files(p):[p];});}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
function texturePath(id,kind){const [namespace,name]=id.includes(':')?id.split(':',2):['minecraft',id];if(!/^[a-z0-9_.-]+$/.test(namespace)||!/^[-a-z0-9_./]+$/.test(name)||name.split('/').includes('..'))throw Error(`Invalid resource name: ${id}`);return {namespace,name,relative:`assets/${namespace}/textures/entity/equipment/${kind}/${name}.png`};}
function sourceGeometry(png,info){
 const p=Buffer.alloc(info.frames*4*3*4),uv=Buffer.alloc(info.frames*4*2*4);
 for(let v=0;v<info.frames*4;v++){
  const pi=u24(png.data,(info.indexRow*info.width+v*2)*4),ui=u24(png.data,(info.indexRow*info.width+v*2+1)*4);
  if(pi*3+2>=info.positionHeight*info.width||ui*2+1>=info.uvHeight*info.width)throw Error('AS1 source index out of bounds');
  for(let a=0;a<3;a++)png.data.copy(p,(v*3+a)*4,(info.positionRow*info.width+pi*3+a)*4,(info.positionRow*info.width+pi*3+a+1)*4);
  for(let a=0;a<2;a++)png.data.copy(uv,(v*2+a)*4,((info.positionRow+info.positionHeight)*info.width+ui*2+a)*4,((info.positionRow+info.positionHeight)*info.width+ui*2+a+1)*4);
 }
 return {position:p,uv};
}
function geometryKey(geometry,frames){
 let best=null,bestUv=null;
 for(const reverse of [false,true])for(let offset=0;offset<4;offset++){
  const p=Buffer.alloc(geometry.position.length),uv=Buffer.alloc(geometry.uv.length);
  for(let f=0;f<frames;f++)for(let c=0;c<4;c++){
   const source=(offset+(reverse?4-c:c))%4;
   geometry.position.copy(p,(f*4+c)*12,(f*4+source)*12,(f*4+source+1)*12);
   geometry.uv.copy(uv,(f*4+c)*8,(f*4+source)*8,(f*4+source+1)*8);
  }
  if(best===null||Buffer.compare(p,best)<0){best=p;bestUv=uv;}
 }
 return [digest(best),digest(bestUv)];
}
function prepare(png,layer){
 if(png.width<32||!png.data.subarray(0,4).equals(Buffer.from([12,34,56,253]))||!png.data.subarray(26*4,26*4+3).equals(Buffer.from([65,83,49])))return null;
 const info=readEncodedGeometryInfo(png,253),target=png.data[27*4],face=png.data[27*4+1],inner=png.data[27*4+2];
 if(info.vertices!==4||target>7||face<2||face>5||inner>1)return null;
 const colors=png.data.subarray(info.textureRow*info.width*4,(info.textureRow+info.textureHeight*info.textures)*info.width*4);
 for(let i=3;i<colors.length;i+=4)if(colors[i]!==255)return {reason:'translucent color texel'};
 const emission=png.data[20*4+({2:2,3:0,4:3,5:1}[face])];
 const header=Buffer.from(png.data.subarray(0,info.width*2*4));
 // Normalize storage layout and routing only; clocks, shadow/material/control
 // bits, texture animation bands and every other header byte remain in the key.
 for(const i of [8,9,10,29,20,21,22,30])header[i]=0;
 header.fill(0,8*4,32*4);
 const properties={...layer};delete properties.texture;
 const key=digest(Buffer.concat([header,colors,Buffer.from(JSON.stringify(stable({target,inner,emission,properties})))]));
 return {png,info,target,face,inner,emission,key,geometry:sourceGeometry(png,info)};
}
function merge(group,{segmentBounds}){
 const first=group[0],{info}=first,W=info.width,F=info.frames,N=group.length,V=N*4;
 const textureRow=2+Math.ceil(N/W),positionRow=textureRow+info.textureHeight*info.textures;
 const positionHeight=Math.ceil(V*F*3/W),uvHeight=Math.ceil(V*F*2/W),uvRow=positionRow+positionHeight,indexRow=uvRow+uvHeight;
 if(positionHeight>65535||uvHeight>65535)throw Error('AS2 geometry table exceeds header capacity');
 const sourceEnd=indexRow+Math.ceil(V*F*2/W);
 const base=new PNG({width:W,height:sourceEnd});first.png.data.copy(base.data,0,0,W*2*4);
 first.png.data.copy(base.data,textureRow*W*4,info.textureRow*W*4,(info.textureRow+info.textureHeight*info.textures)*W*4);
 base.data[8]=V>>>24;base.data[9]=V>>>16;base.data[10]=V>>>8;base.data[29]=V;
 put16(base.data,20,positionHeight);base.data[22]=uvHeight>>>8;base.data[30]=uvHeight;
 for(let b=0;b<3;b++)for(const h of [8,11,14,17])put16(base.data,(h+b)*4,65535);
 base.data[8*4+2]=first.target;base.data[8*4+3]=1;put16(base.data,8*4,0);
 base.data.fill(0,20*4,32*4);base.data[20*4]=first.emission;
 base.data.set([65,83,50,255],26*4);base.data.set([first.target,3,first.inner,255],27*4);
 let copied=0;
 for(let f=0;f<F;f++)for(let face=0;face<N;face++)for(let c=0;c<4;c++){
  const old=f*4+c,v=f*V+face*4+c,g=group[face].geometry;
  for(let a=0;a<3;a++){g.position.copy(base.data,(positionRow*W+v*3+a)*4,(old*3+a)*4,(old*3+a+1)*4);copied++;}
  for(let a=0;a<2;a++){g.uv.copy(base.data,(uvRow*W+v*2+a)*4,(old*2+a)*4,(old*2+a+1)*4);copied++;}
  put24(base.data,(indexRow*W+v*2)*4,v);put24(base.data,(indexRow*W+v*2+1)*4,v);
 }
 const resultInfo=readEncodedGeometryInfo(base,253),positions=decodePositions(base,resultInfo);
 // Verify the complete reindexed geometry/UV streams, including all four bytes
 // of each source texel, before adding acceleration data.
 let checked=0;
 for(let f=0;f<F;f++)for(let face=0;face<N;face++)for(let c=0;c<4;c++){
  const old=f*4+c,v=f*V+face*4+c,g=group[face].geometry;
  for(const [data,row,arity]of[[g.position,positionRow,3],[g.uv,uvRow,2]])for(let a=0;a<arity;a++){
   if(!base.data.subarray((row*W+v*arity+a)*4,(row*W+v*arity+a+1)*4).equals(data.subarray((old*arity+a)*4,(old*arity+a+1)*4)))throw Error('AS2 byte preservation failed');checked++;
  }
 }
 const {nodes,depth}=buildNodes(faceBounds(positions,resultInfo));
 const segments=segmentBounds&&F>1?buildSegmentBounds(positions,resultInfo,nodes):null;
 const treeRow=sourceEnd,segmentRow=treeRow+Math.ceil(nodes.length*8/W),height=Math.ceil((segmentRow+(segments?Math.ceil(segments.length/4/W):0))/16)*16;
 const out=new PNG({width:W,height});base.data.copy(out.data);
 put24(out.data,28*4,treeRow);put24(out.data,29*4,nodes.length);put24(out.data,30*4,segments?segmentRow:0);out.data.set([65,66,50,255],31*4);
 for(let i=0;i<nodes.length;i++){
  const n=nodes[i],at=(treeRow*W+i*8)*4;
  for(let a=0;a<3;a++){put24(out.data,at+a*4,Math.round((n.min[a]+256)*32768));put24(out.data,at+(a+3)*4,Math.round((n.max[a]+256)*32768));}
  put24(out.data,at+24,n.skip);put24(out.data,at+28,n.face);
 }
 if(segments)segments.copy(out.data,segmentRow*W*4);
 return {png:out,positions,info:resultInfo,nodes,segments,depth,treeRow,segmentRow:segments?segmentRow:0,copied,checked};
}
function validate(result,rays){
 const {positions,info,nodes,segments}=result,left=[3,5,7].includes(result.png.data[27*4]);let seed=0x6a09e667,visits=0,hits=0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]);
 function triangle(o,d,a,b,c){const e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)return Infinity;const s=sub(o,a),u=dot(s,h)/det;if(u<0||u>1)return Infinity;const q=cross(s,e1),v=dot(d,q)/det;if(v<0||u+v>1)return Infinity;const t=dot(e2,q)/det;return t>=0?t:Infinity;}
 function box(o,d,lo,hi,nearest){let a=0,b=nearest;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-15){if(o[k]<lo[k]||o[k]>hi[k])return false;}else{const x=(lo[k]-o[k])/d[k],y=(hi[k]-o[k])/d[k];a=Math.max(a,Math.min(x,y));b=Math.min(b,Math.max(x,y));if(a>b)return false;}}return b>=0;}
 for(let r=0;r<rays;r++){
  const frame=r%info.frames,t=random(),easing=info.easing;
  const values=new Float64Array(info.vertices*3);
  for(let v=0;v<info.vertices;v++)for(let a=0;a<3;a++){
   const at=f=>positions[((f%info.frames)*info.vertices+v)*3+a],p=at(frame),p1=at(frame+1),p2=at(frame+2),p3=at(frame+3);
   const s=easing===2?(t<.5?4*t*t*t:1-(-2*t+2)**3/2):t;
   values[v*3+a]=easing===0?p:easing<3?p*(1-s)+p1*s:.5*((2*p1)+(-p+p2)*t+(2*p-5*p1+4*p2-p3)*t*t+(-p+3*p1-3*p2+p3)*t*t*t);
  }
  const root=nodes[0],center=root.min.map((x,a)=>(x+root.max[a])/2),span=root.min.map((x,a)=>Math.max(.1,root.max[a]-x));
  const o=center.map((x,a)=>x+(random()-.5)*span[a]*4),target=center.map((x,a)=>x+(random()-.5)*span[a]);const d=sub(target,o);
  const faceHit=face=>{const v=Array.from({length:4},(_,c)=>Array.from(values.subarray((face*4+c)*3,(face*4+c+1)*3)));return left?Math.min(triangle(o,d,v[3],v[2],v[1]),triangle(o,d,v[1],v[0],v[3])):Math.min(triangle(o,d,v[0],v[1],v[2]),triangle(o,d,v[2],v[3],v[0]));};
  let brute=Infinity,bvh=Infinity;for(let f=0;f<info.faces;f++)brute=Math.min(brute,faceHit(f));
  let node=0;while(node<nodes.length){visits++;const n=nodes[node];let lo=n.min,hi=n.max;
   if(segments){const off=(frame*nodes.length+node)*8;lo=n.min.map((v,a)=>v+(n.max[a]-v)*segments[off+a]/255);hi=n.min.map((v,a)=>v+(n.max[a]-v)*segments[off+4+a]/255);}
   if(!box(o,d,lo,hi,bvh)){node=n.skip;continue;}if(n.face!==INTERNAL)bvh=Math.min(bvh,faceHit(n.face));node++;
  }
  if(brute!==bvh&&(!Number.isFinite(brute)||!Number.isFinite(bvh)||Math.abs(brute-bvh)>1e-9))throw Error(`AS2 BVH/brute-force mismatch at ray ${r}`);
  if(Number.isFinite(brute))hits++;
 }
 return {rays,hits,meanNodeVisits:rays?visits/rays:0,mismatches:0};
}
export function buildArmorBvhPack(source,destination,{preserveFirstLayer=true,segmentBounds=true,validateRays=512}={}){
 source=fs.realpathSync(source);const requested=path.resolve(destination);destination=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
 if(fs.existsSync(destination))throw Error('Destination must be new');if(destination.startsWith(source+path.sep)||source.startsWith(destination+path.sep))throw Error('Source/destination must be separate');
 if(!fs.existsSync(path.join(source,'pack.mcmeta')))throw Error('Source must be a resource pack');
 const changes=new Map(),manifest={format:'objcubed-portable-armor-bvh-v1',source:path.basename(source),destination:path.basename(destination),preserveFirstLayer,converted:[],skipped:[],equipment:[]};
 for(const file of files(source).filter(f=>/[/\\]equipment[/\\][^/\\]+\.json$/.test(f))){
  const asset=JSON.parse(fs.readFileSync(file,'utf8'));if(!asset.layers)continue;let altered=false;
  for(const [kind,layers]of Object.entries(asset.layers)){
   if(!Array.isArray(layers))continue;const groups=new Map();
   for(let index=0;index<layers.length;index++){
    const layer=layers[index];if(typeof layer.texture!=='string'||layer.use_player_texture||(preserveFirstLayer&&index===0))continue;
    const resource=texturePath(layer.texture,kind),texture=path.join(source,resource.relative);if(!fs.existsSync(texture))continue;
    const entry=prepare(PNG.sync.read(fs.readFileSync(texture)),layer);if(!entry)continue;
    if(entry.reason){manifest.skipped.push({texture:resource.relative,reason:entry.reason});continue;}
    Object.assign(entry,{index,layer,...resource});if(!groups.has(entry.key))groups.set(entry.key,[]);groups.get(entry.key).push(entry);
   }
   const replacements=new Map(),removed=new Set();
   for(const [key,group]of groups){if(group.length<2)continue;
    const geometry=new Map();let conflict=false;
    for(const g of group){const [k,u]=geometryKey(g.geometry,g.info.frames);if(geometry.has(k)&&geometry.get(k)!==u)conflict=true;geometry.set(k,u);}
    if(conflict){manifest.skipped.push({equipment:path.relative(source,file),kind,part:group[0].target,faces:group.length,reason:'identical animated geometry with different UVs'});continue;}
    const result=merge(group,{segmentBounds}),validation=validate(result,validateRays),first=group[0];
    const name=`${first.name}_as2_${key.slice(0,12)}`,id=`${first.namespace}:${name}`,relative=`assets/${first.namespace}/textures/entity/equipment/${kind}/${name}.png`;
    if(fs.existsSync(path.join(source,relative)))throw Error('AS2 texture name collision');
    const bytes=PNG.sync.write(result.png);if(changes.has(relative)&&!changes.get(relative).equals(bytes))throw Error('Conflicting AS2 texture output');changes.set(relative,bytes);
    replacements.set(first.index,{...first.layer,texture:id});for(const g of group.slice(1))removed.add(g.index);
    manifest.converted.push({texture:relative,part:first.target,innerLayer:Boolean(first.inner),emission:first.emission,faces:group.length,frames:first.info.frames,size:[result.png.width,result.png.height],nodes:result.nodes.length,depth:result.depth,treeRow:result.treeRow,segmentRow:result.segmentRow,segmentBytes:result.segments?.length||0,exactCopiedPositionAndUvTexels:result.copied,exactVerifiedPositionAndUvTexels:result.checked,validation,sources:group.map((g,face)=>({face,layerIndex:g.index,texture:g.relative,sourceFace:g.face}))});
   }
   if(replacements.size){const output=layers.flatMap((l,i)=>removed.has(i)?[]:[replacements.get(i)||l]);asset.layers[kind]=output;altered=true;manifest.equipment.push({file:path.relative(source,file),kind,oldLayers:layers.length,newLayers:output.length});}
  }
  if(altered)changes.set(path.relative(source,file),Buffer.from(JSON.stringify(asset,null,2)+'\n'));
 }
 try{fs.cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});for(const [relative,bytes]of changes){const p=path.join(destination,relative);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);}fs.writeFileSync(path.join(destination,'portable-armor-bvh-manifest.json'),JSON.stringify(manifest,null,2)+'\n');}catch(e){fs.rmSync(destination,{recursive:true,force:true});throw e;}
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [source,destination,...args]=process.argv.slice(2);if(!source||!destination||args.length)throw Error('Usage: node tools/portable-renderer/build-armor-bvh.mjs SOURCE_AS1_PACK NEW_DESTINATION');
 const result=buildArmorBvhPack(source,destination);console.log(JSON.stringify({...result,converted:result.converted.map(({sources,...entry})=>({...entry,sourceLayers:sources.length}))},null,2));
}
