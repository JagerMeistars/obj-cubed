# Actual GLSL BVH traversal test

```sh
node tools/portable-renderer/bvh-gpu-test.mjs CONVERTED_ITEM.png work/bvh-gpu
cc -std=c11 -O2 -Wall -Wextra -Werror tools/portable-renderer/bvh-gpu-test.c \
  -o work/bvh-gpu-test $(pkg-config --cflags --libs epoxy) -lm
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json \
  work/bvh-gpu-test work/bvh-gpu
```

The vendor override shown selects NVIDIA on the tested Linux system. It is not
required on a single-vendor system and its path is installation-specific.

The preparation script embeds the current `bvh.glsl` unchanged, together with
the actual position/index decoders and affine helper. It records source hashes
in `inputs.json`. A GL 3.3 fragment shader calls `oc_bvh_trace` for every pixel in
a 32×32 floating-point framebuffer. There is no transform feedback. CPU reference
rays come directly from the known view frustum; all animated triangles are
transformed forward into view space. This checks the shader's inverse projection,
inverse model transform, encoded texture traversal and selected nearest face.

The 48 draws cover perspective and orthographic projections, both reversed
depth conventions, all four geometry easing modes, multiple animation frames,
nonuniform/reflected/sheared poses, and an additional affine GUI-like basis.
This isolates the tracer: it does not validate the production vertex stage's
construction of that basis, the final fragment decode, UV/shading, game atlas
loading, culling or OIT. Animation acceleration headers must match tested easing;
the recorded fixture below uses the original global-bounds BVH format only.
For a BF1 input, the harness automatically uses its declared easing for every
draw rather than changing easing while leaving the precomputed bounds stale.

On 2026-09-26, NVIDIA GTX 1650 / driver 610.43.03 / GL 3.3 tested the 2,802-quad,
60-frame heavy fixture at 512×4192. Tracer SHA256 was
`0b93ef10437252910012d5306b7f037ba4bfc7a98497aa92089f817a10f2cf46`.
Of 49,152 pixel selections, 49,151 matched the strict CPU reference; one selected
an adjacent coplanar face with identical hit distance, 0.00001584 world units
outside its exact CPU edge. The test reports this separately as bounded float32
edge rounding. Its explicit bounds are 0.00002 world units outside an edge and
0.0002 difference in hit distance; other mismatches fail the test. There were
1,209 surface hits and no failures beyond that recorded rounding case.

Negative control:

```sh
node tools/portable-renderer/bvh-gpu-test.mjs CONVERTED_ITEM.png \
  work/bvh-gpu-negative --negative-control
work/bvh-gpu-test work/bvh-gpu-negative
```

This changes only the generated copy: an AABB miss incorrectly terminates the
entire traversal. All 1,209 expected surface hits failed, demonstrating that the
oracle detects broken traversal. The production shader remains untouched.

Single-draw GPU timer queries measured mean/min/max 12.02/2.73/34.53 ms at 32×32
in the recorded positive run. CPU reference scans separate these sparse draws;
the GPU was observed in power state P8 at 360 MHz. These measurements expose
substantial shader cost in this configuration, but are not steady-state game
throughput or FPS estimates. No AMD or Apple execution is claimed by this test.

## Compressed animated bounds (BF1)

With the current BF1 shader, SHA256
`c515d7683563da6eaae282d319bbeac9fb4e2ba3f35fc959aeb1a633098eec41`, the heavy
512×5504 fixture at declared easing 0 passed 48 draws / 49,152 pixels / 1,228 hits.
There were no substantive mismatches and one adjacent-edge rounding selection,
0.000000708 world units outside the exact CPU edge. The raw sparse timer mean was
1.706 ms at 32×32; it is **not** a controlled-clock comparison against the earlier
run, nor a game throughput claim.

The converter's small cyclic fixtures additionally check BF1 at easing 1, 2 and
3, including Catmull–Rom overshoot:

```sh
node tools/portable-renderer/build-bvh-test.mjs work/bvh-fixtures
node tools/portable-renderer/bvh-gpu-test.mjs \
  work/bvh-fixtures/easing3/assets/test/textures/item/fixture.png work/bvh-easing3
work/bvh-gpu-test work/bvh-easing3
```

Repeat the last two commands for easing 1 and 2. On the same NVIDIA device, the
three fixtures passed a combined 144 draws / 147,456 pixels / 85,794 surface hits
with **zero mismatches and zero edge allowances**. The optional fixture output
directory must not already exist. A preparation mistake in the initial synthetic
fixture (missing face-marker offset pixels) was fixed before these recorded runs;
the production converter and shader were unchanged by that fixture correction.
