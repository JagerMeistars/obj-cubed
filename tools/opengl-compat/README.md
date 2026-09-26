# Optional fast OpenGL compatibility pack

This experimental variant keeps the original vertex renderer in vanilla Minecraft 26.3. It requires vertex-stage `GL_ARB_shader_ballot`, `GL_ARB_gpu_shader_int64` and `GL_ARB_shader_draw_parameters`. Select **OpenGL**, not Vulkan. Intel hardware remains unverified; Apple's OpenGL implementation lacks the required functionality.

## Build

Use a resource pack containing the 26.3 shaders and ordinary exported model assets. Each output directory must be new and separate from its input:

```sh
mkdir -p work
node tools/prepare-opengl-models.mjs my-resource-pack work/guarded-models
node tools/build-opengl-pack.mjs work/guarded-models work/opengl-pack
```

Preparation preserves original vertex/UV data and every animation frame, adds 16 invisible carrier faces at each end of an item instance, and updates its PNG tables and JSON models. It emits only marker rows with alpha 1–254; rows 0/255 are reserved in the data but omitted from JSON. Thus real faces use one blended material, including large exports and forced translucency. This can change ordering of rare faces that previously used a cutout material because their backpointer happened to have alpha 0 or 255.

Guards prevent the observed AMD instance-boundary loss. They add 32 submitted quads per encoded item instance, not per animation frame. Armor equipment textures and native armor meshes are unchanged. Preparation refuses unsupported carrier layouts, oversized output textures and repeated conversion. Keep the original export to rebuild or use another renderer.

For a shader-only pack, run the second command directly on `objcubed`. Model assets still need preparation: an unguarded model can work in one scene and lose faces when batching changes. Do not use the portable BVH conversion with this renderer.

## Carrier recovery

The preceding helper searched for its physical lane by vertex ID and read four adjacent lanes. AMD can execute duplicate vertex IDs, and hardware groups can cut through a face. Both assumptions caused actual Minecraft corruption.

The new item helper identifies an instance from the draw's base vertex, encoded face rank, draw ID and texture origin. All NORTH carriers of an exported item repeat the same four positions. It gathers corners from any carrier of that instance and restores the receiving face's UV offset. Grouped ballots avoid scanning every hardware lane. The main decoder receives the draw-local corner instead of using the arena-wide vertex ID modulo four.

Armor gathers repeated physical corners across the six faces of its native cube. Four independent corners allow affine recovery; sparse cases use standard humanoid box dimensions and a rigid bone pose. A two-point fallback also uses the packed normal, so it is approximate and can introduce small position differences. Custom nonuniform bone poses are not covered by that sparse fallback. The existing inventory reflection convention is retained.

These operations still communicate between vertex invocations. OpenGL does not guarantee a particular vertex-to-group schedule. Guards and cube recovery are tested mitigations for the observed drivers, not proof for every older GPU.

## Validation

GPU tests compare returned values with independent CPU geometry, rather than using the former subgroup implementation as their reference:

The Linux GPU runners require Node.js, a C compiler, `pkg-config`, libepoxy development files and an EGL OpenGL driver.

```sh
node tools/render-tester/fast-carrier-check.mjs item
node tools/render-tester/fast-carrier-check.mjs armor
node tools/render-tester/coordinate-decode.mjs
npm test
```

Set `__EGL_VENDOR_LIBRARY_FILENAMES` to select an installed EGL vendor. `--quick` reduces the carrier corpus. `--stress` additionally tests deliberately incomplete primitives and per-vertex divergence; missing peers in those cases are reported separately and can produce a nonzero exit status.

Tests cover AMD Renoir/Mesa 26.1.6 and NVIDIA GTX 1650/610.43.03. Actual Minecraft checks additionally use isolated clients. See [the validation record](../../docs/FAST_OPENGL_26.3.md) for in-game evidence, performance measurements and remaining limits.

Minecraft compiles both backends through Vulkan SPIR-V. This helper uses the legacy ARB translation path, avoiding the bundled SPIRV-Cross subgroup fallback. The vanilla Vulkan device does not enable the required legacy capabilities; successful compilation is not Vulkan runtime compatibility. `#ifdef VULKAN` cannot distinguish Minecraft's selected renderer.
