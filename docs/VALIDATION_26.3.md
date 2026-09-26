# Validation record — 2026-09-26

This is a development candidate. No vanilla Minecraft gameplay session, Intel GPU,
or Apple Silicon machine was available for verification. Compilation and isolated
GPU tests cannot establish complete rendering or hardware compatibility.

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
No automatic backend selection is claimed. Both GPU drivers passed the full
81-program compilation/translation/link matrix. A raster-only exact-helper check
also passed on each GPU: 1,248 indexed draws and 3,432,384 covered pixels with zero
failed draws. It uses no transform feedback, rasterizer discard or storage writes.
The exact helper's NVIDIA
transform-feedback parity test passed, but the AMD test failed all 1,248 draws:
duplicate vertex IDs cannot uniquely recover an invocation lane. This is an
experimental variant with a demonstrated limit; the ordinary-raster success does
not prove all rendering modes or full vanilla Minecraft behavior.

## Subgroup-free research prototype

The isolated carrier transfer passed 48-draw pixel readback tests on NVIDIA and
AMD, including AMD with the exposed API restricted to OpenGL 3.3 at 64×64, 1080p
and 4K. Precision bounds and timings are in
[the prototype record](../tools/portable-carrier/README.md).
This code is not used by either resource pack. It does not yet implement model
rendering, armor, lighting or OIT, and cannot be presented as an Apple M fix.

## Reproduction

Use [test/README.md](../test/README.md). The shaders must resolve vanilla imports
against the official **26.3** client assets. Client assets, native libraries,
compiled binaries and downloaded tools are not redistributed in this repository.
