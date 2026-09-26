# Reconstructed fragment depth and Minecraft 26.3 OIT

`generate.mjs` creates private OIT includes from the official 26.3 client files.
It refuses unexpected depth-read counts so a later vanilla change cannot quietly
leave a proxy-depth read behind. Other Minecraft pipelines keep their original
includes.

```js
import { generatePortableOit } from './oit/generate.mjs';
generatePortableOit(vanillaIncludeDir, generatedPackIncludeDir);
```

In the generated fragment shader, include `minecraft:objmc_oit.glsl` in place of
`minecraft:oit.glsl`. Begin `main()` with `oc_init_fragment_depth()`, including
the ordinary vanilla path. After a successful surface intersection:

```glsl
float hitDepth;
if (!oc_project_fragment_depth(actualClipPosition, hitDepth)) discard;
oc_set_fragment_depth(hitDepth);
```

The helper converts clip depth according to `RENDERPEARL_DEPTH_IS_ZERO_TO_ONE`,
rejects an invalid/behind-camera/out-of-range hit, and writes `gl_FragDepth`.
Reject missing hits and perform the usual material alpha test separately.
The existing `executeAlphaOnlyPhase(deviceDepth, alpha)` call remains valid:
depth bounds substitutes the hit depth when one was set. Transmittance binning,
accumulation transmittance sampling, and explicit depth-invariance writes also
use the hit depth. Their screen-pixel lookups continue using `gl_FragCoord.xy`.
Vanilla fragments use their original rasterized depth.

This supports **one actual surface fragment per proxy fragment**. It does not
make a fragment containing several BVH hits equivalent to several rasterized
surfaces: the hardware depth test is applied only once. In all three OIT phases
26.3 compares each surface against the scene depth, with depth writes disabled.
The depth-bounds phase supplies no scene-depth sampler for implementing those
independent tests manually.

The fragment shader must not declare `early_fragment_tests`; its hardware depth
test must observe the reconstructed `gl_FragDepth`. Initializing depth even on
vanilla paths is required once the shader statically writes `gl_FragDepth`.

Run the phase matrix using:

```sh
node tools/portable-renderer/oit/verify.mjs /path/to/extracted/26.3
```

For a GPU golden comparison, set `SPIRV_CROSS` to the translator executable and
provide a scratch output directory. The verifier compiles both the private
helpers and untouched vanilla references with Vulkan semantics, then translates
them to GLSL 330. This translation is necessary: direct compilation of vanilla
sources does not reproduce Minecraft's shader pipeline.

```sh
SPIRV_CROSS=/path/to/spirv-cross node tools/portable-renderer/oit/verify.mjs /path/to/extracted/26.3 /path/to/scratch
cc tools/portable-renderer/oit/depth-test.c -o /path/to/scratch/depth-test $(pkg-config --cflags --libs epoxy) -lm
/path/to/scratch/depth-test /path/to/scratch/gpu-cases.tsv
```

The surfaceless test compares color/OIT coefficients and depth against a real
vanilla surface drawn at the hit's depth, while the custom shader draws its proxy
at another depth. It checks opaque, every OIT phase, additive materials, 4/8/16
coefficients, both viewport depth conventions, and explicit depth invariance.
Cases include ordinary hits, non-unit clip W, near/far rejection, and negative W.
Each case also runs against a preexisting opaque depth with reversed GEQUAL and
depth writes disabled, checking vanilla OIT's per-surface occlusion behavior.
The test context requires OpenGL 4.5 for changing clip-control conventions; that
is a test-harness requirement, not an additional shader requirement.
