// Extract portable native rest-pose geometry for the Blockbench template builder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options={
  input:'audit/template-native/native-models.json',
  manifest:'audit/template-native/native-probe-manifest.json',
  output:'tools/equipment-template-models.json',
};
const args=process.argv.slice(2);
if(args.includes('--help')) {
  console.log('Usage: node tools/render-tester/build-equipment-template-models.mjs [--input path] [--manifest path] [--output path]\nAll relative paths resolve from the repository root. Reads the native CPU probe and manifest; no game/GPU.');
  process.exit(0);
}
for(let i=0;i<args.length;i+=2) {
  const key=args[i].replace(/^--/,'');
  if(!Object.hasOwn(options,key)||!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))
    throw Error('Expected --input, --manifest or --output followed by a path; use --help.');
  options[key]=args[i+1];
}
const input=path.resolve(root,options.input),manifestPath=path.resolve(root,options.manifest),output=path.resolve(root,options.output);
const catalogPath=path.join(root,'tools/equipment-carriers.json');
if([input,manifestPath,catalogPath].some(file=>file===output))
  throw Error('The output must differ from the input probe, manifest and carrier catalog.');
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const nativeBytes=fs.readFileSync(input);
const native=JSON.parse(nativeBytes.toString('utf8').replace(/^\uFEFF/,''));
const manifest=readJSON(manifestPath),carriers=readJSON(catalogPath);
if(!Array.isArray(native.models))throw Error('Expected a native probe JSON with a models array.');
if(manifest.minecraft!=='26.3')throw Error('The native probe must target Minecraft 26.3.');
for(const key of ['clientJarSha256','probeSourceSha256','nativeModelsSha256'])
  if(!/^[a-f0-9]{64}$/.test(manifest[key]||''))throw Error('Missing or invalid probe provenance: '+key);
if(crypto.createHash('sha256').update(nativeBytes).digest('hex')!==manifest.nativeModelsSha256)
  throw Error('The native probe JSON does not match the supplied manifest.');

const rigidityPoseNames=['rest','moving','action1','action2'];
const rigidityTolerance=1e-4;
function multiply(a,b) {
  const result=Array(16).fill(0);
  for(let column=0;column<4;column++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)
    result[column*4+row]+=a[k*4+row]*b[column*4+k];
  return result;
}
function inverse(matrix) {
  const rows=Array.from({length:4},(_,row)=>Array.from({length:8},(_,column)=>
    column<4?matrix[column*4+row]:Number(column-4===row)));
  for(let column=0;column<4;column++) {
    let pivot=column;
    for(let row=column+1;row<4;row++)if(Math.abs(rows[row][column])>Math.abs(rows[pivot][column]))pivot=row;
    if(Math.abs(rows[pivot][column])<1e-12)throw Error('Singular native model-part matrix.');
    [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
    const divisor=rows[column][column];
    rows[column]=rows[column].map(value=>value/divisor);
    for(let row=0;row<4;row++)if(row!==column) {
      const factor=rows[row][column];
      rows[row]=rows[row].map((value,k)=>value-factor*rows[column][k]);
    }
  }
  return Array.from({length:16},(_,i)=>rows[i%4][4+Math.floor(i/4)]);
}
function positiveUniformScale(matrix) {
  const axes=[0,4,8].map(offset=>matrix.slice(offset,offset+3));
  const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
  const lengths=axes.map(axis=>Math.sqrt(dot(axis,axis))),scale=lengths[0];
  const determinant=axes[0][0]*(axes[1][1]*axes[2][2]-axes[1][2]*axes[2][1])-
    axes[1][0]*(axes[0][1]*axes[2][2]-axes[0][2]*axes[2][1])+
    axes[2][0]*(axes[0][1]*axes[1][2]-axes[0][2]*axes[1][1]);
  return scale>1e-8&&determinant>0&&
    lengths.every(length=>Math.abs(length-scale)<=rigidityTolerance*scale)&&
    [[0,1],[0,2],[1,2]].every(([a,b])=>Math.abs(dot(axes[a],axes[b]))<=rigidityTolerance*scale*scale);
}
function pathAffinity(partPath,bindingPath) {
  const part=partPath.split('/'),binding=bindingPath.split('/');
  let common=0;
  while(common<Math.min(part.length,binding.length)&&part[common]===binding[common])common++;
  return [common,part.length+binding.length-2*common];
}
function repeatedGuideRoots(definition) {
  const roots=[];
  for(const descriptor of Object.values(definition.bindings))if(descriptor.repeats>1) {
    const suffix=descriptor.path.split('/').at(-1),parent=descriptor.path.slice(0,-suffix.length);
    const siblings=descriptor.repeats===4&&/^(left|right)_(front|hind)_leg$/.test(suffix)
      ?['right_front_leg','left_front_leg','right_hind_leg','left_hind_leg']
      :descriptor.repeats===2&&/^(left|right)_wing$/.test(suffix)?['left_wing','right_wing']:[];
    for(const sibling of siblings)if(parent+sibling!==descriptor.path)roots.push(parent+sibling);
  }
  return roots;
}
function classifyPartBindings(model,definition) {
  const states=rigidityPoseNames.map(name=>{
    const pose=model.states.find(state=>state.name===name);
    if(!Array.isArray(pose?.parts))throw Error(`Missing rigidity pose ${name}: ${model.modelLayerConstant}`);
    return new Map(pose.parts.map(part=>[part.path,part]));
  });
  const entries=Object.entries(definition.bindings),canonical=new Map(entries.map(([key,value])=>[value.path,key]));
  const repeatedRoots=repeatedGuideRoots(definition),partBindings={};
  for(const part of states[0].values()) {
    if(!part.cubes.length)continue;
    if(canonical.has(part.path)) {partBindings[part.path]=canonical.get(part.path);continue;}
    if(!part.effectivelyVisible)continue;
    const segments=part.path.split('/');
    const limbIndex=segments.findIndex(segment=>/^(?:left|right)_(?:(?:front|hind)_)?leg$|^(?:left|right)_wing$/.test(segment));
    if(limbIndex>=0&&!canonical.has(segments.slice(0,limbIndex+1).join('/')))continue;
    // Other legs/wings are previews of the repeated author detail, not extra exported geometry.
    if(repeatedRoots.some(root=>part.path===root||part.path.startsWith(root+'/')))continue;
    const candidates=entries.filter(([,descriptor])=>{
      if(descriptor.visibleWhen&&!part.path.startsWith(descriptor.path+'/'))return false;
      let first;
      for(const state of states) {
        const posedPart=state.get(part.path),posedBinding=state.get(descriptor.path);
        if(!posedPart||!posedBinding)return false;
        const relative=multiply(inverse(posedBinding.modelMatrixColumnMajor),posedPart.modelMatrixColumnMajor);
        if(!positiveUniformScale(relative))return false;
        if(first&&relative.some((value,i)=>Math.abs(value-first[i])>rigidityTolerance))return false;
        first??=relative;
      }
      return true;
    });
    candidates.sort((a,b)=>{
      const affinityA=pathAffinity(part.path,a[1].path),affinityB=pathAffinity(part.path,b[1].path);
      return affinityB[0]-affinityA[0]||affinityA[1]-affinityB[1];
    });
    if(candidates.length)partBindings[part.path]=candidates[0][0];
  }
  return partBindings;
}

const fixture={
  version:1,
  minecraft:'26.3',
  source:{
    clientJarSha256:manifest.clientJarSha256,
    probeSourceSha256:manifest.probeSourceSha256,
    method:'Actual Minecraft 26.3 LayerDefinitions.createRoots geometry and setupAnim rest pose; CPU extraction, no game window or GPU. Renderer external root transforms are excluded.',
    regenerateProbe:'powershell -File tools/render-tester/run-native-equipment-probe.ps1 -OutputDirectory audit/template-native',
    partBindingMethod:'Canonical carrier paths, then visible rest-pose parts with closest shared ancestry and an unchanged relative model matrix across rest/moving/action1/action2 poses (tolerance 0.0001). Additional parts require a positive uniform relative scale; noncanonical legs/wings and hidden parts remain guides.',
  },
  coordinateSystem:{
    vertexUnit:'pixel',
    nativeY:'down',
    matrixTranslationUnit:'block',
    matrixOrder:'column-major',
    rotationUnit:'radian',
    previewConversion:['x','24-y','z'],
    note:'Use full part model matrix, including ancestor transforms and scales. Convert native block matrix to pixel units before preview conversion. Cube polygon vertices include inflate and mirror; bounds may not include inflate and are not a replacement for face vertices.',
  },
  models:{},
};
for(const [target,definition] of Object.entries(carriers)) {
  const model=native.models.find(model=>model.modelLayerConstant===definition.modelLayer);
  if(!model)throw Error('Missing native model layer: '+definition.modelLayer);
  const rest=model.states?.find(state=>state.name==='rest');
  if(!Array.isArray(rest?.parts))throw Error('Missing native rest pose: '+definition.modelLayer);
  for(const [binding,descriptor] of Object.entries(definition.bindings))
    if(!rest.parts.some(part=>part.path===descriptor.path&&part.cubes?.[descriptor.cubeIndex]))
      throw Error(`Missing native carrier part: ${target}/${binding} (${descriptor.path})`);
  fixture.models[target]={
    modelLayer:model.modelLayerConstant,
    textureSize:model.textureSize,
    pose:'rest',
    assignedState:rest.assignedState,
    partBindings:classifyPartBindings(model,definition),
    parts:rest.parts.map(part=>({
      path:part.path,
      visible:part.visible,
      skipDraw:part.skipDraw,
      effectivelyVisible:part.effectivelyVisible,
      position:part.position,
      rotationXYZ:part.rotationXYZ,
      scale:part.scale,
      localMatrixColumnMajor:part.localMatrixColumnMajor,
      modelMatrixColumnMajor:part.modelMatrixColumnMajor,
      cubes:part.cubes.map(cube=>({
        bounds:cube.bounds,
        faces:cube.faces.map(face=>({
          normalLocal:face.normalLocal,
          verticesLocalPixelsUVPixels:face.verticesLocalPixelsUVPixels,
        })),
      })),
    })),
  };
}

// One part per line keeps exact floats/UVs while making the fixture compact and diffable.
const header=JSON.stringify({...fixture,models:undefined},null,2).replace(/\n\}$/ ,',\n  "models": {');
const models=Object.entries(fixture.models).map(([target,model])=>{
  const modelHeader=JSON.stringify({...model,parts:undefined},null,2).split('\n').map(line=>'    '+line).join('\n').replace(/\n    \}$/,',\n      "parts": [');
  return '    '+JSON.stringify(target)+': '+modelHeader.trimStart()+'\n'+model.parts.map(part=>'        '+JSON.stringify(part)).join(',\n')+'\n      ]\n    }';
});
const serialized=header+'\n'+models.join(',\n')+'\n  }\n}\n';
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,serialized);
console.log(JSON.stringify({
  output:path.relative(root,output).replaceAll('\\','/'),
  bytes:Buffer.byteLength(serialized),
  targets:Object.keys(fixture.models).length,
  parts:Object.values(fixture.models).reduce((sum,model)=>sum+model.parts.length,0),
  cubes:Object.values(fixture.models).reduce((sum,model)=>sum+model.parts.reduce((count,part)=>count+part.cubes.length,0),0),
},null,2));
