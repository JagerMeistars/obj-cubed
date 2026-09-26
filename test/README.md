# Validation

Run `npm ci` and `npm test` for the plugin's encoder, export, animation and shader-math tests.
`npm run test:pack` validates the shipped resource pack and the generated data-pack format without downloading assets.

To compile the real shaders, extract the **Minecraft 26.3 release** client JAR into a directory and install `glslc` and/or `glslangValidator` (Shaderc/glslang). Vanilla shader sources are deliberately not redistributed here. Run:

```sh
npm run test:shaders -- --vanilla /path/to/extracted-26.3-client
```

`--pack /path/to/resource-pack` selects an alternate source pack, such as the separately generated OpenGL-only variant. The default is the repository’s `objcubed` directory.

The argument may also point directly at its `assets` directory. `MC_VANILLA_ASSETS` provides the same setting. Resource locations resolve from the pack first, then vanilla, with their namespace intact. Includes are expanded in place, so conditional imports and their guards remain under control of the GLSL preprocessor.

The matrix covers item/entity/block/terrain, glint, emissive/no-overlay, per-face lighting, dissolve, texture matrices, multidraw terrain, opaque/cutout and all three OIT passes. Additional cases cover 4/16 OIT coefficients, additive accumulation and both depth conventions. `glslc` compiles individual stages to Vulkan 1.2 SPIR-V, matching Minecraft 26.3 for **both** graphics backends; `glslangValidator` also links vertex/fragment interfaces. `--target opengl` is a separate diagnostic and does not validate the Minecraft 26.3 compiler path. Both run when available. Use `--compiler glslc` or `--compiler glslangValidator` to require one explicitly. Missing all requested compilers is an error, never a passing test. `--output /path/to/scratch` retains expanded sources for driver testing or debugging; the default removes its temporary directory.

These checks catch shader syntax, conditional-compilation and interface failures. They do not prove driver support or visual equivalence. Test in an unmodified Minecraft 26.3 release client with opaque/cutout/translucent models, animated armor, every display context, glint, GUI, first-person hands, block terrain and both available graphics backends before publishing a release.

## OpenGL translation and driver checks

Minecraft 26.3 translates its Vulkan SPIR-V to GLSL 330 for the OpenGL backend. Add `--spirv-cross /path/to/spirv-cross` to test that translation. This is a necessary check: successful Vulkan compilation alone does not guarantee that a shader can reach the OpenGL driver.

For a headless Linux driver check, build the small EGL runner (requires a C compiler and libepoxy development files), then pass it to the validator:

```sh
mkdir -p work/shader-validation
cc -O2 -Wall -Wextra tools/render-tester/compile.c -o work/shader-validation/compile -lepoxy
npm run test:shaders -- --vanilla /path/to/extracted-26.3-client --spirv-cross /path/to/spirv-cross --driver work/shader-validation/compile
```

`--gl-version 4.1` requests an older OpenGL context. It does not emulate old hardware or disable newer extensions. The runner reports the real driver/version and fails explicitly if context creation, compilation or linking fails. The default context request is 4.5. No driver checks are counted when translation failed before the driver could run.

To verify a translation issue against the **exact native library shipped with Minecraft 26.3**, use the `lwjgl` and `lwjgl-spvc` 3.4.3 JARs plus the corresponding platform natives from that release's library manifest. Keep those four JARs in a local directory, retain SPIR-V with `--output`, and run:

```sh
javac -cp '/path/to/lwjgl-jars/*' -d work/shader-validation tools/render-tester/MinecraftSpirvCross.java
java --enable-native-access=ALL-UNNAMED -cp '/path/to/lwjgl-jars/*:work/shader-validation' MinecraftSpirvCross /path/to/retained/item-opaque.vert.spv work/shader-validation/item.vert.glsl
```

Use a semicolon classpath separator on Windows. This probe uses Minecraft's GLSL version and compiler options; it does not duplicate runtime resource-binding renaming or an entire game frame.
