#!/usr/bin/env node
// Add an experimental stackless BVH to opaque exported item models. Source is
// never modified. See build-bvh.md for the on-texture ABI and limitations.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';

const INTERNAL = 0xffffff;
const u24 = (data, i) => data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
function put24(data, i, value) {
  if (!Number.isInteger(value) || value < 0 || value > INTERNAL) throw new Error(`RGB24 overflow: ${value}`);
  data[i] = value >>> 16; data[i + 1] = value >>> 8; data[i + 2] = value; data[i + 3] = 255;
}
function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(e => {
    const p = path.join(directory, e.name);
    if (e.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${p}`);
    return e.isDirectory() ? files(p) : [p];
  });
}
export function readEncodedGeometryInfo(png, markerAlpha = 255) {
  const d = png.data;
  if (d[0] !== 12 || d[1] !== 34 || d[2] !== 56 || d[3] !== markerAlpha) return null;
  const width = d[4] * 256 + d[5];
  const textureHeight = d[6] * 256 + d[28];
  const vertices = d[8] * 16777216 + d[9] * 65536 + d[10] * 256 + d[29];
  const frames = Math.max(1, u24(d, 12));
  const textures = Math.max(1, d[15]);
  const positionHeight = d[20] * 256 + d[21];
  const uvHeight = d[22] * 256 + d[30];
  const faces = vertices / 4;
  const textureRow = 2 + Math.ceil(faces / width);
  const positionRow = textureRow + textureHeight * textures;
  const indexRow = positionRow + positionHeight + uvHeight;
  if (width !== png.width || !vertices || vertices % 4 || !textureHeight ||
      indexRow * width + vertices * frames * 2 > width * png.height || faces >= INTERNAL) {
    throw new Error('Invalid or unsupported exported item dimensions');
  }
  return {width, height: png.height, textureHeight, vertices, frames, textures,
    faces, textureRow, positionRow, positionHeight, uvHeight, indexRow,
    easing: (d[19] >> 4) & 3};
}
export function decodePositions(png, info) {
  const {width, positionRow, positionHeight, indexRow, vertices, frames} = info;
  const result = new Float32Array(vertices * frames * 3);
  for (let v = 0; v < vertices * frames; v++) {
    const p = u24(png.data, 4 * (indexRow * width + v * 2));
    if (p * 3 + 2 >= positionHeight * width) throw new Error(`Position index out of range at vertex ${v}`);
    for (let a = 0; a < 3; a++) result[v * 3 + a] = u24(png.data, 4 * (positionRow * width + p * 3 + a)) / 65536 - 128;
  }
  return result;
}
function outward(value, upper) {
  const encoded = (upper ? Math.ceil : Math.floor)((value + 256) * 32768);
  if (encoded < 0 || encoded > INTERNAL) throw new Error(`BVH bound exceeds fixed24 range: ${value}`);
  return encoded / 32768 - 256;
}
export function faceBounds(positions, info) {
  const {faces, vertices, frames} = info;
  const bounds = new Array(faces);
  for (let face = 0; face < faces; face++) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let frame = 0; frame < frames; frame++) for (let corner = 0; corner < 4; corner++) for (let a = 0; a < 3; a++) {
      const at = f => positions[((f % frames) * vertices + face * 4 + corner) * 3 + a];
      const b = at(frame), c = at(frame + 1);
      // The Bezier convex hull contains the complete Catmull–Rom segment,
      // including overshoot. Also conservative if easing changes after export.
      const c1 = b + (c - at(frame + frames - 1)) / 6;
      const c2 = c - (at(frame + 2) - b) / 6;
      min[a] = Math.min(min[a], b, c1, c2); max[a] = Math.max(max[a], b, c1, c2);
    }
    for (let a = 0; a < 3; a++) {
      // Allow arithmetic error in float32 interpolation, in addition to
      // rounding the stored bounds outward. This also gives flat faces volume.
      const margin = Math.max(1, Math.abs(min[a]), Math.abs(max[a])) * 2 ** -19;
      min[a] = outward(min[a] - margin, false); max[a] = outward(max[a] + margin, true);
    }
    bounds[face] = {min, max};
  }
  return bounds;
}
export function buildNodes(bounds) {
  const nodes = [];
  let depth = 0;
  function visit(ids, level) {
    depth = Math.max(depth, level);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const id of ids) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], bounds[id].min[a]); max[a] = Math.max(max[a], bounds[id].max[a]);
    }
    const node = {min, max, skip: 0, face: ids.length === 1 ? ids[0] : INTERNAL};
    nodes.push(node);
    if (ids.length > 1) {
      const cmin = [Infinity, Infinity, Infinity], cmax = [-Infinity, -Infinity, -Infinity];
      for (const id of ids) for (let a = 0; a < 3; a++) {
        const c = bounds[id].min[a] + bounds[id].max[a];
        cmin[a] = Math.min(cmin[a], c); cmax[a] = Math.max(cmax[a], c);
      }
      let axis = 0;
      for (let a = 1; a < 3; a++) if (cmax[a] - cmin[a] > cmax[axis] - cmin[axis]) axis = a;
      ids.sort((a, b) => bounds[a].min[axis] + bounds[a].max[axis] - bounds[b].min[axis] - bounds[b].max[axis] || a - b);
      const mid = ids.length >> 1;
      visit(ids.slice(0, mid), level + 1); visit(ids.slice(mid), level + 1);
    }
    node.skip = nodes.length;
  }
  visit(bounds.map((_, i) => i), 1);
  if (nodes.length >= INTERNAL) throw new Error('BVH node count exceeds RGB24');
  return {nodes, depth};
}
export function buildSegmentBounds(positions, info, nodes) {
  const data = Buffer.alloc(info.frames*nodes.length*8);
  for (let frame=0;frame<info.frames;frame++) {
    const decoded = new Float64Array(nodes.length*6);
    for (let i=nodes.length-1;i>=0;i--) {
      const node=nodes[i], min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      if(node.face!==INTERNAL) {
        for(let corner=0;corner<4;corner++)for(let a=0;a<3;a++) {
          const at=f=>positions[((f%info.frames)*info.vertices+node.face*4+corner)*3+a];
          const p=at(frame),p1=at(frame+1),p2=at(frame+2),p3=at(frame+3);
          const values=info.easing===0?[p]:info.easing<3?[p,p1]:[p1,p1+(p2-p)/6,p2-(p3-p1)/6,p2];
          min[a]=Math.min(min[a],...values);max[a]=Math.max(max[a],...values);
        }
        for(let a=0;a<3;a++) {
          const margin=Math.max(1,Math.abs(min[a]),Math.abs(max[a]))*2**-19;
          min[a]-=margin;max[a]+=margin;
        }
      } else {
        // Children are already quantized. Including their decoded bounds keeps
        // the compressed hierarchy nested despite independent byte rounding.
        const left=i+1,right=nodes[left].skip;
        for(let a=0;a<3;a++) {
          min[a]=Math.min(decoded[left*6+a],decoded[right*6+a]);
          max[a]=Math.max(decoded[left*6+3+a],decoded[right*6+3+a]);
        }
      }
      const offset=(frame*nodes.length+i)*8;
      for(let a=0;a<3;a++) {
        const lo=node.min[a],range=node.max[a]-lo;
        if(min[a]<lo-1e-10||max[a]>node.max[a]+1e-10)throw Error('Segment bounds escape global node');
        const low=Math.max(0,Math.floor((min[a]-lo)/range*255));
        const high=Math.min(255,Math.ceil((max[a]-lo)/range*255));
        data[offset+a]=low;data[offset+4+a]=high;
        decoded[i*6+a]=lo+range*low/255;
        decoded[i*6+3+a]=lo+range*high/255;
        if(decoded[i*6+a]>min[a]+1e-12||decoded[i*6+3+a]<max[a]-1e-12)throw Error('Inward segment quantization');
      }
      data[offset+3]=data[offset+7]=255;
    }
  }
  return data;
}
function appendNodes(png, nodes, padPowerOfTwo, segmentData) {
  const startRow = png.height;
  const segmentRow=startRow+Math.ceil(nodes.length*8/png.width);
  const needed = segmentRow+(segmentData?Math.ceil(segmentData.length/4/png.width):0);
  const height = padPowerOfTwo ? 2 ** Math.ceil(Math.log2(needed)) : Math.ceil(needed/16)*16;
  const out = new PNG({width: png.width, height});
  png.data.copy(out.data);
  put24(out.data, 16 * 4, startRow); put24(out.data, 17 * 4, nodes.length); put24(out.data, 18 * 4, png.height);
  // All data texels remain opaque: the GUI atlas premultiplies translucent RGB.
  out.data.set([66,86,72,255],19*4);
  if(segmentData) {
    out.data.set([66,70,49,255],20*4);
    put24(out.data,21*4,segmentRow);
    segmentData.copy(out.data,segmentRow*png.width*4);
  }
  for (let i = 0; i < nodes.length; i++) {
    const offset = (startRow * png.width + i * 8) * 4, n = nodes[i];
    for (let a = 0; a < 3; a++) {
      put24(out.data, offset + a * 4, Math.round((n.min[a]+256)*32768));
      put24(out.data, offset + (a+3) * 4, Math.round((n.max[a]+256)*32768));
    }
    put24(out.data, offset + 24, n.skip); put24(out.data, offset + 28, n.face);
  }
  return out;
}
function readNodes(png, startRow, count) {
  return Array.from({length: count}, (_, i) => {
    const o = (startRow * png.width + i * 8) * 4;
    return {min: [0, 1, 2].map(a => u24(png.data,o+a*4)/32768-256),
      max: [3, 4, 5].map(a => u24(png.data,o+a*4)/32768-256),
      skip: u24(png.data, o + 24), face: u24(png.data, o + 28)};
  });
}
function readSegmentNodes(png,nodes,frame) {
  const row=u24(png.data,21*4);
  return nodes.map((node,i)=>{
    const offset=(row*png.width+(frame*nodes.length+i)*2)*4;
    return {...node,min:node.min.map((lo,a)=>lo+(node.max[a]-lo)*png.data[offset+a]/255),
      max:node.min.map((lo,a)=>lo+(node.max[a]-lo)*png.data[offset+4+a]/255)};
  });
}
function pose(positions, info, frame, t, mode) {
  const out = new Float64Array(info.vertices * 3);
  const stride = out.length, count = info.frames;
  for (let i = 0; i < stride; i++) {
    const at = f => positions[(f % count) * stride + i];
    const b = at(frame), c = at(frame + 1);
    if (mode === 0) out[i] = b;
    else if (mode === 1 || mode === 2) {
      const u=mode===1?t:t<.5?4*t*t*t:1-((-2*t+2)**3)/2;
      out[i] = b + (c - b) * u;
    }
    else {
      const p2=at(frame+2),p3=at(frame+3),s=1-t;
      out[i]=s*s*s*c+3*s*s*t*(c+(p2-b)/6)+3*s*t*t*(p2-(p3-c)/6)+t*t*t*p2;
    }
  }
  return out;
}
function triangle(ray, p, a, b, c) {
  a *= 3; b *= 3; c *= 3;
  const e1 = [p[b]-p[a], p[b+1]-p[a+1], p[b+2]-p[a+2]];
  const e2 = [p[c]-p[a], p[c+1]-p[a+1], p[c+2]-p[a+2]];
  const cross = (u,v) => [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const dot = (u,v) => u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
  const h = cross(ray.d,e2), det = dot(e1,h);
  if (Math.abs(det) < 1e-12) return Infinity;
  const s = [ray.o[0]-p[a],ray.o[1]-p[a+1],ray.o[2]-p[a+2]], u = dot(s,h)/det;
  if (u < -1e-10 || u > 1+1e-10) return Infinity;
  const q = cross(s,e1), v = dot(ray.d,q)/det;
  if (v < -1e-10 || u+v > 1+1e-10) return Infinity;
  const t = dot(e2,q)/det;
  return t >= 0 ? t : Infinity;
}
function boxHit(ray, node, nearest) {
  let near = 0, far = nearest;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ray.d[a]) < 1e-30) { if (ray.o[a] < node.min[a] || ray.o[a] > node.max[a]) return false; }
    else {
      const x = (node.min[a]-ray.o[a])/ray.d[a], y = (node.max[a]-ray.o[a])/ray.d[a];
      near = Math.max(near, Math.min(x,y)); far = Math.min(far, Math.max(x,y));
      if (near > far) return false;
    }
  }
  return true;
}
function validate(positions, info, nodes, rays, segmentPng=null) {
  let seed = 0x5eed1234;
  const random = () => {seed ^= seed << 13;seed ^= seed >>> 17;seed ^= seed << 5;return (seed >>> 0)/4294967296;};
  const byFace = new Array(info.faces);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.skip <= i || n.skip > nodes.length) throw new Error('Invalid BVH skip');
    if (n.face !== INTERNAL) { if (byFace[n.face]) throw new Error('Duplicate leaf'); byFace[n.face] = n; }
    else for (let c = i+1; c < n.skip; c = nodes[c].skip) for (let a = 0; a < 3; a++) {
      if (nodes[c].min[a] < n.min[a] || nodes[c].max[a] > n.max[a]) throw new Error('Child escapes parent');
    }
  }
  if (byFace.filter(Boolean).length !== info.faces) throw new Error('Missing BVH leaves');
  for (let f = 0; f < info.frames; f++) for (let v = 0; v < info.vertices; v++) for (let a = 0; a < 3; a++) {
    const n = byFace[v >> 2], p = positions[(f*info.vertices+v)*3+a];
    if (p < n.min[a] || p > n.max[a]) throw new Error('Encoded frame escapes leaf');
  }
  const root = nodes[0];
  const center = root.min.map((v,a) => (v+root.max[a])/2);
  const radius = Math.max(...root.max.map((v,a) => v-root.min[a]), 1);
  let visits = 0, leafTests = 0, hits = 0,globalVisits=0,globalLeafTests=0;
  const selectedFrames=[];
  const poses = Array.from({length: 12}, (_,i) => {
    const frame=Math.floor(random()*info.frames);selectedFrames.push(frame);
    return pose(positions, info, frame, random(), segmentPng?info.easing:i%4);
  });
  const selectedNodes=selectedFrames.map(frame=>segmentPng?readSegmentNodes(segmentPng,nodes,frame):nodes);
  // Bounds checks cover random Catmull/linear samples independently of the rays.
  for (let k=0;k<poses.length;k++) {
    const leaves=[];for(const n of selectedNodes[k])if(n.face!==INTERNAL)leaves[n.face]=n;
    for (let v = 0; v < info.vertices; v++) for (let a = 0; a < 3; a++) {
      const n = leaves[v >> 2],p=poses[k]; if (p[v*3+a] < n.min[a] || p[v*3+a] > n.max[a]) throw new Error('Interpolated geometry escapes leaf');
    }
  }
  for (let r = 0; r < rays; r++) {
    const p = poses[r%poses.length],traversalNodes=selectedNodes[r%poses.length];
    const direction = [random()*2-1,random()*2-1,random()*2-1];
    const norm = Math.hypot(...direction);
    const origin = center.map((v,a) => v+direction[a]/norm*radius*2);
    // Most rays aim at an actual surface; the rest exercise misses.
    const f = Math.floor(random()*info.faces), c = f*12;
    const target = r%4 ? [0,1,2].map(a => (p[c+a]+p[c+3+a]+p[c+6+a]+p[c+9+a])/4) : center.map(v => v+(random()*2-1)*radius);
    const d = target.map((v,a) => v-origin[a]), length = Math.hypot(...d);
    const ray = {o:origin,d:d.map(v => v/length)};
    if (r%31 === 0) ray.d[r%3] = 0; // parallel slab boundaries
    const hitFace = face => Math.min(triangle(ray,p,face*4,face*4+1,face*4+2),triangle(ray,p,face*4+2,face*4+3,face*4));
    let brute = Infinity, found = Infinity;
    for (let face = 0; face < info.faces; face++) brute = Math.min(brute,hitFace(face));
    for (let i = 0; i < nodes.length;) {
      const n = traversalNodes[i]; visits++;
      if (!boxHit(ray,n,found)) i = n.skip;
      else { if (n.face !== INTERNAL) {leafTests++;found = Math.min(found,hitFace(n.face));} i++; }
    }
    if (found !== brute && (!Number.isFinite(found) || !Number.isFinite(brute) || Math.abs(found-brute) > 1e-7)) throw new Error(`BVH/brute-force mismatch ray ${r}: ${found}/${brute}`);
    if(segmentPng) {
      let globalFound=Infinity;
      for(let i=0;i<nodes.length;) {
        const n=nodes[i];globalVisits++;
        if(!boxHit(ray,n,globalFound))i=n.skip;
        else{if(n.face!==INTERNAL){globalLeafTests++;globalFound=Math.min(globalFound,hitFace(n.face));}i++;}
      }
      if(globalFound!==found&&Math.abs(globalFound-found)>1e-7)throw Error('Global and segment BVH differ');
    }
    if (Number.isFinite(found)) hits++;
  }
  return {rays, hits, mismatches:0, poses:poses.length, checkedFrameVertices:info.vertices*info.frames,
    meanNodeVisits:rays?visits/rays:0, meanLeafTests:rays?leafTests/rays:0,
    ...(segmentPng?{declaredEasing:info.easing,globalMeanNodeVisits:rays?globalVisits/rays:0,globalMeanLeafTests:rays?globalLeafTests/rays:0}:{})};
}
function resourceName(relative, type) {
  const parts = relative.split(path.sep);
  const suffix = parts.slice(3).join('/').replace(type === 'textures' ? /\.png$/ : /\.json$/, '');
  return `${parts[1]}:${suffix}`;
}
function resolveTexture(model, name) {
  const seen = new Set();
  while (name?.startsWith('#')) {
    if (seen.has(name)) return undefined;
    seen.add(name); name = model.textures?.[name.slice(1)];
  }
  return typeof name === 'string' ? (name.includes(':') ? name : `minecraft:${name}`) : undefined;
}
function carrierSignature(element) {
  const clone = structuredClone(element);
  for (const face of Object.values(clone.faces ?? {})) delete face.uv;
  return JSON.stringify(clone);
}
export function buildBvhPack(source, destination, {validateRays = 512, padPowerOfTwo = false, segmentBounds = true} = {}) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (!Number.isInteger(validateRays) || validateRays < 0) throw new Error('validateRays must be a nonnegative integer');
  if (!fs.existsSync(path.join(source,'pack.mcmeta'))) throw new Error('Source is not a resource pack directory');
  if (fs.existsSync(destination)) throw new Error('Destination must not exist');
  if (destination.startsWith(source+path.sep)) throw new Error('Destination cannot be inside source');
  const sourceFiles = files(source);
  const models = sourceFiles.filter(p => /[/\\]models[/\\].*\.json$/.test(p)).map(p => ({file:path.relative(source,p), model:JSON.parse(fs.readFileSync(p,'utf8'))}));
  const manifest = {format:'objcubed-portable-bvh-v1', source:path.basename(source), destination:path.basename(destination), padPowerOfTwo, segmentBounds, converted:[], skipped:[], models:[]};
  const changes = new Map();
  for (const filename of sourceFiles.filter(p => /[/\\]textures[/\\].*\.png$/.test(p))) {
    const relative = path.relative(source,filename), png = PNG.sync.read(fs.readFileSync(filename));
    const info = readEncodedGeometryInfo(png); if (!info) continue;
    const name = resourceName(relative,'textures');
    if(info.width<20){manifest.skipped.push({texture:name,reason:'texture width is too small for BVH header texels 16–19'});continue;}
    let transparent = 0;
    for (let p = info.textureRow*png.width; p < info.positionRow*png.width; p++) if (png.data[p*4+3] !== 255) transparent++;
    if (transparent) {manifest.skipped.push({texture:name,reason:'non-opaque texture pixels',pixels:transparent});continue;}
    const references = models.filter(({model}) => model.elements?.some(e => Object.values(e.faces??{}).some(f => resolveTexture(model,f.texture) === name)));
    // Only exporter-style standalone north carriers can safely be collapsed.
    const valid = references.length && references.every(({model}) => model.elements.length === info.faces && model.elements.every(e => {
      const face = e.faces?.north;
      return face && Object.keys(e.faces).length === 1 && resolveTexture(model,face.texture) === name && Array.isArray(face.uv) && face.uv.length === 4 && !face.rotation;
    }));
    if (!valid) {manifest.skipped.push({texture:name,reason:'no direct exporter-style model references, or mixed/custom carrier geometry'});continue;}
    if (references.some(({model}) => model.elements.some(e => carrierSignature(e) !== carrierSignature(model.elements[0])))) {
      manifest.skipped.push({texture:name,reason:'differing per-face carrier attributes (geometry, light_emission, tintindex, or other metadata)'});continue;
    }
    const positions = decodePositions(png,info), bounds = faceBounds(positions,info), {nodes,depth} = buildNodes(bounds);
    const segmentData=segmentBounds&&info.frames>1&&png.width>=22?buildSegmentBounds(positions,info,nodes):null;
    const expanded = appendNodes(png,nodes,padPowerOfTwo,segmentData);
    const encoded = PNG.sync.write(expanded);
    // Validate bytes after a PNG round trip, including outward fixed24 bounds.
    const roundTrip = PNG.sync.read(encoded);
    const validation = validate(positions,info,readNodes(roundTrip,png.height,nodes.length),validateRays);
    const segmentValidation=segmentData?validate(positions,info,readNodes(roundTrip,png.height,nodes.length),validateRays,roundTrip):null;
    const record = {texture:name,file:relative,width:png.width,oldHeight:png.height,newHeight:expanded.height,
      faces:info.faces,frames:info.frames,nodeCount:nodes.length,depth,bvhStartRow:png.height,
      oldRgbaBytes:png.width*png.height*4,newRgbaBytes:expanded.width*expanded.height*4,validation,
      segmentBounds:segmentData?{startRow:u24(roundTrip.data,21*4),bytes:segmentData.length,validation:segmentValidation}:null};
    changes.set(relative,encoded);manifest.converted.push(record);
    for (const reference of references) {
      const model = structuredClone(reference.model);model.elements = [model.elements[0]];
      for (const face of Object.values(model.elements[0].faces)) {face.uv[1] *= png.height/expanded.height;face.uv[3] *= png.height/expanded.height;}
      changes.set(reference.file,JSON.stringify(model));
      manifest.models.push({file:reference.file,texture:name,oldElements:reference.model.elements.length,newElements:1});
    }
  }
  // All validation completes before creating output. Copying also preserves any
  // unrelated or translucent resources unchanged.
  fs.cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});
  for (const [relative,data] of changes) fs.writeFileSync(path.join(destination,relative),data);
  fs.writeFileSync(path.join(destination,'portable-bvh-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let validateRays = 512;
  const powerOption = args.indexOf('--power-of-two');
  const padPowerOfTwo = powerOption !== -1;
  if (padPowerOfTwo) args.splice(powerOption,1);
  const segmentOption=args.indexOf('--no-segment-bounds');
  const segmentBounds=segmentOption===-1;
  if(!segmentBounds)args.splice(segmentOption,1);
  const option = args.indexOf('--validate-rays');
  if (option !== -1) {validateRays = Number(args[option+1]);args.splice(option,2);}
  if (args.length !== 2) throw new Error('Usage: node tools/portable-renderer/build-bvh.mjs SOURCE_PACK DEST_PACK [--validate-rays N] [--power-of-two] [--no-segment-bounds]');
  const result = buildBvhPack(args[0],args[1],{validateRays,padPowerOfTwo,segmentBounds});
  console.log(JSON.stringify(result,null,2));
}
