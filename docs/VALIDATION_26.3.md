# Validation record — 2026-09-26

This is a development candidate. The subgroup-free portable renderer has now been
exercised in an isolated **vanilla Minecraft 26.3 OpenGL** client on AMD Renoir,
Mesa 26.1.6. Numerical GPU checks also ran on NVIDIA GTX 1650, driver 610.43.03.
No physical Intel or Apple Silicon device was available. Neither compilation nor
these bounded game checks establish universal hardware compatibility.

## Release provenance

The baseline is the published `26.2` release asset `objcubed.zip`, SHA-256
`81c458cf868bb8e974853c5460fdbec448f06c3e56da64768bd7c56e75e9537e`.
Its plugin/shader code matches commit
`41bf938850f15946303f02ff992553e83a1fe072` after CRLF normalization.
The release tag instead references `e993714f577bd0e0cac06b273e485e4944aff982`.
This candidate preserves the archive's later fixes rather than reverting to the tag.

## Exporter and pack

- Clean `npm ci` on Linux; removed the unconditional Windows-only Rollup dependency.
- `npm test`: 23 files, 245 tests passed.
- `npm run test:pack`: JSON, include paths, resource format 97.1 and generated data
  format 121.0 passed.
- First-person marker tests cover both hands, identity transforms, display scales,
  marker capacity, and coexistence with animated-atlas metadata.

## Default KHR ballot shaders

The 81-program matrix covers item, entity, block and terrain, glint variants,
cutouts, OIT phases, coefficient layouts, multidraw and depth conventions.

On NVIDIA GTX 1650, driver 610.43.03:

- 162 ShaderC/glslc stage compilations targeting Vulkan 1.2 passed.
- 81 glslang linked programs passed.
- 162 SPIRV-Cross translations to GLSL 330 passed.
- 81 real OpenGL 4.1 driver links passed.

The exact LWJGL 3.4.3 native SPIRV-Cross shipped with Minecraft was also checked
on representative shaders. Both it and the command-line translator reject the
original quad/shuffle operations on the OpenGL translation path. Constant KHR
ballot broadcasts translate, but their emitted ARB fallback has an invalid
`GL_ARB_shader_int64` extension guard. This still prevents the default candidate
from loading on the tested AMD OpenGL driver. It is not a successful AMD pack check.

On both NVIDIA and AMD Renoir, the carrier parity harness separately compared
the gather with the original quad operation: 2,496 indexed draws per GPU, zero
failed draws. Inactive-source reads are undefined and explicitly excluded.
See [the complete parity record](../tools/render-tester/carrier-gather.md).

## OpenGL-only variant

The separate [compatibility variant](../tools/opengl-compat/README.md) uses legacy
ARB ballot operations. Its own validation results are recorded with those tools.
It must not be submitted to the Minecraft Vulkan renderer: Minecraft does not
enable the required `shaderInt64` and `VK_EXT_shader_subgroup_ballot` features.
No automatic backend selection is claimed. A later actual Minecraft check on AMD
showed distorted custom geometry with this ARB variant despite the isolated raster
test passing; use the new portable renderer for subgroup-free testing. Both GPU drivers passed the full
81-program compilation/translation/link matrix. A raster-only exact-helper check
also passed on each GPU: 1,248 indexed draws and 3,432,384 covered pixels with zero
failed draws. It uses no transform feedback, rasterizer discard or storage writes.
The exact helper's NVIDIA
transform-feedback parity test passed, but the AMD test failed all 1,248 draws:
duplicate vertex IDs cannot uniquely recover an invocation lane. This is an
experimental variant with a demonstrated limit; the ordinary-raster success does
not prove all rendering modes or full vanilla Minecraft behavior.

## Earlier subgroup-free transfer prototype

The isolated carrier transfer passed 48-draw pixel readback tests on NVIDIA and
AMD, including AMD with the exposed API restricted to OpenGL 3.3 at 64×64, 1080p
and 4K. Precision bounds and timings are in
[the prototype record](../tools/portable-carrier/README.md).
That earlier split-bit transfer helper is separate from the complete portable renderer
below. It is retained as research evidence; its successful tests alone do not prove
full rendering or Apple M compatibility.

## Complete experimental portable renderer

`tools/build-portable-pack.mjs` builds all four 26.3 core pipelines without subgroup,
ballot, shuffle, int64, geometry or compute stages. Its interface uses 16 vec4-sized
locations / 64 components. The original decoder formulas are retained. The new
fragment path restores the actual carrier transform and surface depth.

An earlier portable source passed the complete 81-program ShaderC → SPIRV-Cross →
OpenGL 3.3 matrix before the armor rejection addition. That addition has its own
numerical checks below; the final pack matrix is recorded with the delivery.

Completed numerical checks:

- Carrier reconstruction on NVIDIA and AMD, forced OpenGL 3.3: 48 cases at 1080p
  and 4K, including mirrored UVs, arbitrary cyclic vertex offsets and coordinates
  near ±4096. Coarse/residual maximum position error was 0.000982 at 1080p and
  0.00293 at 4K; ordinary zero payloads were rejected correctly.
- Item affine path versus the original decoder on NVIDIA: 12,960 draws / 51,840
  corners, maximum position error 9.54e-7, no UV or visibility mismatches. Coverage
  includes display slots, context markers, GUI/PiP, color controls and reflected,
  nonuniform and sheared transforms. A swapped-axis negative control fails.
- Optimized armor versus the original decoder on NVIDIA: 55,296 draws / 221,184
  corners, zero failed cases; maximum position error 1.53e-5 and UV error 3.73e-9.
  Coverage includes body-part sides, reflected/PiP transforms, routing, geometry
  interpolation, animated texture bands and playback controls.
- Armor rejection: 2,304 draws / 47,552,256 pixels on NVIDIA GL3.3, zero false
  rejections across all parts, UV faces, mirrored limbs and cyclic offsets. AB1
  ray bounds retained 51,840 forward-projected surface points and rejected 810
  deliberate off-box rays, including exact corners, reflected bases, perspective/
  ortho, both depth conventions, scales 0.05–80 and distant small wearers. A
  cancellation-dependent padding correction was required by the stress test.
- AS1 vertex decoding and fragment pose: 34,560 draws / 138,240 corners,
  zero failed cases; maximum position error 1.53e-5 and UV error 5.96e-8.
  Position-only carrier recovery: 3,456 draws / 71,328,384 pixels with no missing
  samples and exact UVs; maximum difference from the generic transfer was one
  float32 ULP (0.00012207 at coordinate 1234).
- Equipment pipeline specialization retains ordinary armor and glint output
  bit-for-bit on NVIDIA and AMD in the native raster comparison; it removes
  item-only decoding only for the actual NO_OVERLAY + PER_FACE_LIGHTING pipeline.
- OIT helpers: 912 NVIDIA and 456 AMD comparisons across 152 programs, covering
  actual surface depth in every phase, coefficient layouts, additive mode and
  depth conventions. NVIDIA additionally checks opaque-scene GEQUAL occlusion.
- BVH converter regression: exact source-row preservation except reserved header
  fields, opaque-only conversion, mixed-material/transparency fallback, all four
  easing modes, conservative Catmull control bounds and cyclic animation.
- Actual BVH GLSL on NVIDIA: 49,152 heavy-model ray selections, zero substantive
  mismatches; one adjacent coplanar edge allowance of 7.08e-7 world units. BF1
  fixtures declaring easing 1/2/3 add 147,456 selections / 85,794 hits with zero
  mismatches. Shader source hashes are recorded by the harness.

### Final AS2 additions

- Complete AS2 candidate driver matrix before the final ray arithmetic fix:
  **83 programs / 166 translated stages**, all NVIDIA OpenGL 3.3 links passed.
- Full final-source ShaderC matrix: **83 programs / 166 stages**, all passed.
  Final item opaque, equipment and equipment-glint also passed SPIRV-Cross and
  native NVIDIA OpenGL 3.3 linking after the ray-precision correction.
- AS2 tracer, selected-face decoder and wearer pose: **18,720 draws /
  4,792,320 pixels / 24,720 hits**, zero failures or edge exceptions on NVIDIA.
  Tests include all 60 frames and four easing modes, real right-arm/left-arm/body
  groups, synthetic nonplanar quads, perspective/orthographic projections, both
  depth conventions and reflected 80× previews. Computing the ray direction in
  view space fixed cancellation in extreme translated previews. Restoring the
  wrong left-limb diagonal produces 362 failures in the negative control.
- The same stable ray construction was applied to item BVH: 49,152 final-source
  ray selections pass, retaining the previously documented single adjacent-edge
  roundoff of 7.08e-7 world units.
- Independent AS2 byte audit: all 244,800 position/UV RGBA texels from 204 quads
  across 60 frames match their AS1 sources; color pixels, row-1 texture animation,
  clocks, target parts, material flags and original first layer also match.
  The 204 input layers appear exactly once in source order in three BVH groups.
- AS2 converter: 18 regression cases cover all easing modes, nonplanar left/right
  geometry, translucency and incompatible metadata fallbacks, first-layer glint
  preservation and coincident geometry with conflicting UVs.
- Repository suite: **245 tests / 23 files**, passed.

### Actual Minecraft checks

An isolated offline test client and private headless gamescope display were used;
no user world, account token or active game options were changed. The client uses
Minecraft's actual ShaderC/SPIRV-Cross resource reload and OpenGL rendering.

- A 24-quad colored model at yaw 45° / pitch 25° was compared with the equivalent
  native vanilla cuboids by swapping the model on the same entity. At 640×360,
  2,547 colored pixels match exactly in silhouette (IoU 1.0); mean absolute RGB
  error is 0.302/255, maximum channel difference 1/255 in that capture. A later BF1 capture at a
  slightly different camera alignment retained IoU 1.0 and MAE 0.236/255, but
  one triangle-edge pixel differed by 112/255; all other pixels differed by at
  most 1/255. This is a bounded fixed
  context comparison, not an exhaustive image suite.
- Sparse linear, cubic and four-point geometry animation visibly moves; the
  exact curves are checked numerically rather than inferred from screenshots.
- Texture animation changes color; translucent overlapping panels blend with
  the world; emissive faces remain bright at night; glint is visible in world
  and both first-person hands.
- Manual frames 0/10/30 produce distinct poses. Play-once settles at frame 39;
  final component/score state and two identical later captures confirm freezing.
- The 2,802-quad / 60-frame dragon renders and animates. The old global-bounds
  version measured about 16 FPS static and 6 FPS animated, close to the camera at
  640×360 on AMD. These are observed F3 values in a private compositor, not a
  controlled benchmark. Final BF1 observations are recorded with the deliverable.
- Corrected simple chest armor renders on the torso and posed arms. The original
  demo had missing source group pivots and attached the geometry above the wearer;
  explicit attachment pivots fix the fixture without changing the shader.
- The initial 18-layer heavy armor caused an AMD guilty-context hard recovery.
  AB1 bounds alone remained too slow. AS1 rendered the full 216-quad animated
  armor without a reset, but only at about 2 FPS at 320×180. Specializing the
  equipment pipeline raised this to about 8 FPS. AS2 groups the compatible
  opaque parts to reduce this fixture from 205 prepared layers to four; its
  final scene results are recorded below. These earlier variants must not be
  treated as the final performance result.
- Custom terrain geometry was loaded through a private block-model override;
  this establishes that path was exercised, not a full native block-pose comparison.

### Final AS2 scene observations

The grouped heavy armor renders its torso and posed red/green arms and visibly
animates in vanilla Minecraft 26.3 on AMD Renoir. At 320×180 the first AS2 build
showed about 33 FPS. At 640×360 it initially showed about 8 FPS; after reloading the
final view-space-ray shaders and settling, two F3 samples showed about 19 FPS.
Simple AS2 armor showed about 17 FPS in that final client. These are scene
observations in a private compositor, not controlled cross-version benchmarks.
The final dragon at the same close camera view showed about 12 FPS at 640×360,
with visible wing and tail motion, matching the previous BF1 observation.
No guilty-context recovery or unresponsive UI occurred with AS2.

The first equipment layer is byte-preserved and the enchanted armor shader links;
a glint override was accepted in game without breaking the model. Foil on the
heavy armor's first layer was not visually distinguishable in the final capture,
so that capture is not treated as positive visual confirmation of armor glint.
Item glint had already been visually confirmed in world and both hands.

### Limits of the claim

The portable variant is approximate: custom surfaces are two-sided, a folded
transparent quad retains its nearest half, and per-corner custom light is reduced
to one value per face. Large transparent models and armor that cannot be grouped still use the expensive
per-face path; compatible opaque armor uses grouped AS2 BVH carriers. The final heavy BF1 texture is 512×5504 (10.75 MiB RGBA before atlas
and mip overhead); lower texture/atlas limits can constrain large exports.
Physical Intel/Apple M, complete Vulkan gameplay, all inventory/third-person/shelf
contexts, arbitrary custom carrier edits and every original feature combination
have not been exhaustively verified. See
[the renderer documentation](PORTABLE_RENDERER_26.3_RU.md) for supported workflows
and [the individual harnesses](../tools/portable-renderer/README.md) for reproduction.

## Reproduction

Use [test/README.md](../test/README.md). The shaders must resolve vanilla imports
against the official **26.3** client assets. Client JARs, native libraries, compiled binaries and downloaded tools are not
redistributed. The pack builder adapts the required vanilla OIT GLSL helpers into
namespaced shader overrides.
