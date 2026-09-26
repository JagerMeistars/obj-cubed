# Conservative armor bounds

```sh
node tools/portable-renderer/build-armor-bounds.mjs SOURCE_PACK NEW_DESTINATION
node tools/portable-renderer/build-armor-bounds-test.mjs
```

The converter appends all-frame bounds to marker-253 armor PNGs. It retains every
equipment layer, model face, original geometry/texture pixel and animation frame.
It also supports translucent textures: the bounds only reject empty space. The
destination must be new; the source is untouched. Narrow textures (width <26) and
already converted images are copied unchanged.

Header texel 23 becomes `(65,66,49,255)` (`AB1`); texels 24 and 25 contain the
bounds row and original face count as big-endian RGB24. Those are the only changed
original pixels. Each face occupies six consecutive texels at
`boundsRow*width+faceIndex*6`: minimum XYZ, then maximum XYZ, in raw `getpos`
coordinates. Each is opaque RGB24 decoded as `integer/32768.0-256.0`.
Minima round down and maxima up, with a float32 allowance. Bounds include every
frame and all cyclic Catmull–Rom Bezier control points, so they remain conservative
for all supported geometry easing modes. New image height is aligned to 16 rows.
Equipment UVs stay unchanged: their addressing uses the fixed humanoid layout,
while the decoder obtains the actual texture dimensions independently.

Include `armor-bounds.glsl` before `armor-fast.glsl` and define
`OC_PORTABLE_ARMOR_BOUNDS` to enable the gated call. The call occurs after the
carrier anchor and basis are known, before texture animation and vertex fetches.
Its inverse transform exactly undoes
`anchor + basis * ((leftMirror(rawPosition + vec3(0,.5,0)) - offset) * scale)`.
It unprojects the fragment ray with `ProjMat*ModelViewMat`, supporting perspective,
orthographic and both reversed-depth conventions. Missing/invalid metadata and
degenerate unprojection conservatively keep the original decode path.
Runtime bounds also receive a small float32 allowance that grows with inverse-ray
and anchor cancellation, including distant or very small wearers. An initial
unexpanded version falsely rejected a scale-0.05 surface near z=-400; the final
padding corrects that case by retaining more fragments when precision is low.

The final helper, SHA256
`61cba781537d235231589a8bbaac7e02a4fe1fa70e0fc4832a85e64bea977a69`, passed the
independent NVIDIA GL3.3 test: all 51,840 forward-projected original surface
samples were retained, and 810 deliberately off-box rays were rejected. Coverage
includes all 216 faces, three animation frames, corners/interiors, perspective
and orthographic projections, both depth conventions, reflected bases, both
sides, and wearer scales 0.05/1/16/80. See `armor-rejection-test.md` for commands
and methodology. This tests the rejection helper, not the full game renderer.

The corrected heavy fixture's 18 textures grew from 128×1024 to 128×1040,
adding 144 KiB RGBA in total. The simple fixture's three textures grew from
32×512 to 32×528, adding 6 KiB. Original image bytes are unchanged except headers
23–25; transparency is preserved. Conversion verified 2,799,360 heavy-fixture
frame coordinates against the decoded bounds.

This reduces costly decoding of off-model fragments; it does not eliminate the
full-screen proxy workload. CPU conversion checks alone do not prove GPU safety
or successful heavy-armor rendering in Minecraft. Actual GPU conservativeness
and game stress results must be reported separately.
