import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandShader, includePath } from '../helpers/shader-includes.mjs';

let temporary;
let pack;
let vanilla;
function include(root, resource, source) {
  const [namespace, name] = resource.split(':');
  const file = path.join(root, 'assets', namespace, 'shaders/include', name);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, source);
  return file;
}
beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'objcubed-includes-'));
  pack = path.join(temporary, 'pack');
  vanilla = path.join(temporary, 'vanilla');
});
afterEach(() => fs.rmSync(temporary, {recursive: true, force: true}));

describe('Minecraft shader include resolution', () => {
  it('uses the resource namespace and overrides vanilla with the pack', () => {
    include(vanilla, 'minecraft:test.glsl', 'vanilla');
    const override = include(pack, 'minecraft:test.glsl', 'override');
    const custom = include(pack, 'custom:test.glsl', 'custom namespace');
    expect(includePath('minecraft:test.glsl', [pack, vanilla])).toBe(override);
    expect(includePath('custom:test.glsl', [pack, vanilla])).toBe(custom);
  });

  it('falls back to vanilla and accepts an assets directory', () => {
    const fallback = include(vanilla, 'minecraft:test.glsl', 'vanilla');
    expect(includePath('minecraft:test.glsl', [pack, path.join(vanilla, 'assets')])).toBe(fallback);
  });

  it('keeps an include repeated after a disabled branch for the GLSL preprocessor', () => {
    include(vanilla, 'minecraft:shared.glsl', '#ifndef SHARED\n#define SHARED\nfloat sharedValue;\n#endif');
    const source = include(pack, 'minecraft:entry.glsl', '#if 0\n#include <minecraft:shared.glsl>\n#endif\n#include <minecraft:shared.glsl>');
    const result = expandShader(source, [pack, vanilla]);
    expect(result.match(/float sharedValue;/g)).toHaveLength(2);
    expect(result).toMatch(/^#if 0\n/);
    expect(result).not.toMatch(/^\s*#include/m);
  });

  it('rejects traversal and reports unresolved resources', () => {
    expect(() => includePath('minecraft:../private.glsl', [pack])).toThrow('Invalid shader resource location');
    expect(() => includePath('minecraft:missing.glsl', [pack])).toThrow('Unresolved shader include <minecraft:missing.glsl>');
  });
});
