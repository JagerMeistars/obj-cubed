// Test fixtures use the same shader sources as the main resource pack.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pack=path.resolve(process.argv[2]||path.join(repo,'compat/skin-test'));
fs.mkdirSync(pack,{recursive:true});
fs.cpSync(path.join(repo,'objcubed'),pack,{recursive:true});
const {createRequire}=await import('node:module');
const require=createRequire(import.meta.url);
const {loadObjcubedWithContext}=require('../test/helpers/load-plugin.cjs');
const {api}=loadObjcubedWithContext();
api.installSkinRuntime(fs,path,pack);
console.log(pack);
