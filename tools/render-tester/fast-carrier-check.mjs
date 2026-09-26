// CPU-reference checks of the actual optional carrier includes on an EGL GPU.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const [kind, ...args] = process.argv.slice(2);
if (!['item', 'armor'].includes(kind)) throw new Error('Usage: node tools/render-tester/fast-carrier-check.mjs <item|armor> [--quick] [--stress]');
const directory = mkdtempSync(join(tmpdir(), 'objcubed-carrier-'));
try {
  const header = readFileSync(new URL('../opengl-compat/objmc_carrier.glsl', import.meta.url), 'utf8');
  const armor = readFileSync(new URL('../opengl-compat/objmc_armor_carrier.glsl', import.meta.url), 'utf8');
  const helper = join(directory, 'carrier.glsl');
  writeFileSync(helper, header.replace('#include <minecraft:objmc_armor_carrier.glsl>', armor));
  const binary = join(directory, 'check');
  const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'epoxy'], { encoding: 'utf8' }).trim().split(/\s+/);
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', fileURLToPath(new URL(`${kind}-carrier-oracle.c`, import.meta.url)), '-o', binary, ...flags, '-lm'], { stdio: 'inherit' });
  const options = ['--raster', ...(kind === 'item' ? ['--items-only', '--model-faces', '43', '--guard-faces', '16'] : [])];
  if (!args.includes('--stress')) options.push('--ordinary');
  execFileSync(binary, [helper, ...options, ...args.filter(v => v !== '--stress')], { stdio: 'inherit' });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
