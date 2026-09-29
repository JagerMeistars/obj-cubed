// Deterministic obj³ release packaging: no model conversion.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
const release = 'objcubed';
const baseline = '41bf938';
const originalZipSha256 = '81c458cf868bb8e974853c5460fdbec448f06c3e56da64768bd7c56e75e9537e';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const textFile = /\.(?:mjs|js|json|mcmeta|glsl|vsh|fsh|md|txt)$/i;
function content(file) {
  const bytes = fs.readFileSync(file);
  return textFile.test(file) || path.basename(file) === 'LICENSE' ? Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n')) : bytes;
}
function documentContent(file) {
  // Repository docs use README_RU.md; the published entry has always used a
  // hyphen. Keep links valid in both places without shipping duplicate READMEs.
  return Buffer.from(content(file).toString('utf8').replace(/(\]\()README_RU\.md(?=[)#])/g, '$1README-RU.md'));
}
function collect(directory, relative = '') {
  const files = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const full = path.join(directory, item.name), name = relative + item.name;
    if (item.isSymbolicLink()) throw Error(`Symlink not permitted in distribution: ${name}`);
    if (item.isDirectory()) files.push(...collect(full, name + '/'));
    else if (item.isFile()) files.push({ name, bytes: content(full) });
  }
  return files;
}
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(entries) {
  const body = [], directory = []; let offset = 0;
  for (const { name, bytes } of [...entries].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const filename = Buffer.from(name), compressed = zlib.deflateRawSync(bytes, { level: 9 });
    const checksum = crc32(bytes), local = Buffer.alloc(30), central = Buffer.alloc(46);
    // Fixed DOS date: 1980-01-01, UTF-8 names, deflate. No timestamps or extras.
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6);
    local.writeUInt16LE(8,8); local.writeUInt16LE(33,12); local.writeUInt32LE(checksum,14);
    local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(bytes.length,22); local.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
    central.writeUInt16LE(0x800,8); central.writeUInt16LE(8,10); central.writeUInt16LE(33,14);
    central.writeUInt32LE(checksum,16); central.writeUInt32LE(compressed.length,20); central.writeUInt32LE(bytes.length,24);
    central.writeUInt16LE(filename.length,28); central.writeUInt32LE(offset,42);
    body.push(local,filename,compressed); directory.push(central,filename);
    offset += local.length + filename.length + compressed.length;
  }
  const catalog = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(catalog.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...body,catalog,end]);
}
const pack = collect(path.join(root, 'objcubed'));
if (!pack.some(f => f.name === 'pack.mcmeta')) throw Error('Resource-pack root metadata missing');
const metadata = JSON.parse(pack.find(f => f.name === 'pack.mcmeta').bytes);
if (JSON.stringify(metadata.pack.min_format) !== '[97,1]' || JSON.stringify(metadata.pack.max_format) !== '[97,1]') throw Error('Expected 26.3 resource format 97.1');
for (const file of pack) {
  if (/portable|bvh|opengl.compat|OPENGL.MODELS/i.test(file.name)) throw Error(`Unexpected converted-renderer asset: ${file.name}`);
}
const originalZip = path.join(root, 'audit/2026-09-28/release-26.2.zip');
if (fs.existsSync(originalZip) && sha(fs.readFileSync(originalZip)) !== originalZipSha256) throw Error('Original release archive hash mismatch');
const plugin = content(path.join(root, 'objcubed.js'));
const carrierBlocks = [...plugin.toString('utf8').matchAll(/\/\/ BEGIN GENERATED EQUIPMENT CARRIERS\s+const EQUIPMENT_CARRIERS\s*=\s*([\s\S]*?);\s*\/\/ END GENERATED EQUIPMENT CARRIERS/g)];
if (carrierBlocks.length !== 1) throw Error('Expected exactly one generated equipment carriers block in objcubed.js.');
const carriers = JSON.parse(fs.readFileSync(path.join(root, 'tools/equipment-carriers.json'), 'utf8'));
if (!isDeepStrictEqual(JSON.parse(carrierBlocks[0][1]), carriers))
  throw Error('Embedded equipment carriers catalog does not match tools/equipment-carriers.json. Run node tools/sync-equipment-carriers.mjs before building.');
const readme = documentContent(path.join(root, 'docs/README_RU.md'));
const license = content(path.join(root, 'LICENSE'));
const files = [
  {name:`${release}.js`,bytes:plugin},
  {name:'README-RU.md',bytes:readme},{name:'LICENSE',bytes:license},
];
for (const name of ['GPU_VERIFICATION_2026-09-28.md', 'LIVE_VERIFICATION_2026-09-28.md', 'BLOCKBENCH_COMPATIBILITY_2026-09-28.md', 'EMISSIVE_COLOR_VERIFICATION_2026-09-29.md', 'TEXTURE_ANIMATION_VERIFICATION_2026-09-29.md', 'ANIMAL_EQUIPMENT_RU.md', 'ANIMAL_EQUIPMENT_VERIFICATION_2026-09-29.md', 'TEMPLATE_VERIFICATION_2026-09-29.md', 'HORSE_EQUIPMENT_RU.md', 'HORSE_EQUIPMENT_VERIFICATION_2026-09-29.md']) {
  const file = path.join(root, 'docs', name);
  if (fs.existsSync(file)) files.push({name,bytes:documentContent(file)});
}
// Keep the upstream license with the shaders; plugin and docs stay separate.
const entries = [...pack, {name:'LICENSE',bytes:license}];
const packZip = zip(entries);
const provenance = Buffer.from(JSON.stringify({
  distribution:release, minecraft:'26.3', resourceFormat:[97,1], baselineCommit:baseline,
  upstream:'https://github.com/JagerMeistars/obj-cubed', originalReleaseArchiveSha256:originalZipSha256,
  purpose:'obj³ Blockbench plugin and resource pack updated for Minecraft 26.3.',
  packaging:'Sorted ZIP entries; fixed 1980-01-01 date; UTF-8 text normalized to LF; documentation links README_RU.md rewritten to the published README-RU.md; binary bytes preserved; deflate level 9.',
  plugin:{file:`${release}.js`,sha256:sha(plugin)},
  resourcePack:{file:`${release}.zip`,sha256:sha(packZip),files:entries.map(f => ({path:f.name,bytes:f.bytes.length,sha256:sha(f.bytes)}))},
  validation:'Build integrity only. Rendering/FPS status must come from the separate runtime validation report.',
},null,2)+'\n');
files.push({name:`${release}.zip`,bytes:packZip},{name:'provenance.json',bytes:provenance});
fs.mkdirSync(destination,{recursive:true});
for (const file of files) {
  const filePath = path.join(destination,file.name);
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  fs.writeFileSync(filePath,file.bytes);
}
console.log(JSON.stringify({directory:destination,files:files.map(f => ({name:f.name,bytes:f.bytes.length,sha256:sha(f.bytes)}))},null,2));
