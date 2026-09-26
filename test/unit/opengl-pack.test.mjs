import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenGLPack } from '../../tools/build-opengl-pack.mjs';

const original = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../objcubed');
let temporary;
beforeEach(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'objcubed-opengl-')); });
afterEach(() => fs.rmSync(temporary, {recursive: true, force: true}));

describe('optional OpenGL compatibility pack generator', () => {
  it('copies the pack, labels the backend restriction, and changes only the generated shaders', () => {
    const sourceVertex = fs.readFileSync(path.join(original, 'assets/minecraft/shaders/core/item.vsh'), 'utf8');
    const output = buildOpenGLPack(original, path.join(temporary, 'pack'));
    const vertex = fs.readFileSync(path.join(output, 'assets/minecraft/shaders/core/item.vsh'), 'utf8');
    expect(vertex).toContain('#extension GL_ARB_shader_ballot : require');
    expect(vertex).toContain('#extension GL_ARB_gpu_shader_int64 : require');
    expect(vertex).not.toContain('#extension GL_KHR_shader_subgroup_');
    expect(fs.readFileSync(path.join(output, 'OPENGL-ONLY.txt'), 'utf8')).toContain('Do not use this pack with the Vulkan renderer');
    expect(JSON.parse(fs.readFileSync(path.join(output, 'pack.mcmeta'), 'utf8')).pack.description).toContain('[OPENGL ONLY]');
    expect(fs.readFileSync(path.join(original, 'assets/minecraft/shaders/core/item.vsh'), 'utf8')).toBe(sourceVertex);
    expect(fs.readFileSync(path.join(output, 'assets/minecraft/shaders/core/item.fsh'), 'utf8')).toBe(fs.readFileSync(path.join(original, 'assets/minecraft/shaders/core/item.fsh'), 'utf8'));
  });

  it('refuses the source directory and nested output', () => {
    expect(() => buildOpenGLPack(original, original)).toThrow('non-nested');
    expect(() => buildOpenGLPack(original, path.join(original, 'generated'))).toThrow('non-nested');
  });

  it('refuses an existing output without changing its contents', () => {
    const output = path.join(temporary, 'existing');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'keep.txt'), 'user data');
    expect(() => buildOpenGLPack(original, output)).toThrow('Refusing to overwrite');
    expect(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8')).toBe('user data');
  });

  it('resolves symlinked output parents before checking source overlap', () => {
    const alias = path.join(temporary, 'alias');
    fs.symlinkSync(original, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => buildOpenGLPack(original, path.join(alias, 'generated'))).toThrow('non-nested');
  });
});
