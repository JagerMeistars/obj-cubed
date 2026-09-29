import fs from 'node:fs';
import path from 'node:path';
import {exported,writePack,memory,obj} from './horse-fixture-library.mjs';
const root=path.resolve(process.argv[2]??'audit/2026-09-29/horse-models');fs.mkdirSync(root,{recursive:true});
const liveOffsetY=.55;
const models=[];for(const name of ['horse_simple','horse_decor','horse_stress','horse_anim'])for(const kind of ['horse_body','horse_saddle']){const result=await exported(name,kind,{liveOffsetY,...(name==='horse_anim'?{frames:4,textureFrames:3,datapack:true}:{})});models.push({name,kind,faces:result.exp.nfaces,layers:result.layers.length,frames:result.exp.nframes,liveOffsetY});const source=path.join(root,'source',name+'_'+kind);fs.mkdirSync(source,{recursive:true});for(let f=0;f<result.frames.length;f++)fs.writeFileSync(path.join(source,`frame${f}.obj`),obj(result.frames[f]));}
writePack(root);fs.writeFileSync(path.join(root,'fixtures.json'),JSON.stringify({models,commands:[...memory.writes].filter(([p])=>p.endsWith('_give.txt')).map(([file,text])=>({file,text}))},null,2));console.log(root);
