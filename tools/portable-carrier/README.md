# Portable carrier data experiment

This is a **standalone research prototype, not a replacement Minecraft renderer**. It proves that a fragment shader can recover the four positions and UVs of a vanilla rectangular carrier using GLSL 330, interpolation, and derivatives, without subgroup, ballot, shuffle, geometry, or compute extensions. Nothing in this directory is loaded by the resource pack.

The present resource pack still requires its existing vertex subgroup path. These results do not establish Intel or Apple M GPU compatibility; neither was available for testing.

## Build and run

On Linux, install a C compiler, `pkg-config`, libepoxy development files, and a working EGL/OpenGL driver. From the repository root:

```sh
mkdir -p work
cc -std=c11 -O2 -Wall -Wextra -Werror tools/portable-carrier/carrier-test.c \
  -o work/carrier-test $(pkg-config --cflags --libs epoxy) -lm
work/carrier-test
work/carrier-test --full
work/carrier-test --size 3840 2160
work/carrier-test --full --benchmark
```

The default test is 64×64. `--full` uses 1920×1080. `--size W H` changes the viewport; passing a size is not a claim that the prototype is reliable at that size. `--shader PATH` overrides the GLSL file path when running outside the repository root. Each test reads back and checks every pixel of 48 draws. Exit status is nonzero for shader, coverage, precision, or GL errors. The requested context is OpenGL 3.3 and both shaders declare GLSL 330.

On a Linux system with Mesa installed in the standard GLVND location, select its GPU and restrict the advertised API when testing:

```sh
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json \
MESA_GL_VERSION_OVERRIDE=3.3 MESA_GLSL_VERSION_OVERRIDE=330 \
work/carrier-test --full
```

The EGL harness is Linux-oriented. Apple testing needs an equivalent macOS OpenGL context harness; changing these environment variables does not emulate Apple's driver.

## Data transfer

1. Map consecutive source vertices to a virtual full-screen square using `gl_VertexID & 3`. The two indexed triangles cover the viewport once. An arbitrary base-vertex offset rotates the four virtual slots; it does not change coverage.
2. Assign a sparse set of interpolation channels to each virtual slot. Only that source vertex writes its position words, UV, and a weight of one; the other vertices write zeros.
3. In the fragment shader, divide each present channel by its interpolated weight. At a zero weight on the diagonal, divide its derivative by the weight derivative instead. The fourth slot is absent from that triangle and follows from the carrier's parallelogram identity.
4. Recover semantic item/armor corners from the reconstructed UVs. A virtual slot is not an armor body-part index.

All channels must be `noperspective`, and decoding must happen before discard or divergent per-fragment control flow. The source carrier must have four consecutive vertices, the ordinary quad index pattern, and affine rectangular positions/UVs. The test uses indices `0,1,2,2,3,0`, every base offset from 0 through 7, mirrored UVs, non-axis-aligned affine faces, distant origins, and small edges.

The position payload splits each float's bits into 12 low bits, 10 middle bits, and 10 high bits. Keeping the critical upper words small prevents interpolation error from corrupting the exponent or large mantissa bits in the tested cases. Direct float derivatives, direct sparse float division, two 16-bit words, and an 11/11/10 split all exhibited numerical failures during development. This is a measured numerical technique, not an exact interpolation guarantee on every driver or viewport.

The payload contains 48 scalar components. The example declares some `vec3` varyings separately; an integrated renderer may need to pack their spare components to fit its other lighting, overlay, normal, and marker data within the target driver's varying limits. Item UVs must be local marker-texel fractions, not absolute atlas coordinates. Armor UVs can use its fixed layout units, with separate tests for exact layout-boundary classification still required.

The current declarations occupy 14 `vec4` varying locations (56 component slots). Packing them into 12 locations is necessary before budgeting other attributes against the OpenGL minimum of 64 components. Preserving per-corner light UVs adds eight components; packed color, normal, overlay, marker and atlas origin nearly consume the remainder. `GLINT_SPECIAL` also has independent `UV3` coordinates, whose four corners need another eight components unless the representation is redesigned. Ordinary Minecraft geometry must share this packed interface rather than append its existing varyings.

## Verified results

Checks performed on 2026-09-26, with the final 12/10/10 payload:

| GPU / driver | OpenGL context | Viewport | Result | Maximum position error | Maximum local UV error |
|---|---|---:|---|---:|---:|
| NVIDIA GTX 1650 / 610.43.03 | 3.3 | 1920×1080 | 48/48 passed | 0.000488281 | 0.00000111014 |
| AMD Radeon Graphics, Renoir / Mesa 26.1.6 | 3.3, API masked | 64×64 | 48/48 passed | 0.000488281 | 0.00000303984 |
| AMD Radeon Graphics, Renoir / Mesa 26.1.6 | 3.3, API masked | 1920×1080 | 48/48 passed | 0.000488281 | 0.0000965819 |
| AMD Radeon Graphics, Renoir / Mesa 26.1.6 | 3.3, API masked | 3840×2160 | 48/48 passed | 0.000976562 | 0.000231922 |

The largest position errors occur around coordinates 4096, where a float ULP is already 0.000488281. The test permits a small number of ULPs because reconstructing the fourth corner adds/subtracts rounded source positions. At the small-carrier test around coordinates 120, the maximum error was 0.00000762939 at 1080p and 0.0000152588 at 4K on AMD. UV errors above are fractions of one marker texel, not normalized atlas coordinates. The test threshold is 0.0003 texel; it is not a proof for all possible encoded slot markers.

`--benchmark` uses GL timer queries for overlapping full-screen carriers. It includes reconstruction and the proof shader's expected-value comparisons, and excludes PNG decoding, mesh intersection, texturing, lighting, and OIT. It is **not Minecraft FPS**. In one 1080p run, the GTX 1650 measured approximately 1.22 ms for one carrier, 77.54 ms for 64, and 271.05 ms for 256. A Renoir run measured approximately 4.40 ms, 251.92 ms, and 1139.44 ms respectively; timings vary with clocks and driver compilation. A full-screen carrier per mesh face is therefore not a practical replacement for the current mechanism.

## Work required for a renderer

A viable full implementation would need one carrier per model or armor bone and an exporter-built acceleration structure, such as a texture-backed BVH, so each pixel visits only candidate model faces. Bounds must remain conservative across all animation frames and interpolation curves, including Bezier overshoot. Texture animation, alpha cutouts, multiple transparent hits, per-face emission, GUI display transforms, hand transforms, armor mirroring and body-part selection must be preserved.

Fragment reconstruction alone cannot move geometry outside the original rasterized coverage. The full-screen proxy supplies coverage, but depth must come from the actual mesh hit. A renderer must implement projection/clipping, `gl_FragDepth`, fog distances, geometric front/back facing, face normals, light/overlay/glint behavior, and culling separately. A fixed virtual square's `gl_FrontFacing` describes the proxy, not the decoded mesh. Vulkan/OpenGL framebuffer orientation, GUI atlas viewport/scissor behavior, degenerate carriers, and near-plane intersections also remain untested.

Minecraft 26.3 OIT requires more than writing `gl_FragDepth`: its transmittance and accumulation helpers read `gl_FragCoord.z`, and some overwrite `gl_FragDepth` with that value. They must receive the decoded hit depth throughout all OIT phases. A nearest-hit raycaster would lose transparent layers and cannot satisfy feature parity.

Even one carrier per encoded quad does not remove this problem: an animated, folded or nonplanar quad can place both of its triangles at the same pixel. One fragment invocation cannot emit two independently depth-tested transparent fragments. Combining both hits manually is insufficient when an opaque surface lies between them and its depth is unavailable. Separate triangle carriers, with matching exporter and armor-layout changes, are one possible remedy; existing exports would need a migration strategy.

The actual cull state is another unresolved input. In 26.3, some culled and unculled entity OIT depth-bounds/transmittance pipelines use the same shader definitions; the fixed-function cull setting alone differs. A full-screen proxy cannot infer that state from its own facing. Asset-specific metadata or a proven pass-specific scheme is needed before claiming equivalent culling across all supported carriers.

Finally, the existing vertex decoder cannot simply be included four times in a fragment shader. It needs an explicit synthetic-corner interface, followed by perspective-correct mesh interpolation, stable texture gradients, clipping and hit-based lighting. This experiment validates only carrier data transport. It does not establish that a complete, usable fallback can be integrated without a substantial renderer and exporter rewrite.

## Why another subgroup spelling is insufficient

The [Khronos subgroup specification](https://github.com/KhronosGroup/GLSL/blob/main/extensions/khr/GL_KHR_shader_subgroup.txt) does not define a vertex-index mapping for non-fragment quads. The [OpenGL subgroup specification](https://registry.khronos.org/OpenGL/extensions/KHR/KHR_shader_subgroup.txt) also requires separate stage and operation support checks. The [ARB ballot specification](https://registry.khronos.org/OpenGL/extensions/ARB/ARB_shader_ballot.txt) requires a uniform source index for `readInvocationARB`; replacing a quad broadcast with a different source index per four lanes is not valid. Searching uniformly by vertex ID still cannot retrieve a peer outside the subgroup.

This prototype avoids cross-invocation vertex access altogether. It demonstrates a possible building block for a broader vanilla renderer rewrite, while leaving its performance and complete feature preservation unresolved.
