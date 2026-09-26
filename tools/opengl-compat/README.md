# Optional OpenGL compatibility pack

This **experimental** variant is for the **OpenGL renderer only** in vanilla Minecraft 26.3. Select OpenGL before enabling it. It must not be used with the Vulkan renderer, even when the graphics card supports Vulkan. The regular resource pack remains separate and unchanged.

The variant requires vertex-stage `GL_ARB_shader_ballot` and `GL_ARB_gpu_shader_int64`. It is intended to work around Minecraft's bundled SPIRV-Cross fallback on OpenGL drivers such as the tested AMD Renoir driver. Intel graphics are unverified. Apple's OpenGL driver is unsupported. This still uses communication between vertex invocations; it does not make the renderer work on every old GPU.

## Known functional limitation

The exact helper passed the compiler/translation/link matrix on AMD Renoir and NVIDIA GTX 1650. A separate **raster-only** comparison also passed on both GPUs: 1,248 indexed draws and 3,432,384 covered pixels per GPU, with zero failed draws. This mode configures no transform feedback and uses neither rasterizer discard nor storage writes.

The transform-feedback parity test passed on NVIDIA but **failed all 1,248 AMD test draws**. AMD executed duplicate instances of one vertex ID in distinct lanes; neither choosing the first nor the last matching ID can identify both invocations correctly. Transform feedback changes the tested driver's vertex reuse behavior. The raster-only success and this failure are both retained: the helper is not generally equivalent across all execution modes. No complete Minecraft session or Intel GPU has been verified.

## Build

From the repository root, provide the existing main resource-pack directory and a **new**, separate output directory whose parent already exists:

```sh
mkdir -p work
node tools/build-opengl-pack.mjs objcubed work/objcubed-opengl
```

The generator copies all pack assets, replaces only the carrier helper and four vertex-shader extension requirements, and labels the result `[OPENGL ONLY]`. It adds `OPENGL-ONLY.txt` inside the generated pack. It rejects an existing output, input/output nesting, symlinked pack contents, and unexpected shader requirements. It does not modify the input pack or plugin.

Use the generated pack above other resource packs replacing the same core shaders. Re-export models with the Minecraft 26.3 plugin so first-person contexts use the new explicit markers.

## Why a separate pack is necessary

Minecraft 26.3 compiles shaders to Vulkan 1.2 SPIR-V for both graphics backends. It then translates that SPIR-V to GLSL 330 for OpenGL. The bundled translator rejects the original quad/shuffle operations, and its modern subgroup fallback checks `GL_ARB_shader_int64` instead of the actual `GL_ARB_gpu_shader_int64` extension.

Legacy ARB ballot operations take a different translation path which emits the correct OpenGL extension requirements. This helper finds its current invocation lane by broadcasting actual vertex IDs from active lanes, then retrieves the four lanes of that quad. Source indices are constants and reads occur before lane-specific selection. It does not infer the lane from `vertexID / 4`, so an unaligned vertex-arena base is not mistaken for the subgroup boundary.

The helper still relies on a complete carrier face being present in one subgroup quad and on vertex IDs identifying the relevant invocation within the draw. The additional vertex-ID uniqueness assumption is stronger than the regular helper and is violated by the AMD transform-feedback test. ARB ballot masks support up to 64 lanes. Missing/inactive peers are not evidence of correctness; see the parity harness's explicit exclusions.

This path emits SPIR-V `Int64` and `SubgroupBallotKHR` capabilities. Minecraft 26.3 does not enable `shaderInt64` or `VK_EXT_shader_subgroup_ballot` when creating its Vulkan device. A successful SPIR-V compilation therefore does **not** make this pack compatible with the Vulkan renderer. `#ifdef VULKAN` cannot select between backends because ShaderC uses Vulkan semantics for both.

## Validate

After extracting the official 26.3 client assets and installing the compiler tools described in [test/README.md](../../test/README.md):

```sh
npm run test:pack -- --pack work/objcubed-opengl
npm run test:shaders -- --pack work/objcubed-opengl --vanilla /path/to/extracted-26.3-client --spirv-cross /path/to/spirv-cross --driver /path/to/egl-compile --gl-version 4.1
```

`--pack` selects the generated directory; the default pack is never modified. The reported Vulkan target is the compiler input format, not permission to use this variant with Minecraft's Vulkan renderer. The EGL runner reports the actual driver/context version it receives.

The exact LWJGL 3.4.3 native library shipped with Minecraft also translated the representative full item shader pair, which compiled and linked on AMD Renoir and NVIDIA GTX 1650. No vanilla gameplay session, Intel GPU or Apple machine was available. Compilation, linking and isolated parity checks do not prove all in-game visual behavior or performance.

The [carrier gather test](../render-tester/carrier-gather.md) checks the exact optional helper against the old quad operation on real GPUs. The separate [portable carrier experiment](../portable-carrier/README.md) researches a future path without subgroup access; it is not included in this pack.
