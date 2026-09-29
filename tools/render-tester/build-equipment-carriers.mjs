import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options={input:'audit/native-equipment/native-models.json',output:'audit/native-equipment/equipment-carriers.json'};
const args=process.argv.slice(2);
if(args.includes('--help')) {
 console.log('Usage: node tools/render-tester/build-equipment-carriers.mjs [--input path] [--output path] [--checks path] [--compare existing-catalog]\nAll relative paths resolve from the repository root. Reads native CPU probe JSON; no game/GPU.');
 process.exit(0);
}
for(let i=0;i<args.length;i+=2) {
 const key=args[i].replace(/^--/,'');
 if(!['input','output','checks','compare'].includes(key)||!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))
  throw Error('Expected --input, --output, --checks or --compare followed by a path; use --help.');
 options[key]=args[i+1];
}
const resolve=value=>path.resolve(root,value);
const input=resolve(options.input),output=resolve(options.output);
const checksFile=options.checks?resolve(options.checks):path.join(path.dirname(output),'catalog-checks.json');
if(input===output||input===checksFile||output===checksFile)throw Error('Native input, generated catalog and checks report must use different paths.');
const native=JSON.parse(fs.readFileSync(input,'utf8')).models;
if(!Array.isArray(native)) throw Error('Expected native probe JSON with a models array: '+input);
const equine={body:['Body','root/body'],head:['Head','root/head_parts/head']};
const specs={
 horse_body:['HORSE_ARMOR',{...equine,legs:['Legs (repeated on all four)','root/right_front_leg',4]}],
 horse_saddle:['HORSE_SADDLE',equine],
 donkey_saddle:['DONKEY_SADDLE',equine],mule_saddle:['MULE_SADDLE',equine],
 zombie_horse_saddle:['ZOMBIE_HORSE_SADDLE',equine],skeleton_horse_saddle:['SKELETON_HORSE_SADDLE',equine],
 wolf_body:['WOLF_ARMOR',{body:['Body','root/body'],head:['Head','root/head/real_head'],upper_body:['Upper body','root/upper_body'],legs:['Legs (repeated on all four)','root/right_front_leg',4],tail:['Tail','root/tail/real_tail']}],
 llama_body:['LLAMA_DECOR',{body:['Body','root/body'],head:['Head','root/head'],legs:['Legs (repeated on all four)','root/right_front_leg',4]}],
 happy_ghast_body:['HAPPY_GHAST_HARNESS',{harness:['Harness','root/harness'],goggles:['Goggles','root/goggles']}],
 wings:['ELYTRA',{wings:['Wings (mirrored pair)','root/left_wing',2]}],
 camel_saddle:['CAMEL_SADDLE',{body:['Body','root/body'],head:['Head','root/body/head'],left_ear:['Left ear','root/body/head/left_ear'],right_ear:['Right ear','root/body/head/right_ear'],reins:['Reins (with rider)','root/body/head/reins',null,1],right_front_leg:['Right front leg','root/right_front_leg'],left_front_leg:['Left front leg','root/left_front_leg'],right_hind_leg:['Right hind leg','root/right_hind_leg'],left_hind_leg:['Left hind leg','root/left_hind_leg']}],
 camel_husk_saddle:['CAMEL_HUSK_SADDLE',{body:['Body','root/body'],head:['Head','root/body/head'],left_ear:['Left ear','root/body/head/left_ear'],right_ear:['Right ear','root/body/head/right_ear'],reins:['Reins (with rider)','root/body/head/reins',null,1],right_front_leg:['Right front leg','root/right_front_leg'],left_front_leg:['Left front leg','root/left_front_leg'],right_hind_leg:['Right hind leg','root/right_hind_leg'],left_hind_leg:['Left hind leg','root/left_hind_leg']}],
 pig_saddle:['PIG_SADDLE',{body:['Body','root/body'],head:['Head','root/head'],legs:['Legs (repeated on all four)','root/right_front_leg',4]}],
 strider_saddle:['STRIDER_SADDLE',{body:['Body','root/body'],right_leg:['Right leg','root/right_leg'],left_leg:['Left leg','root/left_leg']}],
 nautilus_body:['NAUTILUS_ARMOR',{shell:['Shell','root/root/shell']}],
 nautilus_saddle:['NAUTILUS_SADDLE',{shell:['Shell','root/root/shell']}],
};
const round=v=>+v.toFixed(8),sub=(a,b)=>a.map((v,k)=>v-b[k]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((n,v,k)=>n+v*b[k],0);
const catalog={},checks=[];
for(const[target,[layer,bindings]]of Object.entries(specs)){const model=native.find(m=>m.modelLayerConstant===layer);if(!model)throw Error('Missing native model layer: '+layer);const parts=model.states.find(s=>s.name==='baked')?.parts;if(!parts)throw Error('Missing baked state: '+layer);const [w,h]=model.textureSize;const output={textureSize:model.textureSize,modelLayer:layer,defaultBinding:target==='happy_ghast_body'?'harness':target==='wings'?'wings':target.startsWith('nautilus_')?'shell':'body',bindings:{}};
 for(const[key,[label,partPath,repeats,cubeIndex=0]]of Object.entries(bindings)){const part=parts.find(p=>p.path===partPath);if(!part?.cubes?.[cubeIndex])throw Error(`Missing native cube: ${layer}/${partPath}`);const cube=part.cubes[cubeIndex],quads=[];
  for(const[faceIndex,face]of cube.faces.entries()){const [u0,v0,u1,v1]=face.uvRectPixels;if(!(u1>u0&&v1>v0))continue;
   const corner=(u,v)=>{const matches=face.verticesLocalPixelsUVPixels.filter(p=>Math.abs(p[3]-u)<1e-4&&Math.abs(p[4]-v)<1e-4);if(matches.length!==1)throw Error('Nonunique corner');return matches[0].slice(0,3).map(x=>round(x/16));};
   const q0=corner(u1,v0),q1=corner(u0,v0),q3=corner(u1,v1),q2=corner(u0,v1),a=sub(q0,q1),b=sub(q0,q3),area=Math.hypot(...cross(a,b)),normal=face.normalLocal.map(round);
   if(area<1e-8||Math.abs(dot(a,b))>1e-6||Math.abs(dot(cross(a,b),normal))<1e-8)throw Error(`${target}/${key}/face${faceIndex} degenerate basis`);
   const closure=q2.map((v,k)=>Math.abs(v-(q1[k]+q3[k]-q0[k])));if(Math.max(...closure)>1e-7)throw Error('Nonplanar/native rectangular corner failure');
   quads.push({uv:[u0/w,v0/h,u1/w,v1/h].map(round),q0,q1,q3,normal});checks.push({target,binding:key,face:faceIndex,area,orthogonal:Math.abs(dot(a,b))<1e-6,rectangleClosureMax:Math.max(...closure)});
  }
  if(!quads.length||quads.length>6||new Set(quads.map(q=>JSON.stringify(q.uv))).size!==quads.length)throw Error(`${target}/${key} requires one to six distinct carrier rectangles`);
  output.bindings[key]={label,path:partPath,cubeIndex,pivot:[0,0,0],quads,...(key==='reins'?{visibleWhen:'ridden'}:{}),...(repeats?{repeats}:{})};
 }
 catalog[target]=output;
}
const serialized=JSON.stringify(catalog,null,2)+'\n';
if(options.compare) {
 const expected=resolve(options.compare);
 if(fs.readFileSync(expected,'utf8')!==serialized)throw Error('Generated catalog differs byte-for-byte from '+expected);
 console.log('Exact catalog match: '+expected);
}
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.mkdirSync(path.dirname(checksFile),{recursive:true});
fs.writeFileSync(output,serialized);
fs.writeFileSync(checksFile,JSON.stringify({generatedAt:new Date().toISOString(),nativeInput:input,nativeSHA256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),catalogSHA256:crypto.createHash('sha256').update(serialized).digest('hex'),targets:Object.keys(catalog).length,bindings:Object.values(catalog).reduce((n,t)=>n+Object.keys(t.bindings).length,0),quads:checks.length,allValid:true,checks},null,2)+'\n');
console.log(output+' targets='+Object.keys(catalog).length+' quads='+checks.length);
