# AS2 grouped armor converter

`buildArmorBvhPack(source, newDestination, options)` groups compatible opaque **AS1** armor quads into a stackless BVH. Run the existing `buildArmorVertexPack` first for ordinary exported armor. Source files remain untouched, output must be a new directory, and all original texture files remain available in the output. Equipment JSON references are changed only for successful groups of two or more quads.

```sh
node tools/portable-renderer/build-armor-bvh.mjs SOURCE_AS1_PACK NEW_DESTINATION
node tools/portable-renderer/build-armor-bvh-test.mjs NEW_TEST_DIRECTORY
```

Options: `preserveFirstLayer=true`, `segmentBounds=true`, `validateRays=512`. The result and `portable-armor-bvh-manifest.json` report mappings from each merged face ID to its source texture and equipment-layer index, sizes, node counts, exact copied/verified texels and CPU validation results.

## Compatibility restrictions

The first equipment layer is preserved by default because vanilla applies equipment glint to that layer. Non-AS1 textures, widths below32, player-texture layers, singletons and unsupported routes remain unchanged. Every actual color texel must have alpha255; translucent groups retain the individual AS1 path.

Grouping requires exact equality of target part, original inner-layer flag, per-face emission, all layer JSON properties except texture, material/control/shadow/animation-clock header bytes, the full second metadata row, and all color-image bytes. Only storage-layout counts/pointers and per-face routing are normalized in the comparison key. Different timings, dye properties, texture-animation bands or emissions cannot silently merge.

Identical animated geometry with different UVs prevents that group from merging. This check canonicalizes cyclic/reversed corner order. Other coplanar overlaps can still need a raster-depth tie policy; the runtime uses source-order face IDs, but BVH hit selection is not a general proof of equality with every hardware depth-tie case.

## Texture ABI

The ordinary marker remains `(12,34,56,253)`. Width is unchanged. The usual vertex/position/UV counts describe the merged geometry; color images and the complete second metadata row retain their original bytes. Data positions remain raw exporter coordinates: **no armor offset, left reflection, half-block Y shift or wearer scale is baked into them**.

| Header texel on row0 | Value |
|---|---|
| 26 | `(65,83,50,255)`, ASCII `AS2` |
| 27 | target part, north-face code3, original inner-layer flag,255 |
| 28 | BVH start row, RGB24 big-endian |
| 29 | BVH node count, RGB24 big-endian |
| 30 | Per-frame segment-bound start row, or0 |
| 31 | `(65,66,50,255)`, ASCII `AB2` |

Texel20.r contains the common emission; all grouped quads use the north carrier. Original material/shadow flags and playback controls retain their values. The first legacy layer is kept separately.

For `F` frames and `N` quads, frame-major vertex number is `frame*(4*N)+face*4+corner`. Position and UV index streams both point at that vertex number. Each source position texel and UV texel is copied as all four bytes, then independently compared with the source buffer before output. Colors are copied without re-encoding.

Each BVH node occupies eight pixels: minXYZ, maxXYZ, subtree skip index, and source face ID (`0xffffff` means internal node). Bounds use the shared fixed encoding `RGB24/32768 -256`, rounded outward. Every acceleration-data texel is opaque. Global bounds include every frame and the cyclic Catmull–Rom control hull. Optional segment bounds use two pixels/node/frame, three RGB minimum/maximum fractions relative to the decoded global bounds. They match the texture's declared easing; changing easing after conversion requires rebuilding.

The tree is preorder and stackless; source face IDs retain equipment-layer order independently of tree sorting. Left targets3/5/7 use the runtime's reflected diagonal `(3,2,1)` and `(1,0,3)` in CPU ray validation. Final texture height is rounded to16 pixels, without power-of-two expansion.

## Recorded fixture checks

Heavy corrected armor:205 AS1/legacy layers become4 layers (one legacy plus three68-quad groups for torso/right/left). Each group has60 frames,135 nodes, depth8, a128×1072 texture and64,800 bytes of segment bounds. All244,800 position/UV RGBA texels were verified byte-exact; an independent audit also verified source-layer coverage, color bytes and playback/material metadata.512 randomized rays per group compared the compressed-bound traversal against complete triangle enumeration with zero distance mismatches.

Simple corrected armor:13 layers become4; groups contain2,2 and8 quads with40 frames. The same byte checks and512-ray comparisons passed.

The standalone regression script passes18 cases covering all four easing modes, left/right nonplanar quads, static data, transparent fallback, mismatched clocks/shadow/second-row data/emission/part/inner-layer/layer properties, conflicting coincident UVs, source preservation and first-layer preservation. These CPU checks do not substitute for actual GLSL traversal or in-game performance tests.
