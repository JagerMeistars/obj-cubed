// Run with the current EGL driver, or select Mesa with its EGL vendor variable.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const source = readFileSync(new URL('../../objcubed/assets/minecraft/shaders/include/objmc_tools.glsl', import.meta.url), 'utf8');
const begin = source.indexOf('vec3 getpos(');
const end = source.indexOf('vec2 getuv(', begin);
if (begin < 0 || end <= begin) throw new Error('Cannot find the resource-pack position decoder');
const directory = mkdtempSync(join(tmpdir(), 'objcubed-coordinate-'));
try {
  const vertex = join(directory, 'position.vert');
  const binary = join(directory, 'check');
  writeFileSync(vertex, `#version 330
uniform sampler2D Sampler0;
out vec3 decoded;
${source.slice(begin, end)}
void main() {
    decoded = getpos(ivec2(0), 768, 0, gl_VertexID);
    gl_Position = vec4(0, 0, 0, 1);
}
`);
  const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'epoxy'], { encoding: 'utf8' }).trim().split(/\s+/);
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('coordinate-decode.c', import.meta.url)), '-o', binary, ...flags, '-lm'], { stdio: 'inherit' });
  execFileSync(binary, [vertex], { stdio: 'inherit' });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
