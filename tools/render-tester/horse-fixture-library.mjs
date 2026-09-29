import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
const require=createRequire(import.meta.url),{loadPlugin}=require('../../test/helpers/load-plugin.cjs'),{makeMemFs}=require('../../test/helpers/mem-fs.cjs');
export const memory=makeMemFs();
export const uv=[[0,0],[1,0],[1,1],[0,1]];
export function image(frames=1,material=0){const width=32,height=32*frames,data=Buffer.alloc(width*height*4),colors=[[230,50,80],[50,210,100],[70,90,230]];for(let f=0;f<frames;f++)for(let y=0;y<32;y++)for(let x=0;x<32;x++){const c=colors[(f+material)%3],delta=(x<16?0:15)+(y<16?0:30);data.set([...c.map(v=>v-delta),255],((f*32+y)*32+x)*4);}return{width,height,data,frames};}
export function box(lo,hi){const[x,y,z]=lo,[X,Y,Z]=hi;return [[[X,y,z],[x,y,z],[x,y,Z],[X,y,Z]],[[X,Y,Z],[x,Y,Z],[x,Y,z],[X,Y,z]],[[x,y,z],[x,Y,z],[x,Y,Z],[x,y,Z]],[[x,y,Z],[x,Y,Z],[X,Y,Z],[X,y,Z]],[[X,y,Z],[X,Y,Z],[X,Y,z],[X,y,z]],[[X,y,z],[X,Y,z],[x,Y,z],[x,y,z]]];}
export function mesh(name,frame=0,kind='horse_body'){
 if(name==='panels'){const quads=[];for(let f=0;f<6;f++){let x=(f%3)*.42-.62,y=Math.floor(f/3)*.42+.02;quads.push([[x,y,0],[x+.36,y,0],[x+.36,y+.36,0],[x,y+.36,0]]);}return quads;}
 if(name==='sparse')return [[[-.45,.1,.1],[.45,.1,.1],[.4,.8,.1],[-.3,.7,.1]]];
 const offset=kind==='horse_saddle'?.43:0;
 const simple=box([-.29,.01+offset,-.64],[.32,.25+offset,.26]);
 if(name==='horse_simple')return simple;
 if(name==='horse_decor')return [...simple,...box([-.19,.27+offset,-.08],[.14,.56+offset,.19])];
 if(name==='horse_anim')return box([-.29+frame*.05,.01+offset,-.64],[.32+frame*.05,.25+offset+frame*.05,.26]);
 if(name==='horse_stress'){const faces=[];for(let i=0;i<10;i++)faces.push(...box([-.42+(i%5)*.17,.05+offset+Math.floor(i/5)*.18,-.6],[ -.29+(i%5)*.17,.18+offset+Math.floor(i/5)*.18,.25]));return faces;}
 throw Error('Unknown geometry '+name);
}
export function obj(quads,emission=0){const lines=[];for(let f=0;f<quads.length;f++){lines.push(`o ocp1e${typeof emission==='function'?emission(f):emission}i${f}`);for(const p of quads[f])lines.push('v '+p.join(' '));for(const v of uv)lines.push('vt '+v.join(' '));lines.push('f '+[0,1,2,3].map(k=>(f*4+k+1)+'/'+(f*4+k+1)).join(' '));}return lines.join('\n');}
export async function exported(name,kind,options={}){
 const im=image(options.textureFrames??1,kind==='horse_saddle'?1:0);class Image{set src(s){queueMicrotask(()=>this.onload?.());}get naturalWidth(){return im.width;}get naturalHeight(){return im.height;}}
 const api=loadPlugin(path.resolve('objcubed.js'),{requireImpl:id=>id==='fs'?memory:id==='path'?{...path,...path.posix}:require(id),globals:{Buffer,Image,setTimeout,process,console:{log(){},warn(){},error:console.error},document:{createElement(){return{getContext(){return{drawImage(){},getImageData(){return im;}};}};}},Texture:{all:[{uuid:'t0',name:'pattern',source:'data:0',img:{src:'data:0'},uv_height:32,uv_width:32,frameCount:im.frames}]},Outliner:{root:[]},Blockbench:{export(){throw Error('Unexpected dialog');},pickDirectory(){return '/rp';}},Project:{name,export_path:''},BarItems:{}}});
 const cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['time','time','time'],duration:4,autoplay:false,easing:0,interpolation:0,noshadow:options.noshadow??true,autorotate:0,visibility:7,displaySlots:{},flipuv:false,useAtlas:false,texAnimEnabled:im.frames>1,texFrametime:2,texFade:false,resourcePackDir:'/rp',baseItem:'stick',generateDatapack:!!options.datapack,datapackNamespace:'horse_live',datapackAnimId:kind==='horse_body'?'body':'saddle',datapackOutputDir:'/datapacks',datapackTargetType:'horse',datapackEquipSlot:kind==='horse_body'?'body':'saddle',cmdName:name,exportAsEquipment:true,equipmentTarget:kind,selectedPieces:[]};
 cfg.cmdName=name+'_'+(kind==='horse_body'?'body':'saddle');
 cfg.autoplay=!!options.autoplay;cfg.easing=options.easing??0;cfg.texFade=!!options.fade;
 const frames=Array.from({length:options.frames??1},(_,i)=>mesh(name,i,kind));
 // Live-scene fixtures may protrude above the native horse. Keep this opt-in:
 // the independent GPU geometry oracle and its original inputs stay unchanged.
 if(options.liveOffsetY!==undefined){if(!Number.isFinite(options.liveOffsetY))throw Error('Invalid liveOffsetY');for(const frame of frames)for(const quad of frame)for(const p of quad)p[1]+=options.liveOffsetY;}
 const exp=await api.buildOutput(cfg,frames.map(q=>obj(q,options.emission??0)),'');await api.saveSingleOutput(exp,api.buildDisplayTransforms(cfg),cfg);
 const prefix=`/rp/assets/minecraft/textures/entity/equipment/${kind}/${cfg.cmdName}_${kind}_`,layers=[...memory.writes].filter(([p])=>p.startsWith(prefix)&&p.endsWith('.png')).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([filename,data])=>({filename,...PNG.sync.read(Buffer.from(data))}));
 if(layers.length!==Math.ceil(frames[0].length/6))throw Error('Unexpected layer count');return{cfg,exp,frames,source:im,layers};
}
export function floats(file,values){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));fs.writeFileSync(file,b);}
export function writePack(root){for(const[p,data]of memory.writes){const rel=p.startsWith('/rp/')?p.slice(4):p.startsWith('/datapacks/')?'datapacks/'+p.slice(11):null;if(rel==null)continue;const to=path.join(root,rel);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,data);}}
