// Expand the current direct pack against actual Minecraft assets. No fixtures
// or guessed vanilla includes: an absent vanilla resource is a hard failure.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
import {shaderMatrix} from '../../test/helpers/shader-matrix.mjs';
const output=path.resolve(process.argv[2]),vanilla=path.resolve(process.argv[3]);
const pack=path.resolve(process.argv[4]??'objcubed'),manifest=[];
for(const entry of shaderMatrix()){
 const directory=path.join(output,'direct',entry.name);fs.mkdirSync(directory,{recursive:true});
 const shaders={};
 for(const [suffix,stage]of [['vsh','vert'],['fsh','frag']]){
  let source=expandShader(path.join(pack,`assets/minecraft/shaders/core/${entry.kind}.${suffix}`),[pack,vanilla]);
  const defines=entry.defines.map(v=>'#define '+v.replace('=',' ')).join('\n');
  source=source.replace(/^(#version[^\n]*\n)/,'$1'+defines+'\n');
  fs.writeFileSync(path.join(directory,'shader.'+stage),source);
  shaders[stage]=crypto.createHash('sha256').update(source).digest('hex');
 }
 manifest.push({...entry,directory,shaders});
}
fs.writeFileSync(path.join(output,'programs.txt'),manifest.map(p=>p.directory).join('\n'));
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({pack,vanilla,programs:manifest},null,2));
console.log(`Prepared ${manifest.length} current programs in ${output}`);
