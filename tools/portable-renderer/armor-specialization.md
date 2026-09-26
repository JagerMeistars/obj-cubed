# Equipment shader specialization

The pack builder defines `OC_PORTABLE_ARMOR_ONLY` only when `OC_ENTITY`, `NO_OVERLAY` and `PER_FACE_LIGHTING` are present together. Those flags identify the vanilla 26.3 armor pipeline combinations, including combined glint. The generated armor-only decoder/vertex/fragment includes keep ordinary mode0, legacy armor mode2 and compact armor paths; item classification and the item decoder are removed from these variants. Other core shader variants retain their original includes. Common BVH helpers remain available for grouped armor, while the item BVH entry point is excluded by its own preprocessor guard.

`specialize-armor.mjs` transforms generated copies and fails if the expected source boundaries change. It does not maintain a second handwritten armor decoder or alter `vertex.glsl`/`fragment.glsl`.

The current client jar's `BakedQuad.MaterialInfo.of → Sheets → RenderTypes.item* → RenderPipelines.ITEM_*` chain sends exported JSON item quads through `core/item`. `EquipmentLayerRenderer` selects `armorCutoutNoCull`/glint using the entity snippet. This specialization therefore does not remove item behavior from the dedicated item pipeline. It intentionally does not interpret item-marker textures as item carriers inside the equipment pipeline.

## Validation before grouped AS2 integration

The full generated pack passed166 shaderc stages for Vulkan1.2. The exact armor and armor-glint combinations additionally passed two glslang linked programs, four SPIRV-Cross GLSL330 translations, and real AMD/NVIDIA driver compilation/linking.

On AMD Renoir/Mesa26.1.6/ACO, a bounded one-point driver allocation probe measured:

| AS1 shader | Combined baseline | Specialized |
|---|---:|---:|
| Normal VS VGPR / resident waves | 216 /1 | 84 /3 |
| Normal FS VGPR / resident waves | 256 /1 | 128 /2 |
| Normal FS code bytes | 100,944 | 44,576 |
| Glint specialized VS VGPR / waves | — | 128 /2 |
| Glint specialized FS VGPR / waves | — | 128 /2 |

All measured variants reported zero scratch and zero spilled registers. These are compiler resource measurements, not in-game speed measurements. Later grouped-armor code changes may alter these allocations.

`armor-specialization-test.c` renders the same ordinary textured quad through the unspecialized and specialized complete shaders, using actual UBOs, vertex inputs, lightmap, tint and glint textures. On both NVIDIA GTX1650 and AMD Renoir, both armor and armor-glint variants covered144 pixels in a16×16 float framebuffer and produced **exactly equal RGBA values**, with no GL errors. This establishes ordinary fallback parity for the tested scene, rather than merely checking shader compilation. The shader paths must be the corresponding expanded shaderc→SPIRV-Cross outputs:

```sh
cc -O2 tools/portable-renderer/armor-specialization-test.c -o work/armor-specialization-test $(pkg-config --cflags --libs epoxy egl) -lm
work/armor-specialization-test BASELINE.vert.opengl.glsl BASELINE.frag.opengl.glsl SPECIALIZED.vert.opengl.glsl SPECIALIZED.frag.opengl.glsl
```
