#!/usr/bin/env node
// Prepare exported models for the portable renderer without changing the source.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildBvhPack} from './portable-renderer/build-bvh.mjs';
import {buildArmorBoundsPack} from './portable-renderer/build-armor-bounds.mjs';
import {buildArmorVertexPack} from './portable-renderer/build-armor-vertices.mjs';
import {buildArmorBvhPack} from './portable-renderer/build-armor-bvh.mjs';

export function preparePortableModels(source, destination) {
  source=fs.realpathSync(source);
  const requested=path.resolve(destination);
  destination=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
  if(fs.existsSync(destination)) throw Error('Destination must be a new directory');
  if(destination.startsWith(source+path.sep)) throw Error('Destination cannot be inside source');
  const scratch=fs.mkdtempSync(path.join(path.dirname(destination),'.portable-models-'));
  try {
    const items=buildBvhPack(source,path.join(scratch,'items'),{validateRays:128});
    const armor=buildArmorBoundsPack(path.join(scratch,'items'),path.join(scratch,'bounds'));
    const vertices=buildArmorVertexPack(path.join(scratch,'bounds'),path.join(scratch,'vertices'));
    const armorBvh=buildArmorBvhPack(path.join(scratch,'vertices'),path.join(scratch,'ready'));
    // Keep manifests portable: do not ship local workspace or temporary paths.
    for(const [file,manifest] of [['portable-bvh-manifest.json',items],['portable-armor-bounds-manifest.json',armor],['portable-armor-vertices-manifest.json',vertices],['portable-armor-bvh-manifest.json',armorBvh]]) {
      manifest.source=path.basename(source);manifest.destination=path.basename(destination);
      fs.writeFileSync(path.join(scratch,'ready',file),JSON.stringify(manifest,null,2)+'\n');
    }
    fs.renameSync(path.join(scratch,'ready'),destination);
    return {destination,items:items.converted.length,armorBoundedLayers:armor.converted.length,armorVertexLayers:vertices.converted.length,armorBvhGroups:armorBvh.converted.length};
  } finally { fs.rmSync(scratch,{recursive:true,force:true}); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [source,destination,...extra]=process.argv.slice(2);
  if(!source||!destination||extra.length) throw Error('Usage: node tools/prepare-portable-models.mjs SOURCE_PACK NEW_DESTINATION');
  console.log(JSON.stringify(preparePortableModels(source,destination),null,2));
}
