// Resolve Minecraft `#moj_import` directives into a single flat GLSL string so the
// real obj³ core shaders can be compiled by a plain GL driver (the render-tester).
// Search paths:
//   #moj_import <minecraft:NAME>  -> MC's extracted include dir
//   #moj_import <NAME>            -> our pack's shaders/include dir
// Nested `#version` lines are stripped (only the entry file's version survives).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PACK_INC = '/home/jagermestars/.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances/26.1.2/minecraft/resourcepacks/objcubed-work/objcubed/assets/minecraft/shaders/include';
const MC_INC = '/tmp/mcgeom/mcsh/assets/minecraft/shaders/include';

function resolveFile(path, seen, depth) {
    if (seen.has(path)) return '';          // include-once
    seen.add(path);
    const src = readFileSync(path, 'utf8');
    const out = [];
    for (const line of src.split('\n')) {
        const m = line.match(/^\s*#moj_import\s*[<"]([^>"]+)[>"]/);
        if (m) {
            const ref = m[1];
            const inc = ref.includes(':')
                ? join(MC_INC, ref.split(':')[1])
                : join(PACK_INC, ref);
            out.push(`// >>> ${ref}`);
            out.push(resolveFile(inc, seen, depth + 1));
            out.push(`// <<< ${ref}`);
        } else if (depth > 0 && /^\s*#version\b/.test(line)) {
            // drop nested #version (keep only the entry file's)
            out.push('// ' + line.trim());
        } else {
            out.push(line);
        }
    }
    return out.join('\n');
}

const entry = process.argv[2];
const outPath = process.argv[3];
const flat = resolveFile(entry, new Set(), 0);
writeFileSync(outPath, flat);
console.log(`resolved ${entry} -> ${outPath} (${flat.split('\n').length} lines)`);
// quick check: any unresolved imports left?
const left = flat.split('\n').filter(l => /#moj_import/.test(l));
console.log(left.length ? `UNRESOLVED: ${left.join(' | ')}` : 'all imports resolved');
