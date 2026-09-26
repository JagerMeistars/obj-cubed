# AS1 armor vertex predecode

AS1 stores one routed armor quad per equipment texture. Header texel 26 is
`(65,83,49,255)` and texel 27 is `(targetPart,vanillaFace,originalInnerLayer,255)`.
The original animation and texture controls remain intact. Geometry has four
vertices per frame; the texture contains the selected face's exact position
and UV bytes.

`armor-affine.glsl` decodes playback, geometry and texture animation in the
vertex stage. Its shared `oc_decode_armor_as1_quad` also accepts a selected quad
for the AS2 fragment decoder; the AS1 vertex wrapper always selects quad zero.
The fragment stage recovers the carrier's affine pose, retains
the original left/right and large reflected-preview heuristics, then applies
the pose to the decoded quad. It performs no header, animation or index-table
reads. Semantic carrier slots are top-right, top-left, bottom-left, bottom-right.

`oc_parameters` holds texture-frame Y offset, texture blend, flags, and mode 4.
Flag bits 0–2 identify the target part, 3–5 the vanilla face, 6 the original
inner layer, and 7 disabled shadow. Position and UV payloads retain their
existing 12+8 float allocation. The packed normal remains available for
left/right classification and lighting.

The raster proxy clamps each vanilla UV rectangle to the target rectangle.
All disjoint rectangles become lines or points. Matching left and right limb
rectangles share UVs; fragment pose classification rejects the wrong side.
The target-left proxy reverses screen X to retain front winding, and fragment
screen-coordinate reconstruction must apply the same reversal.

The equipment converter preserves the original first layer by default because
vanilla applies the combined equipment glint only to that layer. It can coexist
with the original mode 2 decoder while subsequent layers use AS1. Texture
animation's unused secondary UV differs when the blend is zero; sampled output
is unchanged.

Run exact-reference geometry validation from the repository root:

```sh
node tools/portable-renderer/armor-affine-test.mjs ../minecraft-research/armor-affine-validation
cc tools/portable-renderer/armor-affine-test.c -o ../minecraft-research/armor-affine-validation/parity $(pkg-config --cflags --libs epoxy) -lm -Wall -Wextra -Werror
../minecraft-research/armor-affine-validation/parity ../minecraft-research/armor-affine-validation
```

The test extracts the original armor shader branch and compares it with the
unchanged AS1 helper on a real OpenGL 3.3 driver. The compact fixture preserves
original position/UV streams and remaps the selected quad's four indices per
frame, independently testing the renderer against the old multi-face layout.
It covers all eight parts and four side faces, cyclic arena offsets, ordinary
and reflected preview poses, waist inflation, playback control colors,
easing, texture frames/bands/fades, emissive flags and three lighting modes.

NVIDIA GTX 1650 result: **34,560 draws, 138,240 corners, zero failures**.
The reference and AS1 rejected the same 25,920 incompatible-side corners.
Maximum position error was `1.52588e-5`, UV error `5.96046e-8`, and other
lighting/interpolation error `2.38419e-7`. This is geometry parity evidence;
actual-client performance and raster proxy coverage are separate checks.

The position-only carrier decoder skips generic UV transfer and reconstructs
the exact semantic source UVs from the flat target rectangle. Four explicit
position reads retain the cell/residual representation and derivative fallback
near vanishing interpolation weights. Derivatives run before any per-pixel
discard. AS1 and AS2 use this path; other model modes keep the generic decoder.

The independent raster comparison uses `armor-carrier-test.mjs` and
`armor-carrier-test.c` with the same prepared carrier fixtures. Across 3,456
draws and **71,328,384 pixels**, including 17×13, 64×64 and 320×180 viewports,
all parts, mirroring, cyclic offsets, cell crossings, small carriers and
translations to coordinate 1234, the optimized decoder produced no invalid
or missing samples and exact source UVs. Maximum difference from generic
position reconstruction was one float32 ULP at that distance (`0.00012207`).
