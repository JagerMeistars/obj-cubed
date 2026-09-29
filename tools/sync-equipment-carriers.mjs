// Keep the standalone Blockbench plugin's native carrier descriptors reproducible.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'tools/equipment-carriers.json'),'utf8'));
const file=path.join(root,'objcubed.js');
let source=fs.readFileSync(file,'utf8');
const marker=/    \/\/ BEGIN GENERATED EQUIPMENT CARRIERS[\s\S]*?    \/\/ END GENERATED EQUIPMENT CARRIERS/;
if(!marker.test(source)) throw Error('Equipment carrier markers missing');
source=source.replace(marker, '    // BEGIN GENERATED EQUIPMENT CARRIERS\n    const EQUIPMENT_CARRIERS = '+JSON.stringify(catalog)+';\n    // END GENERATED EQUIPMENT CARRIERS');
fs.writeFileSync(file,source.replace(/\r?\n/g,'\r\n'));
console.log(`Embedded ${Object.keys(catalog).length} native equipment targets.`);
