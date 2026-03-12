(function () {
    'use strict';

    const PLUGIN_ID = 'objcubed';

    // =========================================================
    // Constants
    // =========================================================

    // =========================================================
    // Plugin Registration
    // =========================================================
    BBPlugin.register(PLUGIN_ID, {
        title: 'obj³',
        author: 'JagerMeistars, fork of Godlander\'s objmc',
        description: 'Export the current model with obj³ encoding for Minecraft resource packs',
        icon: 'icon',
        version: '0.1.0',
        min_version: '4.8.0',
        variant: 'desktop',
        onload() {
            this.exportAction = new Action(PLUGIN_ID + '_export', {
                name: 'Export as obj³…',
                description: 'Encode current model + texture into objcubed format',
                icon: 'icon',
                click: showDialog,
            });
            MenuBar.addAction(this.exportAction, 'file.export');
        },
        onunload() {
            if (this.exportAction) this.exportAction.delete();
        },
    });

    // =========================================================
    // Section 1: PNG Encoder (Node.js zlib — bypasses canvas premultiplied alpha)
    // =========================================================
    function encodePNG(width, height, rgbaUint8) {
        const zlib = require('zlib');
        const crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c;
        }
        function crc32(buf) {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        }
        function chunk(type, data) {
            const tBuf = Buffer.from(type, 'ascii');
            const dBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(dBuf.length, 0);
            const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, dBuf])), 0);
            return Buffer.concat([lenBuf, tBuf, dBuf, crcBuf]);
        }
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
        ihdr[8] = 8; ihdr[9] = 6;
        const src = Buffer.isBuffer(rgbaUint8) ? rgbaUint8 : Buffer.from(rgbaUint8.buffer || rgbaUint8);
        const scanLen = 1 + width * 4;
        const raw = Buffer.alloc(height * scanLen, 0);
        for (let y = 0; y < height; y++) {
            raw[y * scanLen] = 0;
            src.copy(raw, y * scanLen + 1, y * width * 4, (y + 1) * width * 4);
        }
        const idat = zlib.deflateSync(raw, { level: 6 });
        return Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
        ]);
    }

    // =========================================================
    // Section 3: Animation Baking
    // =========================================================
    // Strategy: write animated world-space positions into mesh.vertices, call
    // Codecs.obj.compile() (which reads mesh.vertices), then restore.
    //
    // Uses DELTA matrix: delta = frameMatrix * inv(restMatrix).
    // At frameStart the delta is identity → frame 0 matches static export exactly.
    // Any constant scene scale in BB's THREE.js root cancels out.
    async function compileAnimatedObjFrames(anim, opts) {
        // compileAnimatedObjFrames v4
        const fps        = opts.fps        || anim.snapping || 20;
        const frameStart = opts.frameStart != null ? opts.frameStart : 0;
        const frameEnd   = opts.frameEnd   != null ? opts.frameEnd   : anim.length;
        const nframes    = Math.max(1, Math.floor((frameEnd - frameStart) * fps) + 1);
        const filterArm  = !!opts.filterArmature;
        const filterGroups = filterArm ? collectBoneUUIDs() : null;


        // Save original (rest-pose) vertex positions
        const savedVertices = new Map();
        for (const mesh of Mesh.all)
            savedVertices.set(mesh.uuid, JSON.parse(JSON.stringify(mesh.vertices)));

        // Collect armature bones and build per-vertex weight influences.
        // Try Armature class first, then fall back to outliner scan by type string.
        const allBones = [];
        if (filterArm) {
            if (typeof Armature !== 'undefined' && Armature.all) {
                for (const arm of Armature.all)
                    for (const bone of arm.getAllBones()) allBones.push(bone);
            } else {
                // Fallback: walk outliner for elements with type 'armature_bone'
                (function findBones(children) {
                    for (const el of (children || [])) {
                        if ((el.type || '').toLowerCase() === 'armature_bone' && el.vertex_weights)
                            allBones.push(el);
                        if (el.children) findBones(el.children);
                    }
                })(Outliner.root);
            }
        }

        // Capture rest matrices using frame 0 of the animation as reference.
        // We select the animation first, go to frameStart, and capture bone
        // matrices there. This ensures consistent rest reference even if a
        // previous export left bones at the last animated frame.
        const savedTime = Timeline.time;
        const boneRestInverses = new Map();
        const meshRestWorlds = new Map();
        const restInverses = new Map(); // rigid parent-bone path

        // Save bone local transforms for restoration after export
        const savedBoneLocal = new Map();
        for (const bone of allBones) {
            if (!bone.mesh) continue;
            savedBoneLocal.set(bone.uuid, {
                p: bone.mesh.position.clone(),
                q: bone.mesh.quaternion.clone(),
                s: bone.mesh.scale.clone(),
            });
        }

        // Compute bone rest world matrices from static BB properties (bone.origin + bone.rotation)
        // by chaining through the BB outliner parent hierarchy.
        // We cannot use bone.mesh.matrixWorld because:
        //   1) Animation preview may be active, contaminating bone transforms
        //   2) Three.js hierarchy is nested (child bones under parent bones),
        //      so matrixWorld includes animated parent bone transforms
        if (allBones.length > 0) {
            const DEG2RAD = Math.PI / 180;
            const boneRestWorldMap = new Map(); // uuid → Matrix4
            const boneSet = new Set(allBones.map(b => b.uuid));

            // Get armature world matrix from a root bone's Three.js parent.
            // The armature itself doesn't animate, so this is stable.
            let armatureWorld = null;
            for (const bone of allBones) {
                if (!bone.mesh) continue;
                // Walk up BB outliner to find a root bone (no bone parent)
                let p = bone;
                while (p.parent && boneSet.has(p.parent.uuid)) p = p.parent;
                // p is now a root bone; its Three.js mesh parent is the armature
                if (p.mesh && p.mesh.parent) {
                    p.mesh.parent.updateWorldMatrix(true, false);
                    armatureWorld = new THREE.Matrix4().copy(p.mesh.parent.matrixWorld);
                    break;
                }
            }

            function getBoneRestWorld(bone) {
                if (boneRestWorldMap.has(bone.uuid)) return boneRestWorldMap.get(bone.uuid);
                const origin = bone.origin || [0, 0, 0];
                const rotation = bone.rotation || [0, 0, 0];
                const restLocal = new THREE.Matrix4();
                restLocal.makeRotationFromEuler(new THREE.Euler(
                    rotation[0] * DEG2RAD, rotation[1] * DEG2RAD, rotation[2] * DEG2RAD
                ));
                restLocal.setPosition(origin[0], origin[1], origin[2]);

                // Find parent bone in BB outliner hierarchy
                let parentBone = null;
                let pp = bone.parent;
                while (pp) {
                    if (boneSet.has(pp.uuid)) { parentBone = pp; break; }
                    pp = pp.parent;
                }

                const restWorld = new THREE.Matrix4();
                if (parentBone) {
                    restWorld.multiplyMatrices(getBoneRestWorld(parentBone), restLocal);
                } else if (armatureWorld) {
                    restWorld.multiplyMatrices(armatureWorld, restLocal);
                } else {
                    restWorld.copy(restLocal);
                }
                boneRestWorldMap.set(bone.uuid, restWorld);
                return restWorld;
            }

            for (const bone of allBones) {
                if (!bone.mesh) continue;
                boneRestInverses.set(bone.uuid,
                    new THREE.Matrix4().copy(getBoneRestWorld(bone)).invert());
            }
        }

        const results   = [];
        let firstMtl = '';
        try {
            anim.select();

            // Go to frameStart and preview
            Timeline.time = frameStart;
            Animator.preview();
            await new Promise(r => setTimeout(r, 0));
            // Mesh world matrices
            for (const mesh of Mesh.all) {
                if (mesh.mesh) {
                    mesh.mesh.updateWorldMatrix(true, false);
                    meshRestWorlds.set(mesh.uuid, {
                        world: new THREE.Matrix4().copy(mesh.mesh.matrixWorld),
                        inverse: new THREE.Matrix4().copy(mesh.mesh.matrixWorld).invert()
                    });
                }
            }
            // Per-parent-bone rest inverses (rigid-body path)
            for (const mesh of Mesh.all) {
                if (!(mesh.parent instanceof Group) || !mesh.parent.mesh) continue;
                mesh.parent.mesh.updateWorldMatrix(true, false);
                const inv = new THREE.Matrix4()
                    .copy(mesh.parent.mesh.matrixWorld)
                    .invert();
                restInverses.set(mesh.uuid, inv);
            }

            // Per-armature-bone influence maps (weighted path)
            const meshInfluences = new Map(); // mesh.uuid → Map<vkey, [{bone, weight}]>
            const meshToMeshId = new Map(); // mesh.uuid → meshShortID (hoisted for diagnostics)
            if (allBones.length > 0) {
                // Build per-mesh influence maps with meshID-aware matching.
                // BB weight keys use "meshShortID:vertexKey" format. We match
                // the meshShortID to the correct mesh via best-overlap to avoid
                // cross-mesh weight contamination when bare vertex keys collide.

                // Step 1: Collect meshID → Set<bareKey> from all bone weights
                const meshIdKeysets = new Map();
                const allWeightEntries = []; // [{bone, fullKey, meshId, bareKey, weight}]
                for (const bone of allBones) {
                    const src = bone.vertex_weights || bone.weights;
                    if (!src) continue;
                    const entries = src instanceof Map ? [...src.entries()] : Object.entries(src);
                    for (const [wk, w] of entries) {
                        const numW = +(w || 0);
                        if (numW <= 0) continue;
                        let meshId = null, bareKey = wk;
                        if (wk.includes(':')) {
                            const ci = wk.indexOf(':');
                            meshId = wk.substring(0, ci);
                            bareKey = wk.substring(ci + 1);
                            if (!meshIdKeysets.has(meshId)) meshIdKeysets.set(meshId, new Set());
                            meshIdKeysets.get(meshId).add(bareKey);
                        }
                        allWeightEntries.push({ bone, fullKey: wk, meshId, bareKey, weight: numW });
                    }
                }

                // Step 2: Map meshShortID → mesh element.
                // BB uses first 6 hex chars of uuid (no dashes) as the meshShortID
                // in weight keys. Try multiple prefix lengths for robustness.
                // meshToMeshId is hoisted above for diagnostic access
                const meshIdSet = new Set(meshIdKeysets.keys());
                const usedMeshIds = new Set();
                const usedMeshUuids = new Set();

                // Detect prefix length: find the length that gives 1:1 mapping
                const sampleId = [...meshIdSet][0] || '';
                const prefixLen = sampleId.length;

                // Build uuid-prefix → mesh lookup
                const byPrefix = new Map();
                for (const mesh of Mesh.all) {
                    if (!mesh.uuid) continue;
                    const stripped = mesh.uuid.replace(/-/g, '');
                    // Try the detected prefix length, plus common lengths 6, 8
                    for (const len of new Set([prefixLen, 6, 8])) {
                        if (len > 0 && len <= stripped.length) {
                            const key = stripped.substring(0, len);
                            if (!byPrefix.has(key)) byPrefix.set(key, mesh);
                        }
                    }
                    byPrefix.set(mesh.uuid, mesh); // full uuid too
                }

                // Match each meshID to a mesh
                for (const meshId of meshIdSet) {
                    const match = byPrefix.get(meshId);
                    if (match && !usedMeshUuids.has(match.uuid)) {
                        meshToMeshId.set(match.uuid, meshId);
                        usedMeshIds.add(meshId);
                        usedMeshUuids.add(match.uuid);
                    }
                }
                // Step 3: Build per-mesh influence maps using correct meshID
                for (const mesh of Mesh.all) {
                    const myMeshId = meshToMeshId.get(mesh.uuid);
                    const myKeys = new Set(Object.keys(mesh.vertices));
                    const vmap = new Map();
                    for (const { bone, meshId, bareKey, weight } of allWeightEntries) {
                        if (!myKeys.has(bareKey)) continue;
                        // Accept if: weight has matching meshID, or weight has no meshID prefix
                        if (meshId && myMeshId && meshId !== myMeshId) continue;
                        if (!vmap.has(bareKey)) vmap.set(bareKey, []);
                        vmap.get(bareKey).push({ bone, weight });
                    }
                    if (vmap.size > 0) meshInfluences.set(mesh.uuid, vmap);
                }
                if (meshInfluences.size === 0 && allBones.length > 0)
                    console.warn('[objmc] WARNING: No weight matches — meshes will stay in rest pose');
            }

            // Template for consistent face topology across frames
            let templateLines = null, templateVIdx = null;
            const warnedBones = new Set();

            // Bake each frame
            for (let i = 0; i < nframes; i++) {
                Timeline.time = frameStart + i / fps;
                Animator.preview();

                // Update all bone matrices once per frame
                if (allBones.length > 0)
                    for (const bone of allBones)
                        if (bone.mesh) bone.mesh.updateWorldMatrix(true, false);

                for (const mesh of Mesh.all) {
                    const weightMap = meshInfluences.get(mesh.uuid);
                    const original = savedVertices.get(mesh.uuid);

                    if (weightMap && weightMap.size > 0) {
                        // Weighted skinning with local↔world coordinate conversion
                        const mwd = meshRestWorlds.get(mesh.uuid);
                        const mw  = mwd ? mwd.world.elements : null;
                        const mwi = mwd ? mwd.inverse.elements : null;
                        for (const [vkey, pos] of Object.entries(original)) {
                            const influences = weightMap.get(vkey);
                            if (!influences) { mesh.vertices[vkey] = [...pos]; continue; }

                            const [lx, ly, lz] = pos;
                            // Local → world (rest pose)
                            const wx = mw ? mw[0]*lx+mw[4]*ly+mw[8]*lz+mw[12] : lx;
                            const wy = mw ? mw[1]*lx+mw[5]*ly+mw[9]*lz+mw[13] : ly;
                            const wz = mw ? mw[2]*lx+mw[6]*ly+mw[10]*lz+mw[14] : lz;
                            let nx = 0, ny = 0, nz = 0, tw = 0;
                            for (const { bone, weight } of influences) {
                                const restInv = boneRestInverses.get(bone.uuid);
                                if (!restInv) {
                                    if (!warnedBones.has(bone.uuid)) {
                                        console.warn(`[objmc] Bone "${bone.name || bone.uuid}" has no rest inverse — weights ignored`);
                                        warnedBones.add(bone.uuid);
                                    }
                                    continue;
                                }
                                const delta = new THREE.Matrix4()
                                    .multiplyMatrices(bone.mesh.matrixWorld, restInv);
                                const e = delta.elements;
                                nx += weight * (e[0]*wx+e[4]*wy+e[8]*wz+e[12]);
                                ny += weight * (e[1]*wx+e[5]*wy+e[9]*wz+e[13]);
                                nz += weight * (e[2]*wx+e[6]*wy+e[10]*wz+e[14]);
                                tw += weight;
                            }
                            if (tw > 0) {
                                const rx=nx/tw, ry=ny/tw, rz=nz/tw;
                                // World → local
                                mesh.vertices[vkey] = mwi
                                    ? [mwi[0]*rx+mwi[4]*ry+mwi[8]*rz+mwi[12],
                                       mwi[1]*rx+mwi[5]*ry+mwi[9]*rz+mwi[13],
                                       mwi[2]*rx+mwi[6]*ry+mwi[10]*rz+mwi[14]]
                                    : [rx, ry, rz];
                            } else {
                                mesh.vertices[vkey] = [...pos];
                            }
                            // No longer logging per-vertex: round-trip verify catches encoding errors
                        }
                    } else if (mesh.parent instanceof Group && mesh.parent.mesh) {
                        // Existing rigid parent-bone path
                        mesh.parent.mesh.updateWorldMatrix(true, false);
                        const restInv = restInverses.get(mesh.uuid);
                        if (!restInv) continue;
                        const delta = new THREE.Matrix4()
                            .multiplyMatrices(mesh.parent.mesh.matrixWorld, restInv);
                        const e = delta.elements;
                        for (const [vkey, lp] of Object.entries(original)) {
                            const [x, y, z] = lp;
                            mesh.vertices[vkey] = [
                                e[0]*x + e[4]*y + e[8]*z  + e[12],
                                e[1]*x + e[5]*y + e[9]*z  + e[13],
                                e[2]*x + e[6]*y + e[10]*z + e[14],
                            ];
                        }
                    }
                }

                const compile = () => Codecs.obj.compile();
                const safeCompile = () => withNonGeoHidden(compile);
                const c = filterArm ? await withArmatureHidden(safeCompile) : await safeCompile();
                let objStr = typeof c === 'string' ? c : (c.obj || '');
                if (i === 0) firstMtl = (typeof c === 'object' && c.mtl) ? c.mtl : '';
                if (filterGroups) objStr = filterObjBones(objStr, filterGroups);

                // Template approach: use frame 0's face topology for all frames.
                // Codecs.obj.compile() can produce different face indices when vertex
                // positions change (triangulation, vertex welding), which breaks
                // objmc animation. Fix: freeze everything except 'v ' lines.
                if (i === 0) {
                    templateLines = objStr.split('\n');
                    templateVIdx = [];
                    for (let li = 0; li < templateLines.length; li++)
                        if (templateLines[li].startsWith('v ')) templateVIdx.push(li);
                } else if (templateLines) {
                    // Extract v-lines from current frame and substitute into template
                    const curVLines = [];
                    for (const l of objStr.split('\n'))
                        if (l.startsWith('v ')) curVLines.push(l);
                    if (curVLines.length === templateVIdx.length) {
                        const tpl = [...templateLines];
                        for (let vi = 0; vi < templateVIdx.length; vi++)
                            tpl[templateVIdx[vi]] = curVLines[vi];
                        objStr = tpl.join('\n');
                    } else {
                        console.warn(`[objmc] F${i}: vertex count mismatch (template=${templateVIdx.length}, cur=${curVLines.length}), using raw OBJ`);
                    }
                }
                results.push(objStr);

                // Restore for next frame
                for (const mesh of Mesh.all) {
                    const saved = savedVertices.get(mesh.uuid);
                    if (saved) for (const [vk, p] of Object.entries(saved)) mesh.vertices[vk] = [...p];
                }

                if (opts.onProgress) opts.onProgress(i + 1, nframes);
                await new Promise(r => setTimeout(r, 0));
            }
        } finally {
            // Restore timeline and preview
            Timeline.time = savedTime;
            Animator.preview();
            // Restore mesh vertices
            for (const mesh of Mesh.all) {
                const saved = savedVertices.get(mesh.uuid);
                if (saved) for (const [vk, p] of Object.entries(saved)) mesh.vertices[vk] = [...p];
            }
            // Restore bone local transforms (prevent bones staying at last frame)
            for (const bone of allBones) {
                const s = savedBoneLocal.get(bone.uuid);
                if (s && bone.mesh) {
                    bone.mesh.position.copy(s.p);
                    bone.mesh.quaternion.copy(s.q);
                    bone.mesh.scale.copy(s.s);
                    bone.mesh.updateMatrixWorld();
                }
            }
        }
        return { objs: results, mtl: firstMtl };
    }

    // =========================================================
    // Section 4: OBJ Parsing
    // =========================================================

    // Remove bone groups from an OBJ string by UUID and re-index v/vt references.
    // Codecs.obj.compile() ignores visibility on armature_bone elements, so we
    // post-process the OBJ text to strip their geometry.
    function filterObjBones(objStr, boneUUIDs) {
        if (!boneUUIDs || boneUUIDs.size === 0) return objStr;

        const lines = objStr.split('\n');

        // Pass 1: find which v/vt indices belong to bone groups
        let curBone = false, vN = 0, vtN = 0;
        const boneV = new Set(), boneVt = new Set();
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('o ') || t.startsWith('g ')) {
                curBone = boneUUIDs.has(t.substring(2).trim());
            } else if (t.startsWith('v '))  { vN++;  if (curBone) boneV.add(vN);  }
              else if (t.startsWith('vt ')) { vtN++; if (curBone) boneVt.add(vtN); }
        }
        if (boneV.size === 0) return objStr;

        // Build old→new index maps (1-based)
        const vMap = new Array(vN + 1), vtMap = new Array(vtN + 1);
        let nv = 0, nvt = 0;
        for (let i = 1; i <= vN; i++)  vMap[i]  = boneV.has(i)  ? 0 : ++nv;
        for (let i = 1; i <= vtN; i++) vtMap[i] = boneVt.has(i) ? 0 : ++nvt;

        // Pass 2: rebuild OBJ without bone sections, remap face indices
        curBone = false;
        const out = [];
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('o ') || t.startsWith('g ')) {
                curBone = boneUUIDs.has(t.substring(2).trim());
                if (!curBone) out.push(line);
            } else if (curBone) {
                continue;
            } else if (t.startsWith('f ')) {
                const parts = t.split(/\s+/);
                const remap = ['f'];
                let ok = true;
                for (let i = 1; i < parts.length; i++) {
                    if (!parts[i]) continue;
                    const r = parts[i].split('/');
                    const vi  = r[0] ? vMap[+r[0]]  : 0;
                    const vti = r[1] ? vtMap[+r[1]] : 0;
                    if (r[0] && !vi) { ok = false; break; }
                    let s = '' + (vi || '');
                    if (r.length > 1) s += '/' + (vti || '');
                    if (r.length > 2) s += '/' + (r[2] || '');
                    remap.push(s);
                }
                if (ok) out.push(remap.join(' '));
            } else {
                out.push(line);
            }
        }
        return out.join('\n');
    }

    function parseObj(content, expectedFaces) {
        const d = { positions: [], uvs: [], faces: [], faceMaterials: [] };
        let currentMaterial = null;
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line || line[0] === '#') continue;
            const parts = line.split(/\s+/);
            switch (parts[0]) {
                case 'v':  d.positions.push([+parts[1]||0, +parts[2]||0, +parts[3]||0]); break;
                case 'vt': d.uvs.push([+parts[1]||0, +parts[2]||0]); break;
                case 'usemtl': currentMaterial = parts.slice(1).join(' '); break;
                case 'f': {
                    const face = [];
                    for (let i = 1; i < parts.length; i++) {
                        if (!parts[i]) continue;
                        const refs = parts[i].split('/');
                        face.push([refs[0] ? +refs[0]-1 : 0, refs[1] ? +refs[1]-1 : 0]);
                    }
                    d.faces.push(face);
                    d.faceMaterials.push(currentMaterial);
                    break;
                }
            }
        }
        if (expectedFaces > 0 && d.faces.length !== expectedFaces)
            throw new Error(`Face count mismatch: expected ${expectedFaces}, got ${d.faces.length}`);
        return d;
    }

    // Parse MTL string to map material names → texture filenames
    function parseMtl(mtlString) {
        const map = new Map(); // materialName → textureFilename
        let currentMtl = null;
        for (const rawLine of (mtlString || '').split('\n')) {
            const line = rawLine.trim();
            if (!line || line[0] === '#') continue;
            const parts = line.split(/\s+/);
            if (parts[0] === 'newmtl') currentMtl = parts.slice(1).join(' ');
            else if (parts[0] === 'map_Kd' && currentMtl) map.set(currentMtl, parts.slice(1).join(' '));
        }
        return map;
    }

    // Match MTL texture filenames to Texture.all indices
    function buildMaterialToTexMap(mtlMap) {
        const result = new Map(); // materialName → Texture.all index
        for (const [mtlName, texFile] of mtlMap) {
            // Strip path and extension for matching
            const baseName = texFile.replace(/^.*[/\\]/, '').replace(/\.\w+$/, '').toLowerCase();
            const texFileLower = texFile.toLowerCase();
            const idx = Texture.all.findIndex(t => {
                const tName = (t.name || '').replace(/\.\w+$/, '').toLowerCase();
                return tName === baseName || tName === texFileLower;
            });
            if (idx >= 0) result.set(mtlName, idx);
        }
        return result;
    }

    // =========================================================
    // Section 5: Vertex Indexing
    // =========================================================
    function buildVertexData(objContents, atlasInfo) {
        // atlasInfo: null (single texture) or { materialToTexIdx, offsets, width, height }
        const count = [0, 0];
        const mem   = { pos: Object.create(null), uv: Object.create(null) };
        const data  = { positions: [], uvs: [], vertices: [] };

        function remapUV(uv, material) {
            if (!atlasInfo) return uv;
            const texIdx = atlasInfo.materialToTexIdx.get(material);
            const off = texIdx !== undefined ? atlasInfo.offsets.get(texIdx) : null;
            if (!off) return uv;
            return [
                uv[0] * off.w / atlasInfo.width,
                (uv[1] * off.h + off.y) / atlasInfo.height
            ];
        }

        function indexVert(o, vert, material) {
            const pos = o.positions[vert[0]] || [0,0,0];
            const rawUv = o.uvs[vert[1]]    || [0,0];
            const uv = remapUV(rawUv, material);
            const pk  = pos.join(',');
            const uk  = uv[0].toFixed(8) + ',' + uv[1].toFixed(8);
            let pi = mem.pos[pk];
            if (pi === undefined) { pi = count[0]++; mem.pos[pk] = pi; data.positions.push(pos); }
            let ui = mem.uv[uk];
            if (ui === undefined) { ui = count[1]++; mem.uv[uk] = ui; data.uvs.push(uv); }
            data.vertices.push([pi, ui]);
        }

        function indexObj(o) {
            for (let fi = 0; fi < o.faces.length; fi++) {
                const face = o.faces[fi];
                const mtl = o.faceMaterials[fi];
                const n = Math.min(4, face.length);
                for (let i = 0; i < n; i++) indexVert(o, face[i], mtl);
                if (face.length === 3) indexVert(o, face[1], mtl);
                if (face.length > 4) console.warn('[objmc] N-Gon — only first 4 verts used');
            }
        }

        const firstObj = parseObj(objContents[0], 0);
        const nfaces   = firstObj.faces.length;
        indexObj(firstObj);
        for (let f = 1; f < objContents.length; f++)
            indexObj(parseObj(objContents[f], nfaces));

        return { data, nfaces };
    }

    // =========================================================
    // Section 6: Pixel Encoding
    // =========================================================
    const u24 = v => [Math.trunc(v/65536)&255, Math.trunc(v/256)&255, Math.trunc(v)&255];

    function posPixels(pos, scale, off) {
        return pos.map((v, i) => [...u24(8388608 + v*65536*scale + off[i]*65536), 255]);
    }
    function uvPixels(uv) {
        return uv.map(v => [...u24(v*65535), 255]);
    }
    function vertPixels(vert) {
        const [poi, uvi] = vert;
        return [[...u24(poi), 255], [...u24(uvi), 255]];
    }

    function getTextureRGBA(bbTexture) {
        return new Promise((resolve, reject) => {
            const src = bbTexture.source || (bbTexture.img && bbTexture.img.src);
            if (!src) { reject(new Error('Texture has no source data')); return; }
            const img = new Image();
            img.onload = () => {
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0);
                const id = cv.getContext('2d').getImageData(0, 0, w, h);
                resolve({ data: id.data, width: w, height: h });
            };
            img.onerror = () => reject(new Error('Failed to decode texture: ' + bbTexture.name));
            img.src = src;
        });
    }

    // Build a texture atlas by stacking multiple textures vertically.
    // Returns { data: Uint8Array, width, height, offsets: Map<texIdx, {x,y,w,h}> }
    async function buildAtlas(texIndices) {
        if (!texIndices || texIndices.length === 0) throw new Error('No textures selected for atlas');
        const texDatas = [];
        for (const idx of texIndices) {
            texDatas.push({ idx, rgba: await getTextureRGBA(Texture.all[idx]) });
        }
        const atlasW = Math.max(...texDatas.map(t => t.rgba.width));
        let atlasH = 0;
        const offsets = new Map(); // texIdx → { x, y, w, h }
        for (const t of texDatas) {
            offsets.set(t.idx, { x: 0, y: atlasH, w: t.rgba.width, h: t.rgba.height });
            atlasH += t.rgba.height;
        }
        const data = new Uint8Array(atlasW * atlasH * 4);
        for (const t of texDatas) {
            const off = offsets.get(t.idx);
            const src = t.rgba;
            for (let row = 0; row < src.height; row++) {
                const dstOffset = ((off.y + row) * atlasW + off.x) * 4;
                const srcOffset = row * src.width * 4;
                data.set(src.data.subarray(srcOffset, srcOffset + src.width * 4), dstOffset);
            }
        }
        return { data, width: atlasW, height: atlasH, offsets };
    }

    // =========================================================
    // Section 7: Per-Context Logic
    // =========================================================

    // Remove non-geometry elements (cameras, etc.) from the outliner tree
    // during OBJ compile. Setting visibility doesn't work because
    // Codecs.obj.compile() ignores it for some element types (same issue as
    // armature_bone). Instead we splice them out and restore after compile.
    // 'armature' is included because it's a container for child meshes.
    const GEO_WHITELIST = new Set(['cube', 'mesh', 'group', 'armature']);
    async function withNonGeoHidden(fn) {
        const removed = []; // [{arr, idx, el}]
        (function walk(children) {
            if (!children) return;
            for (let i = children.length - 1; i >= 0; i--) {
                const el = children[i];
                const t = (el.type || '').toLowerCase();
                if (!GEO_WHITELIST.has(t)) {
                    removed.push({ arr: children, idx: i, el });
                    children.splice(i, 1);
                } else if (el.children) {
                    walk(el.children);
                }
            }
        })(Outliner.root);
        try { return await fn(); }
        finally {
            // Restore in reverse order to preserve indices
            for (let i = removed.length - 1; i >= 0; i--) {
                const { arr, idx, el } = removed[i];
                arr.splice(idx, 0, el);
            }
        }
    }

    // Collect UUIDs of all armature_bone elements (used for OBJ post-processing).
    function collectBoneUUIDs() {
        const uuids = new Set();
        (function walk(children) {
            for (const el of (children || [])) {
                if ((el.type || '').toLowerCase() === 'armature_bone')
                    uuids.add(el.uuid);
                if (el.children) walk(el.children);
            }
        })(Outliner.root);
        return uuids;
    }

    // Collect OBJ group names of hidden mesh/cube elements.
    // Check if the project has armature/bone/locator/null_object elements.
    function hasNonGeometryElements() {
        const NON_GEO = new Set(['armature', 'armature_bone', 'locator', 'null_object']);
        function walk(children) {
            for (const el of (children || [])) {
                if (NON_GEO.has((el.type || '').toLowerCase())) return true;
                if (el.children && walk(el.children)) return true;
            }
            return false;
        }
        return walk(Outliner.root);
    }


    // Temporarily adjust visibility for OBJ export:
    //   - SHOW armature container (so child visibility is respected by codec)
    //   - SHOW mesh/cube elements under armature (they are the real geometry)
    //   - HIDE armature_bone, locator, null_object (non-geometry / bone shapes)
    // In Generic Model format the mesh geometry lives inside the armature
    // hierarchy (often hidden), while bones are visible and export as
    // diamond/octahedron shapes we don't want.
    async function withArmatureHidden(fn) {
        // Store direct element references for reliable restoration
        const saved = []; // [{el, originalVis}]
        function saveAndSet(el, vis) {
            saved.push({ el, originalVis: el.visibility });
            el.visibility = vis;
        }

        const HIDE_TYPES = new Set(['armature_bone', 'locator', 'null_object']);
        const GEO_TYPES  = new Set(['mesh', 'cube']);

        function processTree(children, insideArmature) {
            for (const el of (children || [])) {
                const t = (el.type || '').toLowerCase();

                if (t === 'armature') {
                    // Show armature container so its children are visible to codec
                    saveAndSet(el, true);
                    if (el.children)
                        processTree(el.children, true);
                } else if (HIDE_TYPES.has(t)) {
                    // Hide bone shapes, locators, null objects
                    saveAndSet(el, false);
                    if (el.children)
                        processTree(el.children, true);
                } else if (GEO_TYPES.has(t) && insideArmature) {
                    // Keep geometry at its original visibility — don't force
                    // hidden variants (face2, mouth2, etc.) to visible
                } else if (el.children) {
                    processTree(el.children, insideArmature);
                }
            }
        }

        processTree(Outliner.root, false);
        try { return await fn(); }
        finally {
            // Restore using direct references (OutlinerNode.uuidMap may not have armature types)
            for (const { el, originalVis } of saved)
                el.visibility = originalVis;
        }
    }

    // Build display transforms for the output JSON from export dialog fields.
    //
    // GUI and first-person-hand: the shader handles these with hardcoded
    // internal transforms (isGUI / isHand branches) — omit these slots.
    //
    // World slots (thirdperson, ground, head, fixed):
    //   Rotation  — orients the element quad; the shader's autorotate reads
    //               the quad corners to derive a rotation matrix.
    //   Translation — shifts the anchor point (corner 2).
    //   Scale — NOT included. The shader computes scale from quad geometry,
    //           so display scale would double with the export Scale field.
    //
    // Thirdperson fallback: if rotation is all-zero the element faces away
    // from the camera and gets back-face culled. Emit [85,0,0].
    function buildDisplayTransforms(cfg) {
        const result = {};
        const slots = cfg.displaySlots || {};

        for (const key of ['thirdperson_righthand','thirdperson_lefthand','head','ground','fixed']) {
            const slot = slots[key];
            if (!slot) continue;
            const r = slot.rotation    || [0,0,0];
            const t = slot.translation || [0,0,0];

            const isThird = key === 'thirdperson_righthand' || key === 'thirdperson_lefthand';
            const effR = (isThird && r.every(v => v === 0)) ? [85, 0, 0] : r;

            const entry = {};
            if (effR.some(v => v !== 0)) entry.rotation    = [...effR];
            if (t.some(v => v !== 0))    entry.translation = [...t];
            if (Object.keys(entry).length) result[key] = entry;
        }

        if (!result.thirdperson_righthand) result.thirdperson_righthand = { rotation: [85,0,0] };
        if (!result.thirdperson_lefthand)  result.thirdperson_lefthand  = { rotation: [85,0,0] };

        return result;
    }

    // =========================================================
    // Section 8: Core Encode Pipeline
    // =========================================================
    async function buildOutput(cfg, objContents, mtlString) {
        // objContents: string[] — one OBJ per frame (already compiled/baked)
        if (!objContents || !objContents.length || !objContents[0])
            throw new Error('No OBJ content');

        const nframes   = objContents.length;
        const ntextures = 1;

        // Determine texture(s): atlas if multiple textures referenced, else single
        let texData; // { data, width, height }
        let atlasInfo = null; // null = single texture, otherwise atlas UV remap info

        // Map material names → Texture.all indices
        // Try MTL file first, then fall back to BB's m_UUID convention
        const materialToTexIdx = new Map();
        const mtlMap = parseMtl(mtlString);
        if (mtlMap.size > 0) {
            for (const [k, v] of buildMaterialToTexMap(mtlMap)) materialToTexIdx.set(k, v);
        }
        if (materialToTexIdx.size === 0) {
            // BB OBJ uses "usemtl m_<texture-uuid>" — match directly
            for (const obj of objContents) {
                for (const line of obj.split('\n')) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('usemtl ')) {
                        const mtlName = trimmed.slice(7).trim();
                        if (materialToTexIdx.has(mtlName)) continue;
                        if (mtlName.startsWith('m_')) {
                            const uuid = mtlName.slice(2);
                            const idx = Texture.all.findIndex(t => t.uuid === uuid);
                            if (idx >= 0) materialToTexIdx.set(mtlName, idx);
                        }
                    }
                }
            }
        }
        let referencedTexIndices = new Set(materialToTexIdx.values());
        // Filter to only user-selected textures
        if (cfg.useAtlas && cfg.atlasTexIndices) {
            const allowed = new Set(cfg.atlasTexIndices);
            referencedTexIndices = new Set([...referencedTexIndices].filter(i => allowed.has(i)));
        }

        if (cfg.useAtlas && referencedTexIndices.size > 1) {
            // Multi-texture: build atlas
            const atlas = await buildAtlas([...referencedTexIndices]);
            texData = { data: atlas.data, width: atlas.width, height: atlas.height };
            atlasInfo = {
                materialToTexIdx,
                offsets: atlas.offsets,
                width: atlas.width,
                height: atlas.height,
            };
        } else {
            // Single texture (original path)
            const bbTex = Texture.all[cfg.texIndex];
            if (!bbTex) throw new Error(`No texture at index ${cfg.texIndex}`);
            texData = await getTextureRGBA(bbTex);
        }

        const tw = texData.width, th = texData.height;
        if (tw < 8) throw new Error('Minimum texture size is 8px wide');
        if (tw > 65535 || th > 65535) throw new Error(`Texture too large: ${tw}x${th} (max 65535)`);

        const { data, nfaces } = buildVertexData(objContents, atlasInfo);
        if (nfaces === 0) throw new Error('No faces found in OBJ');
        const nvertices = nfaces * 4;

        const uvH  = Math.ceil(nfaces / tw);
        const texH = th;
        const vpH  = Math.ceil(data.positions.length * 3 / tw);
        const vtH  = Math.ceil(data.uvs.length * 2 / tw);
        const vH   = Math.ceil(data.vertices.length * 2 / tw); // includes all frames

        let ty = 1 + uvH + texH + vpH + vtH + vH;
        if (!cfg.nopow) ty = 1 << Math.ceil(Math.log2(ty || 1));


        const cbArr = ['pitch','yaw','roll','time','scale','overlay','hurt'];
        const ca = cfg.colorbehavior.map(x => {
            const idx = cbArr.indexOf(x);
            if (idx < 0) throw new Error('Unknown colorbehavior: ' + x);
            return idx;
        });
        const cb  = (ca[0]<<6)|(ca[1]<<3)|ca[2];
        const dur = cfg.duration === 0 ? nframes : cfg.duration;

        const buf = new Uint8Array(tw * ty * 4);
        const put = (x, y, r, g, b, a=255) => {
            const i = (y*tw + x)*4;
            buf[i]=r&255; buf[i+1]=g&255; buf[i+2]=b&255; buf[i+3]=a&255;
        };

        // Row 0 — header (compression always disabled: marker.a=78)
        put(0, 0, 12, 34, 56, 78);
        put(1, 0, Math.trunc(tw/256), tw%256, Math.trunc(th/256), 255);
        put(2, 0, Math.trunc(nvertices/16777216)%256, Math.trunc(nvertices/65536)%256,
                  Math.trunc(nvertices/256)%256, 255);
        put(3, 0, Math.trunc(nframes/65536)%256, Math.trunc(nframes/256)%256,
                  nframes%256, ntextures);
        put(4, 0, Math.trunc(dur/65536)%256, Math.trunc(dur/256)%256, dur%256,
                  128|(cfg.autoplay?64:0)|(cfg.easing<<4)|(cfg.interpolation<<2));
        put(5, 0, Math.trunc(vpH/256)%256, vpH%256, Math.trunc(vtH/256)%256, 255);
        put(6, 0,
            ((cfg.noshadow?1:0)<<7)|(cfg.autorotate<<5)|(cfg.visibility<<2)|Math.trunc(cb/256),
            cb%256, 255, 255);
        put(7, 0, th%256, nvertices%256, vtH%256, 255);

        // UV header + JSON elements
        const elements = [];
        for (let i = 0; i < nfaces; i++) {
            const px = i%tw, py = Math.floor(i/tw)+1;
            put(px, py, Math.trunc(px/256)%256, px%256, Math.trunc(py/256)%256, py%256);
            elements.push({
                from: [8,0,8], to: [24,16,8],
                faces: { north: {
                    uv: [(px+0.1)*16/tw,(py+0.1)*16/ty,(px+0.9)*16/tw,(py+0.9)*16/ty],
                    texture: '#0', tintindex: 0,
                }},
            });
        }

        // Texture rows
        if (atlasInfo) {
            // Atlas: flip each texture independently within its region
            for (const [, off] of atlasInfo.offsets) {
                for (let ly = 0; ly < off.h; ly++) {
                    const srcLy = cfg.flipuv ? ly : (off.h - 1 - ly);
                    const srcRow = off.y + srcLy;
                    const dstRow = (1 + uvH) + off.y + ly;
                    for (let px = 0; px < off.w; px++) {
                        const si = (srcRow * tw + px) * 4;
                        put(px, dstRow, texData.data[si], texData.data[si+1],
                            texData.data[si+2], texData.data[si+3]);
                    }
                }
            }
        } else {
            // Single texture: global flip
            for (let py = 0; py < th; py++) {
                const srcY = cfg.flipuv ? py : (th-1-py);
                for (let px = 0; px < tw; px++) {
                    const si = (srcY*tw+px)*4;
                    put(px, (1+uvH)+py, texData.data[si], texData.data[si+1],
                        texData.data[si+2], texData.data[si+3]);
                }
            }
        }

        // Position data
        let ybase = 1+uvH+texH;
        for (let i = 0; i < data.positions.length; i++) {
            for (const [j, pxArr] of posPixels(data.positions[i], cfg.scale, cfg.offset).entries()) {
                const p = i*3+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // UV data
        ybase += vpH;
        for (let i = 0; i < data.uvs.length; i++) {
            for (const [j, pxArr] of uvPixels(data.uvs[i]).entries()) {
                const p = i*2+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // Vertex data (all frames)
        ybase += vtH;
        for (let i = 0; i < data.vertices.length; i++) {
            const pixels = vertPixels(data.vertices[i]);
            for (const [j, pxArr] of pixels.entries()) {
                const p = i*2+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // Round-trip verification: decode a few entries from the buffer
        // using the same logic the shader uses, and compare with source data.
        const verifyWarns = [];
        try {
            const rd = (x, y) => {
                const i = (y*tw+x)*4;
                return [buf[i], buf[i+1], buf[i+2], buf[i+3]];
            };
            // Verify marker
            const mk = rd(0, 0);
            if (mk[0]!==12||mk[1]!==34||mk[2]!==56||mk[3]!==78) {
                verifyWarns.push('marker mismatch');
                console.error('[objmc-verify] MARKER MISMATCH:', mk);
            }
            // Verify header: nvertices, nframes
            const h2 = rd(2, 0), h7 = rd(7, 0);
            const decNv = h2[0]*16777216+h2[1]*65536+h2[2]*256+h7[1];
            const h3 = rd(3, 0);
            const decNf = Math.max(h3[0]*65536+h3[1]*256+h3[2], 1);
            if (decNv !== nvertices) { verifyWarns.push('nvertices mismatch'); console.error(`[objmc-verify] nvertices: encoded=${decNv} expected=${nvertices}`); }
            if (decNf !== nframes)   { verifyWarns.push('nframes mismatch');   console.error(`[objmc-verify] nframes: encoded=${decNf} expected=${nframes}`); }
            // Verify first position (shader decodes as v*scale+offset)
            const posBase = 1 + uvH + texH;
            const px0 = rd(0, posBase), px1 = rd(1, posBase), px2 = rd(2, posBase);
            const decPos = [
                (px0[0]/255*256 + px0[1]/255 + px0[2]/255/256) * (255/256) - 128,
                (px1[0]/255*256 + px1[1]/255 + px1[2]/255/256) * (255/256) - 128,
                (px2[0]/255*256 + px2[1]/255 + px2[2]/255/256) * (255/256) - 128,
            ];
            const srcPos = data.positions[0];
            const expPos = srcPos.map((v,j) => v * cfg.scale + cfg.offset[j]);
            const posDiff = Math.abs(decPos[0]-expPos[0])+Math.abs(decPos[1]-expPos[1])+Math.abs(decPos[2]-expPos[2]);
            if (posDiff > 0.01) { verifyWarns.push('pos[0] mismatch'); console.error(`[objmc-verify] pos[0] MISMATCH: exp=[${expPos.map(v=>v.toFixed(4))}] dec=[${decPos.map(v=>v.toFixed(4))}]`); }
            // Verify first vertex data entry
            const vtxBase = 1 + uvH + texH + vpH + vtH;
            const va = rd(0, vtxBase), vb = rd(1, vtxBase);
            const decPi = va[0]*65536+va[1]*256+va[2];
            const decUi = vb[0]*65536+vb[1]*256+vb[2];
            const srcVert = data.vertices[0];
            if (decPi !== srcVert[0]) { verifyWarns.push('vert[0].pos mismatch'); console.error(`[objmc-verify] vert[0].pos: encoded=${decPi} expected=${srcVert[0]}`); }
            if (decUi !== srcVert[1]) { verifyWarns.push('vert[0].uv mismatch');  console.error(`[objmc-verify] vert[0].uv: encoded=${decUi} expected=${srcVert[1]}`); }
            // Verify last frame's first vertex
            if (nframes > 1) {
                const lastIdx = (nframes-1) * nvertices;
                const lp = lastIdx * 2;
                const la = rd(lp%tw, vtxBase+Math.floor(lp/tw));
                const decLPi = la[0]*65536+la[1]*256+la[2];
                const srcLast = data.vertices[lastIdx];
                if (srcLast) {
                    if (decLPi !== srcLast[0]) { verifyWarns.push('last frame mismatch'); console.error(`[objmc-verify] vert[${lastIdx}].pos: enc=${decLPi} exp=${srcLast[0]}`); }
                }
            }
        } catch(e) { verifyWarns.push('verify error'); console.error('[objmc-verify] error:', e.message); }

        const pngBuffer = encodePNG(tw, ty, buf);
        const warnStr = verifyWarns.length ? ` (${verifyWarns.length} warning(s) — see console)` : '';
        const debugInfo = `${nfaces} faces · ${nframes} frame(s) · ${tw}×${ty}px` + warnStr;

        return { pngBuffer, elements, nfaces, nvertices, nframes, tw, ty, debugInfo };
    }

    // =========================================================
    // Section 9: Export Orchestration
    // =========================================================

    // Get OBJ contents (static or animated).
    // If the user has the BB Display tab open, Codecs.obj.compile() would apply
    // that slot's transforms (scale/rotation) to the exported geometry.
    // Switch to Edit mode first to ensure unaffected rest-pose geometry.
    async function getObjContents(cfg, onProgress) {
        const prevMode  = typeof Mode !== 'undefined' && Mode.selected;
        const inDisplay = prevMode && prevMode.id === 'display';
        if (inDisplay && Modes && Modes.options && Modes.options.edit) {
            Modes.options.edit.select();
        }
        try {
            if (cfg.animationEnabled) {
                const anim = Animation.all[cfg.animationIndex];
                if (!anim) throw new Error('Animation not found');
                return await compileAnimatedObjFrames(anim, {
                    fps:        cfg.animFps,
                    frameStart: cfg.animStart,
                    frameEnd:   cfg.animEnd > 0 ? cfg.animEnd : anim.length,
                    filterArmature: cfg.filterArmature,
                    onProgress,
                });
            } else {
                const compile = () => Codecs.obj.compile();
                const safeCompile = () => withNonGeoHidden(compile);
                const c = cfg.filterArmature ? await withArmatureHidden(safeCompile) : await safeCompile();
                const raw = typeof c === 'string' ? c : (c.obj || '');
                const mtl = (typeof c === 'object' && c.mtl) ? c.mtl : '';
                if (!raw) throw new Error('OBJ codec returned empty content');
                let s = raw;
                if (cfg.filterArmature) {
                    s = filterObjBones(s, collectBoneUUIDs());
                }
                return { objs: [s], mtl };
            }
        } finally {
            if (inDisplay && Modes && Modes.options && Modes.options.display) {
                Modes.options.display.select();
            }
        }
    }

    // Main export entry point
    async function runExport(cfg, onStatus) {
        const displayTransforms = buildDisplayTransforms(cfg);

        onStatus('Building…');
        const { objs, mtl } = await getObjContents(cfg, (i, n) =>
            onStatus(`Baking frame ${i}/${n}…`)
        );
        const result = await buildOutput(cfg, objs, mtl);
        onStatus(result.debugInfo + ' — choose save location…');
        await saveSingleOutput(result, displayTransforms, cfg);
        onStatus('Done! ' + result.debugInfo);
    }

    // =========================================================
    // Section 10: File Saving
    // =========================================================
    function saveSingleOutput(result, displayTransforms, cfg) {
        return new Promise((resolve) => {
            const fs   = require('fs');
            const path = require('path');
            const name = (Project.name || 'model').replace(/[^a-z0-9_]/gi,'_').toLowerCase();

            Blockbench.export({
                type: 'PNG Image', extensions: ['png'], name,
                startpath: Project.export_path || '',
                custom_writer(_, pngPath) {
                    fs.writeFileSync(pngPath, result.pngBuffer);
                    const dir     = path.dirname(pngPath);
                    const pngName = path.basename(pngPath, '.png');
                    const model = {
                        textures: { 0: `block/${pngName}` },
                        elements: result.elements,
                        display:  displayTransforms,
                    };
                    // Datapack
                    if (cfg.generateDatapack && result.nframes > 1) {
                        const dpFiles = generateDatapackFiles(
                            cfg.datapackAnimId, result.nframes,
                            cfg.datapackNamespace, cfg.datapackTargetType,
                            cfg.datapackEquipSlot
                        );
                        const dpDir = cfg.datapackOutputDir
                            ? path.join(cfg.datapackOutputDir, `objmc_${cfg.datapackAnimId}`)
                            : path.join(dir, `objmc_${cfg.datapackAnimId}`);
                        saveDatapackFiles(dpFiles, dpDir);
                    }
                    Blockbench.export({
                        type: 'JSON Model', extensions: ['json'], name: pngName,
                        startpath: dir,
                        content: JSON.stringify(model, null, 2),
                    }, () => resolve());
                },
            });
        });
    }

    // =========================================================
    // Section 10b: Datapack Function Generation
    // =========================================================

    function generateDatapackFiles(animId, nframes, namespace, targetType, equipSlot) {
        const ns = namespace || 'objmc';
        const id = animId;
        const fn = `animations/${animId}`;
        const files = new Map();

        const EQUIP_PATH = {
            mainhand: 'equipment.mainhand', offhand: 'equipment.offhand',
            head: 'equipment.head', chest: 'equipment.chest',
            legs: 'equipment.legs', feet: 'equipment.feet',
        };
        const PLAYER_SLOT = {
            mainhand: 'weapon.mainhand', offhand: 'weapon.offhand',
            head: 'armor.head', chest: 'armor.chest',
            legs: 'armor.legs', feet: 'armor.feet',
        };

        const isPlayer = targetType === 'player';
        const equipPath = targetType === 'item_display'
            ? 'item'
            : (EQUIP_PATH[equipSlot] || 'equipment.mainhand');
        const playerSlot = PLAYER_SLOT[equipSlot] || 'weapon.mainhand';
        const tmp = '@e[tag=objmc_temp,limit=1,sort=nearest]';

        files.set('pack.mcmeta', JSON.stringify({
            pack: {
                description: `objmc animation: ${animId}`,
                min_format: [83, 2],
                max_format: 83,
            },
        }, null, 2));

        // init — scoreboards + constants
        files.set(`data/${ns}/function/${fn}/init.mcfunction`, [
            `scoreboard objectives add ${id} dummy`,
            `scoreboard players set #dur ${id} ${nframes}`,
            `scoreboard players set #base ${id} 8388608`,
            `scoreboard players set #cycle ${id} 24000`,
        ].join('\n'));

        // play — smooth autoplay loop (synced to GameTime)
        files.set(`data/${ns}/function/${fn}/play.mcfunction`, [
            `function ${ns}:${fn}/init`,
            `scoreboard players set @s ${id} 0`,
            `tag @s add ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${fn}/_apply_auto`,
        ].join('\n'));

        // stop — freeze at current frame
        files.set(`data/${ns}/function/${fn}/stop.mcfunction`, [
            `function ${ns}:${fn}/init`,
            `# play_once: freeze at last frame`,
            `execute if entity @s[tag=${id}.once] run scoreboard players operation @s ${id} = #dur ${id}`,
            `execute if entity @s[tag=${id}.once] run scoreboard players remove @s ${id} 1`,
            `# autoplay: compute current frame`,
            `execute if entity @s[tag=${id}.auto] store result score #gt ${id} run time query gametime`,
            `execute if entity @s[tag=${id}.auto] run scoreboard players operation #gt ${id} -= @s ${id}`,
            `execute if entity @s[tag=${id}.auto] run scoreboard players operation #gt ${id} %= #dur ${id}`,
            `execute if entity @s[tag=${id}.auto] run scoreboard players operation @s ${id} = #gt ${id}`,
            `tag @s remove ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${fn}/_apply_manual`,
        ].join('\n'));

        // set — freeze at specific frame (user sets @s <id> = frame before calling)
        files.set(`data/${ns}/function/${fn}/set.mcfunction`, [
            `function ${ns}:${fn}/init`,
            `tag @s remove ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${fn}/_apply_manual`,
        ].join('\n'));

        // play_from — autoplay loop from frame N (user sets @s <id> = N before calling)
        files.set(`data/${ns}/function/${fn}/play_from.mcfunction`, [
            `function ${ns}:${fn}/init`,
            `execute store result score #gt ${id} run time query gametime`,
            `scoreboard players operation #gt ${id} -= @s ${id}`,
            `scoreboard players operation #gt ${id} %= #dur ${id}`,
            `scoreboard players operation @s ${id} = #gt ${id}`,
            `tag @s add ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${fn}/_apply_auto`,
        ].join('\n'));

        // play_once — play one cycle then freeze at last frame (shader-driven, no tick needed)
        files.set(`data/${ns}/function/${fn}/play_once.mcfunction`, [
            `function ${ns}:${fn}/init`,
            `execute store result score @s ${id} run time query gametime`,
            `scoreboard players operation @s ${id} %= #cycle ${id}`,
            `scoreboard players add @s ${id} 32768`,
            `tag @s remove ${id}.auto`,
            `tag @s add ${id}.once`,
            `function ${ns}:${fn}/_apply_auto`,
        ].join('\n'));

        // _apply_auto — set autoplay color (custom_color = tcolor from @s <id>)
        if (isPlayer) {
            files.set(`data/${ns}/function/${fn}/_apply_auto.mcfunction`, [
                `summon armor_stand ~ ~ ~ {Tags:["objmc_temp"],Invisible:1b}`,
                `item replace entity ${tmp} ${playerSlot} from entity @s ${playerSlot}`,
                `data modify entity ${tmp} ${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`,
                `execute store result entity ${tmp} ${equipPath}.components."minecraft:potion_contents".custom_color int 1 run scoreboard players get @s ${id}`,
                `item replace entity @s ${playerSlot} from entity ${tmp} ${playerSlot}`,
                `kill ${tmp}`,
            ].join('\n'));
        } else {
            files.set(`data/${ns}/function/${fn}/_apply_auto.mcfunction`, [
                `data modify entity @s ${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`,
                `execute store result entity @s ${equipPath}.components."minecraft:potion_contents".custom_color int 1 run scoreboard players get @s ${id}`,
            ].join('\n'));
        }

        // _apply_manual — set manual color (custom_color = 0x800000 + frame from @s <id>)
        if (isPlayer) {
            files.set(`data/${ns}/function/${fn}/_apply_manual.mcfunction`, [
                `scoreboard players operation #temp ${id} = #base ${id}`,
                `scoreboard players operation #temp ${id} += @s ${id}`,
                `summon armor_stand ~ ~ ~ {Tags:["objmc_temp"],Invisible:1b}`,
                `item replace entity ${tmp} ${playerSlot} from entity @s ${playerSlot}`,
                `data modify entity ${tmp} ${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`,
                `execute store result entity ${tmp} ${equipPath}.components."minecraft:potion_contents".custom_color int 1 run scoreboard players get #temp ${id}`,
                `item replace entity @s ${playerSlot} from entity ${tmp} ${playerSlot}`,
                `kill ${tmp}`,
            ].join('\n'));
        } else {
            files.set(`data/${ns}/function/${fn}/_apply_manual.mcfunction`, [
                `scoreboard players operation #temp ${id} = #base ${id}`,
                `scoreboard players operation #temp ${id} += @s ${id}`,
                `data modify entity @s ${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`,
                `execute store result entity @s ${equipPath}.components."minecraft:potion_contents".custom_color int 1 run scoreboard players get #temp ${id}`,
            ].join('\n'));
        }

        return files;
    }

    function saveDatapackFiles(files, basePath) {
        const fs   = require('fs');
        const path = require('path');
        for (const [relPath, content] of files) {
            const fullPath = path.join(basePath, relPath);
            const dir = path.dirname(fullPath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf8');
        }
    }

    // =========================================================
    // Section 11: Dialog
    // =========================================================
    function showDialog() {
        if (!Project) {
            Blockbench.showMessageBox({ title:'objmc', message:'No project is open.' }); return;
        }
        if (!Texture.all.length) {
            Blockbench.showMessageBox({ title:'objmc', message:'The project has no textures.' }); return;
        }

        const hasAnims    = Animation.all.length > 0;

        const dialog = new Dialog({
            id:    PLUGIN_ID + '_dialog',
            title: 'Export as objmc',
            width: 620,
            component: {
                data() {
                    const firstAnim = Animation.all[0];
                    return {
                        // Texture
                        texOptions:    Texture.all.map((t,i)=>({label:t.name||`Texture ${i}`,value:i})),
                        selectedTex:   0,
                        multiTex:      Texture.all.length > 1,
                        useAtlas:      Texture.all.length > 1,
                        atlasTexChecked: Texture.all.map(() => true),
                        // Transform
                        scale:         1,
                        offsetX:       0, offsetY: 0, offsetZ: 0,
                        // Animation
                        hasAnims,
                        animationEnabled: false,
                        animOptions:   Animation.all.map((a,i)=>({label:a.name||`Anim ${i}`,value:i})),
                        animationIndex:0,
                        animFps:       firstAnim ? (firstAnim.snapping||20) : 20,
                        animStart:     0,
                        animEnd:       firstAnim ? firstAnim.length : 0,
                        duration:      0,
                        autoplay:      true,
                        generateDatapack: false,
                        datapackNamespace: 'objmc',
                        datapackAnimId:  (firstAnim ? (firstAnim.name || 'anim') : 'anim')
                            .replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 12) || 'anim',
                        datapackTargetType: 'equipment',
                        datapackEquipSlot: 'mainhand',
                        datapackOutputDir: '',
                        // Display (collapsed by default)
                        showDisplay:   false,
                        dThirdRX: 85, dThirdRY: 0, dThirdRZ: 0,
                        dThirdTX: 0,  dThirdTY: 0, dThirdTZ: 0,
                        dHeadRX: 0, dHeadRY: 0, dHeadRZ: 0,
                        dHeadTX: 0, dHeadTY: 0, dHeadTZ: 0,
                        dGroundRX: 0, dGroundRY: 0, dGroundRZ: 0,
                        dGroundTX: 0, dGroundTY: 0, dGroundTZ: 0,
                        dFixedRX: 0, dFixedRY: 0, dFixedRZ: 0,
                        dFixedTX: 0, dFixedTY: 0, dFixedTZ: 0,
                        // Advanced (collapsed by default)
                        showAdvanced:  false,
                        easing:        1,
                        interpolation: 1,
                        cbR: 'pitch', cbG: 'yaw', cbB: 'roll',
                        autorotate:    1,
                        flipuv:        false,
                        noshadow:      false,
                        nopow:         true,
                        hasArmature:    hasNonGeometryElements(),
                        filterArmature: hasNonGeometryElements(),
                        // Status
                        status: '',
                        running: false,
                    };
                },
                computed: {
                    showDatapackOption() {
                        return this.hasAnims && this.animationEnabled;
                    },
                    selectedTexThumb() {
                        const tex = Texture.all[this.selectedTex];
                        return tex ? tex.source : '';
                    },
                    frameCountPreview() {
                        if (!this.hasAnims || !this.animationEnabled) return '';
                        const fps = +this.animFps || 1;
                        const start = +this.animStart || 0;
                        const end = +this.animEnd || 0;
                        if (end <= start) return '';
                        const n = Math.max(1, Math.floor((end - start) * fps) + 1);
                        return n + ' frame' + (n !== 1 ? 's' : '');
                    },
                    validationErrors() {
                        const errs = [];
                        if (this.useAtlas && this.multiTex && !this.atlasTexChecked.some(v => v))
                            errs.push('Select at least one texture for the atlas');
                        if (+this.scale <= 0)
                            errs.push('Scale must be positive');
                        if (this.hasAnims && this.animationEnabled) {
                            if (+this.animEnd <= +this.animStart)
                                errs.push('End time must be after start time');
                            if (+this.animFps < 1)
                                errs.push('FPS must be at least 1');
                        }
                        if (this.generateDatapack && this.showDatapackOption) {
                            if (!this.datapackAnimId.trim())
                                errs.push('Animation ID is required');
                            if (!this.datapackNamespace.trim())
                                errs.push('Namespace is required');
                        }
                        return errs;
                    },
                },
                watch: {
                    generateDatapack(val) {
                        if (val) {
                            this.autoplay = false;
                            this.cbR = 'time';
                            this.cbG = 'time';
                            this.cbB = 'time';
                            this.duration = 0;
                        }
                    },
                },
                methods: {
                    browseDatapackDir() {
                        const dir = Blockbench.pickDirectory({
                            title: 'Select datapack output directory',
                            startpath: this.datapackOutputDir || undefined,
                        });
                        if (dir) this.datapackOutputDir = dir;
                    },
                    onAnimChange() {
                        const anim = Animation.all[this.animationIndex];
                        if (anim) {
                            this.animFps = anim.snapping || 20;
                            this.animEnd = anim.length;
                            this.datapackAnimId = (anim.name || 'anim')
                                .replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 12) || 'anim';
                        }
                    },
                    async doExport() {
                        const wantDatapack = !!this.generateDatapack && this.showDatapackOption;
                        const cbParts = wantDatapack
                            ? ['time', 'time', 'time']
                            : [this.cbR, this.cbG, this.cbB];
                        this.running = true;
                        this.status  = 'Building\u2026';
                        try {
                            const cfg = {
                                texIndex:        +this.selectedTex,
                                useAtlas:        !!this.useAtlas,
                                atlasTexIndices:  this.atlasTexChecked.map((v,i)=>v?i:-1).filter(i=>i>=0),
                                scale:           +this.scale,
                                offset:          [+this.offsetX, +this.offsetY, +this.offsetZ],
                                animationEnabled: this.hasAnims && this.animationEnabled,
                                animationIndex:  +this.animationIndex,
                                animFps:         +this.animFps,
                                animStart:       +this.animStart,
                                animEnd:         +this.animEnd,
                                duration:        wantDatapack ? 0 : +this.duration,
                                easing:          +this.easing,
                                interpolation:   +this.interpolation,
                                colorbehavior:   cbParts,
                                autorotate:      +this.autorotate,
                                autoplay:        wantDatapack ? false : !!this.autoplay,
                                flipuv:          !!this.flipuv,
                                noshadow:        !!this.noshadow,
                                nopow:           !!this.nopow,
                                filterArmature:  !!this.filterArmature,
                                visibility:      7, // world(4) + hand(2) + gui(1) — always all
                                generateDatapack: wantDatapack,
                                datapackNamespace: this.datapackNamespace || 'objmc',
                                datapackAnimId:  this.datapackAnimId || 'anim',
                                datapackTargetType: this.datapackTargetType,
                                datapackEquipSlot:  this.datapackEquipSlot,
                                datapackOutputDir:  this.datapackOutputDir,
                                displaySlots: {
                                    thirdperson_righthand: {
                                        rotation:    [+this.dThirdRX, +this.dThirdRY, +this.dThirdRZ],
                                        translation: [+this.dThirdTX, +this.dThirdTY, +this.dThirdTZ],
                                    },
                                    thirdperson_lefthand: {
                                        rotation:    [+this.dThirdRX, +this.dThirdRY, +this.dThirdRZ],
                                        translation: [+this.dThirdTX, +this.dThirdTY, +this.dThirdTZ],
                                    },
                                    head: {
                                        rotation:    [+this.dHeadRX, +this.dHeadRY, +this.dHeadRZ],
                                        translation: [+this.dHeadTX, +this.dHeadTY, +this.dHeadTZ],
                                    },
                                    ground: {
                                        rotation:    [+this.dGroundRX, +this.dGroundRY, +this.dGroundRZ],
                                        translation: [+this.dGroundTX, +this.dGroundTY, +this.dGroundTZ],
                                    },
                                    fixed: {
                                        rotation:    [+this.dFixedRX, +this.dFixedRY, +this.dFixedRZ],
                                        translation: [+this.dFixedTX, +this.dFixedTY, +this.dFixedTZ],
                                    },
                                },
                            };
                            await runExport(cfg, msg => { this.status = msg; });
                        } catch(err) {
                            this.status = 'Error: ' + err.message;
                            console.error('[objmc]', err);
                        }
                        this.running = false;
                    },
                },
                template: `
<div style="padding:14px 16px;font-size:13px;line-height:1.6;">

  <!-- ======== TEXTURE ======== -->
  <div style="margin-bottom:12px;">
    <div style="font-weight:600;margin-bottom:4px;color:#ddd;">Texture</div>
    <div style="display:flex;align-items:flex-start;gap:8px;">
      <img v-if="selectedTexThumb && !useAtlas"
           :src="selectedTexThumb"
           style="width:48px;height:48px;image-rendering:pixelated;border:1px solid rgba(255,255,255,0.15);border-radius:3px;object-fit:contain;background:#1a1a1a;flex-shrink:0;"/>
      <div style="flex:1;min-width:0;">
    <template v-if="!multiTex">
      <select v-model="selectedTex" style="padding:3px 6px;width:100%;">
        <option v-for="t in texOptions" :key="t.value" :value="t.value">{{t.label}}</option>
      </select>
    </template>
    <template v-else>
      <label style="display:inline-flex;align-items:center;gap:4px;">
        <input type="checkbox" v-model="useAtlas"/> Atlas (combine textures)
      </label>
      <select v-if="!useAtlas" v-model="selectedTex" style="margin-left:8px;padding:3px 6px;">
        <option v-for="t in texOptions" :key="t.value" :value="t.value">{{t.label}}</option>
      </select>
      <div v-if="useAtlas" style="margin-top:4px;padding-left:20px;">
        <label v-for="(t, i) in texOptions" :key="t.value" style="display:block;line-height:1.8;">
          <input type="checkbox" v-model="atlasTexChecked[i]"/> {{t.label}}
        </label>
      </div>
    </template>
      </div>
    </div>
  </div>

  <!-- ======== TRANSFORM ======== -->
  <div style="margin-bottom:12px;">
    <div style="font-weight:600;margin-bottom:4px;color:#ddd;">Transform</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;">
      <label style="font-size:12px;color:#aaa;">Scale<br/><input v-model="scale" type="number" step="0.1" style="width:100%;"/></label>
      <label style="font-size:12px;color:#aaa;">Offset X<br/><input v-model="offsetX" type="number" step="0.1" style="width:100%;"/></label>
      <label style="font-size:12px;color:#aaa;">Offset Y<br/><input v-model="offsetY" type="number" step="0.1" style="width:100%;"/></label>
      <label style="font-size:12px;color:#aaa;">Offset Z<br/><input v-model="offsetZ" type="number" step="0.1" style="width:100%;"/></label>
    </div>
  </div>

  <!-- ======== ANIMATION ======== -->
  <div style="margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:8px 10px;">
    <div v-if="hasAnims" style="display:flex;align-items:center;gap:6px;">
      <label style="font-weight:600;color:#ddd;display:inline-flex;align-items:center;gap:4px;flex:1;">
        <input v-model="animationEnabled" type="checkbox"/>
        Animation
      </label>
    </div>
    <div v-else style="color:#666;font-size:12px;">No animations in project</div>

    <div v-if="hasAnims && animationEnabled" style="margin-top:8px;">
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:6px;">
        <label style="font-size:12px;color:#aaa;">Animation<br/>
          <select v-model="animationIndex" @change="onAnimChange" style="width:100%;padding:3px;">
            <option v-for="a in animOptions" :key="a.value" :value="a.value">{{a.label}}</option>
          </select>
        </label>
        <label style="font-size:12px;color:#aaa;">FPS<br/><input v-model="animFps" type="number" min="1" max="60" style="width:100%;"/></label>
      </div>
      <div v-if="frameCountPreview" style="font-size:11px;color:#8af;margin-top:4px;">{{frameCountPreview}}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px;">
        <label style="font-size:12px;color:#aaa;">Start (s)<br/><input v-model="animStart" type="number" step="0.05" style="width:100%;"/></label>
        <label style="font-size:12px;color:#aaa;">End (s)<br/><input v-model="animEnd" type="number" step="0.05" style="width:100%;"/></label>
        <label style="font-size:12px;color:#aaa;">Duration (ticks)<br/><input v-model="duration" type="number" min="0" :disabled="generateDatapack" :placeholder="generateDatapack ? 'auto (= nframes)' : '0 = auto'" style="width:100%;"/></label>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:8px;">
        <label style="display:inline-flex;align-items:center;gap:4px;"><input v-model="autoplay" type="checkbox"/> Autoplay</label>
      </div>
      <div v-if="showDatapackOption" style="margin-top:6px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:3px;">
        <label style="display:inline-flex;align-items:center;gap:4px;">
          <input v-model="generateDatapack" type="checkbox"/> Generate datapack
        </label>
        <div v-if="generateDatapack" style="margin-top:6px;font-size:12px;">
          <div style="color:#888;margin-bottom:4px;">Smooth autoplay via GameTime, colorbehavior = time/time/time, duration = nframes</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <label style="color:#aaa;">Animation ID<br/>
              <input v-model="datapackAnimId" style="width:100%;margin-top:2px;" placeholder="anim" maxlength="12"/>
            </label>
            <label style="color:#aaa;">Namespace<br/>
              <input v-model="datapackNamespace" style="width:100%;margin-top:2px;" placeholder="objmc"/>
            </label>
            <label style="color:#aaa;">Target type<br/>
              <select v-model="datapackTargetType" style="width:100%;margin-top:2px;padding:3px;">
                <option value="equipment">Equipment entity</option>
                <option value="item_display">Item display</option>
                <option value="player">Player</option>
              </select>
            </label>
            <label v-if="datapackTargetType !== 'item_display'" style="color:#aaa;">Slot<br/>
              <select v-model="datapackEquipSlot" style="width:100%;margin-top:2px;padding:3px;">
                <option value="mainhand">mainhand</option>
                <option value="offhand">offhand</option>
                <option value="head">head</option>
                <option value="chest">chest</option>
                <option value="legs">legs</option>
                <option value="feet">feet</option>
              </select>
            </label>
            <label style="color:#aaa;grid-column:1/-1;">Output directory<br/>
              <div style="display:flex;gap:4px;margin-top:2px;">
                <input v-model="datapackOutputDir" style="flex:1;" placeholder="(next to exported PNG)"/>
                <button @click="browseDatapackDir" style="padding:2px 8px;cursor:pointer;">...</button>
              </div>
            </label>
          </div>
          <div v-if="datapackTargetType === 'player'" style="color:#c90;margin-top:4px;font-size:11px;">
            Player mode uses a temporary armor stand for color modification.
          </div>
          <div style="color:#666;margin-top:4px;font-size:11px;line-height:1.5;">
            Functions: init, play, stop, set, play_from, play_once<br/>
            <span style="color:#aaa;font-family:monospace;">execute as @e[...] run function {{datapackNamespace}}:animations/{{datapackAnimId}}/play</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ======== DISPLAY (collapsible) ======== -->
  <div style="margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);border-radius:4px;">
    <div @click="showDisplay=!showDisplay"
         style="padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none;">
      <span style="font-size:10px;color:#888;width:12px;">{{showDisplay ? '\u25BC' : '\u25B6'}}</span>
      <span style="font-weight:600;color:#ddd;">Display</span>
      <span style="font-size:11px;color:#666;">thirdperson [{{dThirdRX}}, {{dThirdRY}}, {{dThirdRZ}}]</span>
    </div>
    <div v-show="showDisplay" style="padding:0 10px 10px 10px;font-size:12px;">
      <div style="margin-bottom:8px;">
        <div style="color:#aaa;margin-bottom:3px;font-weight:600;">Thirdperson</div>
        <div style="display:grid;grid-template-columns:28px 1fr;gap:3px 6px;align-items:center;">
          <span style="color:#888;font-size:11px;">Rot</span>
          <div style="display:flex;gap:4px;">
            <div v-for="(ax,ai) in ['dThirdRX','dThirdRY','dThirdRZ']" :key="ai" style="flex:1;display:flex;align-items:center;gap:3px;">
              <input type="range" v-model.number="$data[ax]" min="-180" max="180" step="1" style="flex:1;"/>
              <input type="number" v-model.number="$data[ax]" step="1" style="width:44px;"/>
            </div>
          </div>
          <span style="color:#888;font-size:11px;">Pos</span>
          <div style="display:flex;gap:4px;">
            <div v-for="(ax,ai) in ['dThirdTX','dThirdTY','dThirdTZ']" :key="ai" style="flex:1;display:flex;align-items:center;gap:3px;">
              <input type="range" v-model.number="$data[ax]" min="-80" max="80" step="0.5" style="flex:1;"/>
              <input type="number" v-model.number="$data[ax]" step="0.5" style="width:44px;"/>
            </div>
          </div>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <div style="color:#aaa;margin-bottom:3px;font-weight:600;">Head</div>
        <div style="display:grid;grid-template-columns:28px 1fr;gap:3px 6px;align-items:center;">
          <span style="color:#888;font-size:11px;">Rot</span>
          <div style="display:flex;gap:4px;">
            <div v-for="(ax,ai) in ['dHeadRX','dHeadRY','dHeadRZ']" :key="ai" style="flex:1;display:flex;align-items:center;gap:3px;">
              <input type="range" v-model.number="$data[ax]" min="-180" max="180" step="1" style="flex:1;"/>
              <input type="number" v-model.number="$data[ax]" step="1" style="width:44px;"/>
            </div>
          </div>
          <span style="color:#888;font-size:11px;">Pos</span>
          <div style="display:flex;gap:4px;">
            <div v-for="(ax,ai) in ['dHeadTX','dHeadTY','dHeadTZ']" :key="ai" style="flex:1;display:flex;align-items:center;gap:3px;">
              <input type="range" v-model.number="$data[ax]" min="-80" max="80" step="0.5" style="flex:1;"/>
              <input type="number" v-model.number="$data[ax]" step="0.5" style="width:44px;"/>
            </div>
          </div>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <div style="color:#aaa;margin-bottom:3px;font-weight:600;">Ground</div>
        <div style="display:grid;grid-template-columns:28px 1fr;gap:3px 6px;align-items:center;">
          <span style="color:#888;font-size:11px;">Rot</span>
          <div style="display:flex;gap:4px;">
            <div v-for="(ax,ai) in ['dGroundRX','dGroundRY','dGroundRZ']" :key="ai" style="flex:1;display:flex;align-items:center;gap:3px;">
              <input type="range" v-model.number="$data[ax]" min="-180" max="180" step="1" style="flex:1;"/>
              <input type="number" v-model.number="$data[ax]" step="1" style="width:44px;"/>
            </div>
          </div>
          <span style="color:#888;font-size:11px;">Pos</span>
          <div style="display:flex;gap:4px;">
            <div v-for="(ax,ai) in ['dGroundTX','dGroundTY','dGroundTZ']" :key="ai" style="flex:1;display:flex;align-items:center;gap:3px;">
              <input type="range" v-model.number="$data[ax]" min="-80" max="80" step="0.5" style="flex:1;"/>
              <input type="number" v-model.number="$data[ax]" step="0.5" style="width:44px;"/>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div style="color:#aaa;margin-bottom:3px;font-weight:600;">Fixed (item frame)</div>
        <div style="display:grid;grid-template-columns:28px 1fr;gap:3px 6px;align-items:center;">
          <span style="color:#888;font-size:11px;">Rot</span>
          <div style="display:flex;gap:4px;">
            <div v-for="(ax,ai) in ['dFixedRX','dFixedRY','dFixedRZ']" :key="ai" style="flex:1;display:flex;align-items:center;gap:3px;">
              <input type="range" v-model.number="$data[ax]" min="-180" max="180" step="1" style="flex:1;"/>
              <input type="number" v-model.number="$data[ax]" step="1" style="width:44px;"/>
            </div>
          </div>
          <span style="color:#888;font-size:11px;">Pos</span>
          <div style="display:flex;gap:4px;">
            <div v-for="(ax,ai) in ['dFixedTX','dFixedTY','dFixedTZ']" :key="ai" style="flex:1;display:flex;align-items:center;gap:3px;">
              <input type="range" v-model.number="$data[ax]" min="-80" max="80" step="0.5" style="flex:1;"/>
              <input type="number" v-model.number="$data[ax]" step="0.5" style="width:44px;"/>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ======== ADVANCED (collapsible) ======== -->
  <div style="margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);border-radius:4px;">
    <div @click="showAdvanced=!showAdvanced"
         style="padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none;">
      <span style="font-size:10px;color:#888;width:12px;">{{showAdvanced ? '\u25BC' : '\u25B6'}}</span>
      <span style="font-weight:600;color:#ddd;">Advanced</span>
    </div>
    <div v-show="showAdvanced" style="padding:0 10px 10px 10px;">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px;">
        <label style="font-size:12px;color:#aaa;">Easing<br/>
          <select v-model="easing" style="width:100%;padding:3px;">
            <option :value="0">None</option>
            <option :value="1">Linear</option>
            <option :value="2">Cubic</option>
            <option :value="3">Bezier</option>
          </select>
        </label>
        <label style="font-size:12px;color:#aaa;">Interpolation<br/>
          <select v-model="interpolation" style="width:100%;padding:3px;">
            <option :value="0">None</option>
            <option :value="1">Linear</option>
          </select>
        </label>
        <label style="font-size:12px;color:#aaa;">Auto Rotate<br/>
          <select v-model="autorotate" style="width:100%;padding:3px;">
            <option :value="0">Off</option>
            <option :value="1">Yaw</option>
            <option :value="2">Pitch</option>
            <option :value="3">Both</option>
          </select>
        </label>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:12px;color:#aaa;margin-bottom:3px;">Color Behavior (R / G / B)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
          <select v-model="cbR" style="padding:3px;">
            <option value="pitch">Pitch</option><option value="yaw">Yaw</option>
            <option value="roll">Roll</option><option value="time">Time</option>
            <option value="scale">Scale</option><option value="overlay">Overlay</option>
            <option value="hurt">Hurt</option>
          </select>
          <select v-model="cbG" style="padding:3px;">
            <option value="pitch">Pitch</option><option value="yaw">Yaw</option>
            <option value="roll">Roll</option><option value="time">Time</option>
            <option value="scale">Scale</option><option value="overlay">Overlay</option>
            <option value="hurt">Hurt</option>
          </select>
          <select v-model="cbB" style="padding:3px;">
            <option value="pitch">Pitch</option><option value="yaw">Yaw</option>
            <option value="roll">Roll</option><option value="time">Time</option>
            <option value="scale">Scale</option><option value="overlay">Overlay</option>
            <option value="hurt">Hurt</option>
          </select>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px 16px;">
        <label style="display:inline-flex;align-items:center;gap:4px;"><input v-model="noshadow" type="checkbox"/> No Shadow</label>
        <label style="display:inline-flex;align-items:center;gap:4px;"><input v-model="flipuv" type="checkbox"/> Flip UV</label>
        <label style="display:inline-flex;align-items:center;gap:4px;"><input v-model="nopow" type="checkbox"/> No PoT</label>
        <label v-if="hasArmature" style="display:inline-flex;align-items:center;gap:4px;"><input v-model="filterArmature" type="checkbox"/> Filter Armature</label>
      </div>
    </div>
  </div>

  <!-- ======== EXPORT BUTTON ======== -->
  <div v-if="validationErrors.length" style="margin-bottom:6px;">
    <div v-for="e in validationErrors" :key="e" style="color:#f66;font-size:12px;line-height:1.6;">{{e}}</div>
  </div>
  <div style="display:flex;gap:10px;align-items:center;">
    <button @click="doExport" :disabled="running || validationErrors.length > 0" style="padding:6px 24px;font-size:14px;">
      {{running ? 'Working\u2026' : 'Export'}}
    </button>
    <span :style="{color: status.startsWith('Error')?'#f66' : status.startsWith('Done')?'#6f6' : '#aaa', fontSize:'12px', flex:1}">
      {{status}}
    </span>
  </div>

</div>`,
            },
            buttons: ['Close'],
        });

        dialog.show();
    }

})();
