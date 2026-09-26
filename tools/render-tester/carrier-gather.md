# Carrier gather: real GPU parity check

`carrier-gather.c` compares a carrier helper with the old `subgroupQuadBroadcast` on an actual OpenGL driver. Both operations execute in the same vertex invocation and active branch. By default, transform feedback captures their comparison results; `--raster` instead checks fragment colors after ordinary rasterization. It is a parity test, not a CPU implementation of the gather and not proof of universal quad scheduling.

From the repository root, with a C compiler, `pkg-config`, libepoxy development files, and an EGL/OpenGL driver installed:

```sh
mkdir -p work
cc -std=c11 -O2 -Wall -Wextra -Werror tools/render-tester/carrier-gather.c \
  -o work/carrier-gather $(pkg-config --cflags --libs epoxy) -lm
work/carrier-gather
```

On a Linux system with Mesa in the standard GLVND location, select that driver:

```sh
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json \
work/carrier-gather
```

The default reads the shipped file directly. This Linux EGL harness requests OpenGL 4.5 and requires vertex-stage KHR ballot/quad support for its reference plus ARB ballot support. It cannot test hardware lacking the legacy reference extension.

By default, two backends are tested:

- The helper's original `subgroupBroadcast` calls.
- The same helper with constant broadcasts mapped to `readInvocationARB` and the corresponding ARB subgroup built-ins. This exercises the ARB operations used by the OpenGL translation path; it does not itself invoke ShaderC or SPIRV-Cross. The shader compilation matrix checks that separate pipeline.

`--helper PATH` instead tests that file **once, unchanged and without operation aliases**. It enables ARB ballot/int64 extensions and defines `OBJMC_VERTEX_ID` as `gl_VertexID`. This mode exercises the optional helper's actual lane-recovery algorithm rather than the adapter above:

```sh
work/carrier-gather --helper tools/opengl-compat/objmc_carrier.glsl
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json \
work/carrier-gather --helper tools/opengl-compat/objmc_carrier.glsl
```

The exact-source mode additionally requires `GL_ARB_gpu_shader_int64`. KHR operations remain in the independent reference and diagnostic code only.

Use `--raster` to test indexed rendering without transform feedback:

```sh
work/carrier-gather --raster --helper tools/opengl-compat/objmc_carrier.glsl
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json \
work/carrier-gather --raster --helper tools/opengl-compat/objmc_carrier.glsl
```

This separate link/draw path never declares transform-feedback varyings, enables rasterizer discard, or writes shader storage. Each indexed quad occupies an isolated 8×8 screen tile. The vertex shader smoothly interpolates its nonnegative mismatch count; the fragment shader writes red for an error and green otherwise. Readback checks every covered pixel and requires coverage of every full quad's interior, so a blank draw cannot pass. Inactive source peers remain excluded in the vertex comparison, but raster mode cannot report exact per-invocation comparison totals. The tile positions deliberately replace the test attributes' clip position; their position and UV values still supply the gather inputs.

Each backend makes 1,248 indexed draws. Cases include 1–257 quads, counts around 32-/64-lane subgroup boundaries, base vertex offsets 0–7, normal/reversed quad ordering, all-custom and mixed custom/ordinary quads, deliberate per-vertex divergence, and an extra three-vertex triangle leaving an incomplete quad. Position and UV inputs differ across vertices. All active, valid peer values must match exactly. Transform-feedback mode also checks captured vertex IDs, branch participation, and primitive counts.

A ballot identifies inactive source lanes. Reads from those lanes have undefined results under the reference operation, so they are **excluded and counted**, never treated as evidence of parity. Divergent and partial-tail tests therefore establish parity only for their active peers.

## Results on 2026-09-26

Default helper, both backends, transform-feedback mode:

| Driver | Subgroup width | Indexed draws | Captured vertices | Valid peer comparisons | Excluded inactive peers | Failed draws |
|---|---:|---:|---:|---:|---:|---:|
| NVIDIA GTX 1650, 610.43.03, OpenGL 4.5 | 32 | 2,496 | 643,104 | 1,783,072 | 121,440 | 0 |
| AMD Radeon Graphics (Renoir), Mesa 26.1.6, OpenGL 4.6 | 64 | 2,496 | 643,104 | 1,754,976 | 149,536 | 0 |

A negative control that deliberately returned corner 1 in place of corner 2 failed all 2,496 draws on NVIDIA and exited nonzero. The corrupted helper was kept outside the repository.

The optional OpenGL helper's original two-pass algorithm, which finds its lane by matching `OBJMC_VERTEX_ID`, produced different results when tested as exact source:

| Driver | Indexed draws | Captured vertices | Valid peer comparisons | Excluded inactive peers | Failed draws |
|---|---:|---:|---:|---:|---:|
| NVIDIA GTX 1650, 610.43.03 | 1,248 | 321,552 | 891,536 | 60,720 | 0 |
| AMD Radeon Graphics (Renoir), Mesa 26.1.6 | 1,248 | 321,552 | 877,488 | 74,768 | 1,248 |

On AMD, the smallest indexed quad executes vertex ID 0 in both lane 0 and lane 5. Both invocations produce transform-feedback records. Selecting the last matching ID gives incorrect peers to lane 0; a separate first-match experiment instead gives incorrect peers to lane 5. Equal vertex IDs and attributes cannot distinguish these duplicate invocations. Transform feedback can affect vertex caching, so this establishes a failure for this execution path, not that every ordinary Minecraft draw fails. It nevertheless prevents claiming that ID-based lane recovery is generally equivalent to the old operation. The exact-source test deliberately reports the mismatch rather than excluding these active peers.

The same optional helper, unchanged, **passes the raster-only mode** on both GPUs:

| Driver | Indexed draws | Submitted vertex indices | Covered pixels checked | Failed draws |
|---|---:|---:|---:|---:|
| NVIDIA GTX 1650, 610.43.03 | 1,248 | 321,552 | 3,432,384 | 0 |
| AMD Radeon Graphics (Renoir), Mesa 26.1.6 | 1,248 | 321,552 | 3,432,384 | 0 |

A raster negative control that adds 1 to every gathered position's X coordinate fails all 1,248 draws on each GPU and exits with status 2. This temporary corrupted helper is outside the repository. The raster pass and the transform-feedback failure together demonstrate that execution/caching behavior matters for ID-based lane recovery; neither result should replace the other.

Each valid peer comparison checks all three position and both UV components. The differing valid/excluded counts reflect driver execution behavior; they are not failures. A nonzero exit status indicates an unavailable required capability or a test failure.

The default helper matches the reference in both tested transform-feedback backends. The optional helper matches it in the tested ordinary raster draws on both GPUs, but fails under AMD transform feedback. These are bounded observations, not Intel or Apple compatibility, performance measurements, full Minecraft rendering validation, or a guarantee that every model face occupies one complete subgroup quad. The [KHR GLSL specification](https://github.com/KhronosGroup/GLSL/blob/main/extensions/khr/GL_KHR_shader_subgroup.txt) leaves vertex-stage quad mapping unspecified. The [ARB ballot specification](https://registry.khronos.org/OpenGL/extensions/ARB/ARB_shader_ballot.txt) requires a uniform source invocation index, which the helper supplies through compile-time constants.
