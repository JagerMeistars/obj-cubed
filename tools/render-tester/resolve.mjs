// Resolve Minecraft shader imports using the same resource-pack precedence and
// conditional-include behavior as the compiler validation suite.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandShader } from '../../test/helpers/shader-includes.mjs';

const [entry, output, vanillaArgument] = process.argv.slice(2);
const vanilla = vanillaArgument || process.env.MC_VANILLA_ASSETS;
if (!entry || !output || !vanilla) {
  throw new Error('Usage: node tools/render-tester/resolve.mjs <entry> <output> <extracted-26.3-client-or-assets-dir>');
}
const pack = resolve(dirname(fileURLToPath(import.meta.url)), '../../objcubed');
const flat = expandShader(entry, [pack, vanilla]);
writeFileSync(output, flat);
console.log(`Resolved ${entry} -> ${output} (${flat.split('\n').length} lines)`);
