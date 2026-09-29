import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = [];
function fixture(changeCatalog, changePlugin = source => source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obj3-release-catalog-'));
  fixtures.push(directory);
  for (const name of ['tools', 'docs', 'objcubed']) fs.mkdirSync(path.join(directory, name));
  fs.copyFileSync(path.join(root, 'tools/build-release.mjs'), path.join(directory, 'tools/build-release.mjs'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
  fs.copyFileSync(path.join(root, 'objcubed/pack.mcmeta'), path.join(directory, 'objcubed/pack.mcmeta'));
  fs.writeFileSync(path.join(directory, 'docs/README_RU.md'), '# Isolated packaging fixture\n');
  fs.writeFileSync(path.join(directory, 'objcubed.js'), changePlugin(fs.readFileSync(path.join(root, 'objcubed.js'), 'utf8')));
  let catalog = JSON.parse(fs.readFileSync(path.join(root, 'tools/equipment-carriers.json'), 'utf8'));
  if (changeCatalog) catalog = changeCatalog(catalog);
  fs.writeFileSync(path.join(directory, 'tools/equipment-carriers.json'), JSON.stringify(catalog, null, 2));
  const output = path.join(directory, 'output');
  return { output, build: () => execFileSync(process.execPath,
    [path.join(directory, 'tools/build-release.mjs'), output], { encoding: 'utf8', stdio: 'pipe' }) };
}
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('obj3-release-catalog-'))
      throw Error('Unexpected temporary release fixture path');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe('release embedded equipment catalog invariant', () => {
  it('packages the actual matching plugin and catalog', () => {
    const { build, output } = fixture();
    expect(() => build()).not.toThrow();
    expect(fs.existsSync(path.join(output, 'objcubed.zip'))).toBe(true);
    expect(fs.existsSync(path.join(output, 'objcubed.js'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8'));
    expect(manifest.resourcePack.files.map(file => file.path)).toEqual(['pack.mcmeta']);
  });

  it('compares structure rather than JSON whitespace or object key order', () => {
    const { build } = fixture(catalog => Object.fromEntries(Object.entries(catalog).reverse()));
    expect(() => build()).not.toThrow();
  });

  it('rejects one changed native carrier coordinate before writing a release', () => {
    const { build, output } = fixture(catalog => {
      catalog.horse_body.bindings.body.quads[0].q0[0] += 0.25;
      return catalog;
    });
    expect(() => build()).toThrow(/equipment carriers.*does not match/i);
    expect(fs.existsSync(output)).toBe(false);
  });

  it('rejects a missing generated block instead of silently skipping validation', () => {
    const { build, output } = fixture(null,
      source => source.replace('BEGIN GENERATED EQUIPMENT CARRIERS', 'BEGIN MISSING CATALOG MARKER'));
    expect(() => build()).toThrow(/generated equipment carriers block/i);
    expect(fs.existsSync(output)).toBe(false);
  });
});
