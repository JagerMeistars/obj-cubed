# Experimental subgroup-free renderer

Build the complete Minecraft 26.3 shader pack with:

```sh
node tools/build-portable-pack.mjs objcubed NEW_PACK VANILLA/assets/minecraft/shaders
node tools/prepare-portable-models.mjs EXPORTED_MODEL_PACK NEW_PORTABLE_MODEL_PACK
```

Use the two resulting packs together, with the portable shaders taking priority.
The original `objcubed/` template remains the subgroup renderer.
See [architecture and limitations](../../docs/PORTABLE_RENDERER_26.3_RU.md),
[validation](../../docs/VALIDATION_26.3.md), [BVH format](build-bvh.md),
[item affine parity](item-affine.md), [armor parity](armor-fast.md),
[GPU BVH tests](bvh-gpu-test.md), [armor grouping](build-armor-bvh.md),
[AS1 transfer](armor-affine.md), [equipment specialization](armor-specialization.md), [OIT checks](oit/README.md) and [special glint](glint.md).

The complete stage interface occupies 64 components. Ordinary geometry follows
Minecraft's original shader path. Custom opaque items can use one BVH carrier;
compatible opaque armor uses grouped AS2 BVH carriers. Translucent or incompatible
armor retains one AS1 carrier per quad. The first equipment layer preserves glint
and uses AB1 bounds to reject invisible rays before geometry decoding. Prepare
exported armor as well as opaque items before testing complex models.

## Approximate carrier helper

`carrier.glsl` transfers a vanilla affine quad to a fragment shader without subgroup operations. It uses **24 varying components in six `vec4` locations**, or **36 components in nine locations** with the coarse/residual option. This is the data-transfer helper for an experimental renderer; it does not decode obj³ meshes, rasterize them, or implement Minecraft lighting/depth/OIT.

In the vertex shader, define `OC_PORTABLE_VERTEX` before including the helper. Declare six `noperspective out vec4` values and call:

```glsl
oc_portable_encode(vertexID, position, localUV, p0, p1, p2, p3, uv01, uv23);
gl_Position = vec4(oc_portable_screen_corner(vertexID) * 2.0 - 1.0, 0.0, 1.0);
```

The fragment shader declares matching `noperspective in` values:

```glsl
vec3 carrier_pos[4];
vec2 carrier_uv[4];
bool isCarrier = oc_portable_decode(p0, p1, p2, p3, uv01, uv23,
                                    carrier_pos, carrier_uv);
```

The integrated renderer uses smooth channels because every custom proxy vertex has clip W=1; this is affine for custom carriers and preserves native interpolation for ordinary geometry sharing the interface. The standalone harness below uses explicit `noperspective`.

Call decode **before discard or divergent fragment control flow**. Arrays `vec4 p[4], uv[2]` are also accepted. Ordinary vertices can write all six values as zero; decode then returns false. The array overload `oc_portable_clear(p, uv)` supplies this initialization. Other ordinary-geometry varyings must fit the same stage interface budget.

For the more accurate 36-component option, define `OC_PORTABLE_PRECISE` in both stages and declare three additional matching `noperspective vec4` varyings. Calls become:

```glsl
// Vertex shader:
oc_portable_encode(vertexID, position, localUV, p0, p1, p2, p3, uv01, uv23,
                   high01, high12, high23);
// Fragment shader:
bool isCarrier = oc_portable_decode(p0, p1, p2, p3, uv01, uv23,
                                    high01, high12, high23,
                                    carrier_pos, carrier_uv);
```

Initialize all nine payloads to zero for ordinary vertices. The extra channels store `floor(position / cellSize)` as integer-valued floats; the original position channels store the small residual. The decoder rounds the recovered cell values, combines the three present positions, then infers the absent **full** position. Independently inferring the missing cell would be wrong across a cell boundary. `OC_PORTABLE_CELL_SIZE` defaults to `8.0`; define it identically in both stages to change that. This remains an approximation, despite the macro's name, and can misround cells outside the measured coordinate/viewport range.

Input vertices must have consecutive cyclic IDs and the ordinary quad index pattern. Returned slots are `vertexID & 3`, not semantic model corners. Arbitrary base offsets rotate these slots. Each raster triangle transports its three source corners, and the absent fourth is reconstructed with the parallelogram identity. Thus carrier positions and UVs must be affine rectangles. Arbitrary per-corner color, AO, or light values cannot be recovered exactly using that identity; the initial renderer may need face-constant approximations.

Use marker-local UV fractions for item carriers and transfer their integer atlas origin separately as flat data. For armor, use the fixed 64×32 layout units. Where the source endpoints are known integer layout coordinates, rounding recovered armor UVs before boundary classification avoids small floating-point errors selecting the preceding face. The caller is responsible for that semantic decision.

## Precision measurement

The payload directly interpolates floats, divides by each sparse channel's weight, and uses derivative ratios near zero weights. This deliberately trades position accuracy for a smaller interface. Input positions near a local origin reduce the error; small geometry at large coordinates can distort substantially.

From the repository root, with libepoxy and EGL/OpenGL development support:

```sh
mkdir -p work
cc -std=c11 -O2 -Wall -Wextra -Werror tools/portable-renderer/carrier-test.c \
  -o work/portable-float-test $(pkg-config --cflags --libs epoxy) -lm
work/portable-float-test --full
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json \
MESA_GL_VERSION_OVERRIDE=3.3 MESA_GLSL_VERSION_OVERRIDE=330 \
work/portable-float-test --full
```

Default size is 64×64; `--full` means 1920×1080. `--size W H`, `--shader PATH`, `--precise` and `--cell 4|8|16` are supported. The test checks every pixel of 48 affine/mirrored/base-offset cases and one all-zero ordinary payload. It exits nonzero for missing coverage, invalid reconstruction, or GL errors. It **reports numerical errors rather than certifying them acceptable**; at 1080p all 48 direct-float cases exceed the earlier split-bit prototype's stricter precision target.

Measured on 2026-09-26 at 1920×1080, GLSL/OpenGL 3.3:

| GPU / driver | Position error near origin | Position error near coordinate 120, small carrier | Position error near coordinate 4096 | Local UV error |
|---|---:|---:|---:|---:|
| NVIDIA GTX 1650 / 610.43.03 | 0.0000175685 | 0.00201416 | 0.078125 | 0.00000111014 |
| AMD Renoir / Mesa 26.1.6 | 0.000116065 | 0.0149689 | 0.393799 | 0.0000965819 |

Both runs had zero structural failures and rejected ordinary zero payloads correctly. These numbers are maximum errors across all tested pixels, corners, base offsets and mirrored UVs. Local UV errors are fractions of one item marker texel. This is not an Intel/Apple test, an exact transport scheme, or a full renderer validation. The larger 48-component split-bit research helper remains in `tools/portable-carrier/` for comparison.

## Coarse/residual results

Example: `work/portable-float-test --precise --cell 8 --size 3840 2160`. All runs below checked the same 48 cases and ordinary zero rejection. Coordinates span approximately ±4096 and include coarse-cell boundary crossings; the small-carrier case is approximately 0.05 units wide at coordinates around 120.

| GPU | Viewport | Cell size | Maximum position error | Small-carrier position error | Local UV error |
|---|---:|---:|---:|---:|---:|
| AMD Renoir | 1920×1080 | 4 | 0.000976562 | 0.000408173 | 0.0000965819 |
| AMD Renoir | 1920×1080 | 8 | 0.000981569 | 0.000434875 | 0.0000965819 |
| AMD Renoir | 1920×1080 | 16 | 0.00195312 | 0.000732422 | 0.0000965819 |
| AMD Renoir | 3840×2160 | 4 | 0.00100386 | 0.000961304 | 0.000231922 |
| AMD Renoir | 3840×2160 | 8 | 0.00292969 | 0.00121307 | 0.000231922 |
| AMD Renoir | 3840×2160 | 16 | 0.00488281 | 0.00236511 | 0.000231922 |
| NVIDIA GTX 1650 | 1920×1080 | 8 | 0.000976562 | 0.0000686646 | 0.00000111014 |
| NVIDIA GTX 1650 | 3840×2160 | 8 | 0.000976562 | 0.0000686646 | 0.00000125170 |

All eight runs had zero structural failures. No cell-rounding jump was observed in these cases. Cell size 4 gave lower measured error on AMD; larger cells reduce the integer magnitude but increase residual error. The default remains 8. These are bounded precision measurements, not a guarantee for all driver implementations, coordinates, or mesh sizes.
