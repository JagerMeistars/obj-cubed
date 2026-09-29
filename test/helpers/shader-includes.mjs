import fs from 'node:fs';
import path from 'node:path';

const INCLUDE = /^([ \t]*)#(?:include|moj_import)\s*[<"]([^>"]+)[>"][ \t\r]*(?:\/\/[^\n]*)?$/gm;

// Resource packs override a resource location, not its basename. Accept either
// an extracted client root or its assets/ directory for the vanilla fallback.
export function assetsDirectory(root) {
  return path.basename(path.resolve(root)) === 'assets' ? path.resolve(root) : path.join(path.resolve(root), 'assets');
}

export function includePath(name, roots) {
  const parts = name.split(':');
  if (parts.length > 2) throw new Error(`Invalid shader resource location: ${name}`);
  const [namespace, resource] = parts.length === 1 ? ['minecraft', name] : parts;
  if (!/^[a-z0-9_.-]+$/.test(namespace) || !/^[a-z0-9_./-]+$/.test(resource) || resource.split('/').includes('..')) {
    throw new Error(`Invalid shader resource location: ${name}`);
  }
  for (const root of roots) {
    const file = path.join(assetsDirectory(root), namespace, 'shaders', 'include', resource);
    if (fs.existsSync(file)) return file;
  }
  throw new Error(`Unresolved shader include <${name}>; supply the Minecraft 26.3 client assets with --vanilla`);
}

export function expandShader(file, roots, stack = []) {
  const absolute = path.resolve(file);
  if (stack.includes(absolute)) throw new Error(`Recursive shader include: ${[...stack, absolute].join(' -> ')}`);
  return fs.readFileSync(absolute, 'utf8').replace(INCLUDE, (_match, indent, resource) => {
    const child = includePath(resource, roots);
    // Never globally deduplicate imports: the first appearance may be inside
    // a disabled #if branch. The GLSL preprocessor evaluates include guards.
    return `${indent}// begin <${resource}>\n${expandShader(child, roots, [...stack, absolute])}\n${indent}// end <${resource}>`;
  });
}

export function shaderIncludes(source) {
  return [...source.matchAll(INCLUDE)].map(match => match[2]);
}
