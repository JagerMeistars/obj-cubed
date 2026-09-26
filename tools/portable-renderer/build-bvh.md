# Experimental opaque-item BVH converter

```sh
npm install
node tools/portable-renderer/build-bvh.mjs SOURCE_PACK NEW_DESTINATION --validate-rays 512
node tools/portable-renderer/build-bvh-test.mjs
```

`buildBvhPack(source, destination, {validateRays: 512, padPowerOfTwo: false, segmentBounds: true})` is also exported for the
portable pack builder. The destination must not exist. Conversion and validation
finish before it is created. The source is read only; unrelated resources and
skipped models are copied unchanged. The result and `portable-bvh-manifest.json`
list textures, dimensions, model changes and CPU validation results.

Only exported **item** PNGs with entirely opaque color-texture regions and direct,
unrotated north-face carrier model references are converted. All carriers within
each model must have identical attributes except UV: mixed `light_emission`,
`tintindex`, culling or other per-face metadata keeps the original per-face path.
Armor, translucent color textures, inherited/mixed geometry and unsupported layouts are left
alone. This conservative opacity check includes every pixel in every texture
frame, including unused pixels. Texture animation with opaque frames is allowed.
Valid textures narrower than 20 pixels remain unchanged because they do not have
room for the BVH header; widths 20–21 can use global bounds but not segment bounds.

All original PNG rows remain at the same coordinates. Header texels 16–19,
plus 20–21 when animated segment bounds are enabled, are the only changed original
pixels. The ordinary marker remains `(12,34,56,255)`.
Header texel 19 is `(66,86,72,255)`, the ASCII magic `BVH`; texels 16, 17 and 18
store the BVH start row, node count and original image height as big-endian RGB24,
with alpha 255. The width is unchanged. The height appends the node rows and rounds
up to a multiple of 16 for mip alignment; `--power-of-two` optionally pads further.
Every converted model retains element zero and every original display setting.
Its face V coordinates are multiplied by `oldHeight/newHeight`.

Nodes occupy eight consecutive pixels, crossing row boundaries when necessary,
starting at `bvhStartRow*width + nodeIndex*8`:

| Texels | Meaning |
|---|---|
| 0, 1, 2 | Minimum X, Y, Z |
| 3, 4, 5 | Maximum X, Y, Z |
| 6 | First node after this node's complete subtree |
| 7 | Original quad face index, or `0xffffff` for an internal node |

All channels are integer byte values. A bound is big-endian RGB24 decoded as
`rgb24/32768.0 - 256.0`. Minima round down and maxima round up. The other two
values are unsigned big-endian RGB24. **All eight pixels have alpha 255**, which
avoids corrupting data through GUI atlas alpha premultiplication. Children use
preorder layout. On an AABB miss jump to texel 6; on a hit advance one node,
testing both triangles for leaves. A final skip equals `nodeCount`.

Each leaf covers its four vertices in every geometry frame. For every cyclic
Catmull–Rom segment it also covers the two Bezier control points. Their convex
hull contains the entire interpolated curve, including overshoot; these global
bounds remain valid if the easing mode changes. Bounds have an additional allowance for
float32 arithmetic. Source positions lie in `[-128,128)` and these control points
fit comfortably within the wider fixed-point bounds range `[-256,256)`. Bounds
are in encoded model coordinates: the renderer must transform its ray into this
space, including display transforms and any runtime scale.

Animated exports additionally enable compressed per-segment bounds by default.
Disable them with `--no-segment-bounds` or `{segmentBounds:false}`. Header texel
20 is `(66,70,49,255)`, the magic `BF1`; texel 21 holds the appended table's start
row as RGB24. Static exports have no table. Entry index is
`(frame*nodeCount+nodeIndex)*2`. Its first texel's RGB encodes minimum XYZ and its
second texel's RGB encodes maximum XYZ, relative to the corresponding **decoded
global node**: `globalMin+(globalMax-globalMin)*byte/255.0`. Both alphas are 255.

Byte minima round down and maxima round up. Parent entries contain their decoded
compressed child bounds. For declared easing 0, each entry encloses the current
frame; easing 1/2 encloses current and next; easing 3 encloses the actual decoder's
middle Catmull–Rom segment and both Bezier control points, including wraparound.
Unlike global bounds, these entries are tied to the PNG's declared easing. Rebuild
the BVH if that header changes. The shader must use its current geometry frame
to select the matching table entries.

CPU validation reads nodes back from the encoded PNG, checks leaf completeness,
subtree containment, every stored geometry vertex, random intermediate poses,
and nearest ray hits against a brute-force scan of both triangles of every quad.
Rays include axis-parallel cases and misses. It does not validate the GPU shader,
Minecraft's atlas, game performance, shading or depth/OIT behavior.

The 2,802-quad heavy fixture produced 5,603 nodes with depth 13. With global bounds
alone, its 60-frame PNG grew from 512×4096 to 512×4192 (8.1875 MiB RGBA); the static counterpart grew from
512×1024 to 512×1120 (2.1875 MiB). All 18 display models were reduced to one carrier.
At 512 deterministic rays per texture, both had zero BVH/brute-force mismatches.
Animated geometry averaged 155.2 node visits and 28.7 quad tests per ray; static
geometry averaged 77.8 visits and 5.7 tests. These are CPU traversal counts, not
game FPS. A median split is used, and bounds cover the complete animation, so
large motion can reduce pruning considerably. Optional power-of-two padding
doubles these fixture heights, which may exceed a device or game atlas limit.
NPOT loading in the target game remains an integration check, independent of
the converter's CPU validation. Enabling BF1 grows the animated PNG to 512×5504
(10.75 MiB); the table begins at row 4184 and occupies 2,689,440 bytes. On 512
identical rays at declared easing 0, global bounds averaged 155.53 node visits /
28.81 quad tests, versus 81.69 / 5.73 with compressed segment bounds. Both matched
brute force with zero mismatches. The standalone regression covers all four
declared easing modes, cyclic overshoot, source preservation, and fallback cases.

This converter is one component of the experimental portable renderer. A pack
containing collapsed carriers must be used with the matching BVH shader. The
ordinary obj-cubed shader would display only the first quad.
