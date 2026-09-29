# Windows GPU checks for the direct 26.3 port

These checks create an invisible OpenGL context. They do not start Minecraft,
read game windows, or measure gameplay FPS. Run them outside gameplay benchmark
capture. Node dependencies must already be installed (`npm ci`). The Windows
runner uses existing PrismLauncher Java/LWJGL libraries and never downloads them.

Run commands from the repository root. `$vanilla` must point to an extracted
Minecraft **26.3 client** root containing `assets/minecraft/shaders`. The checks
use actual vanilla includes; missing files fail instead of being stubbed.

```powershell
$vanilla = 'C:/path/to/extracted-26.3-client'
$output = 'audit/my-gpu-check'

# ShaderC Vulkan 1.2 -> Minecraft SPIRV-Cross GLSL 330 -> GPU compile/link.
node tools/render-tester/prepare-matrix.mjs "$output/matrix" $vanilla
& tools/render-tester/run-windows-check.ps1 -Mode matrix -InputDirectory "$output/matrix"

# Real exported item PNG/carriers versus independently baked source geometry.
node tools/render-tester/raster-fixtures.mjs "$output/items" $vanilla
& tools/render-tester/run-windows-check.ps1 -Mode raster -InputDirectory "$output/items"
```

The runner defaults to `%APPDATA%/PrismLauncher`, Java `java-runtime-epsilon`,
LWJGL/ShaderC/SPIRV-Cross **3.4.3**, and GLFW **3.4.1**. Override `-PrismRoot`,
`-JavaDirectory`, `-LwjglVersion`, or `-GlfwVersion` for a different installation.
The compiler libraries should match the targeted Minecraft client. GLFW only
creates the test context; the default is the installed Windows version used in
the recorded verification. Both common Prism native-JAR layouts are supported.

The matrix saves expanded sources, their SHA256 hashes, SPIR-V, translated GLSL,
and compile/link results. It covers 83 combinations of item, entity, terrain,
block, armor, foil, cardinal lighting, cutout, OIT phases/coefficient layouts,
and depth convention defines. It does not render the OIT passes.

The item check uses an asymmetric cube plus five slanted fins (11 quads), a
patterned texture, arbitrary rotations, distinct X/Y/Z scale, explicit hand
context, a half-interpolated animation frame, and vertex offsets 4/28/32.
Reference geometry is built from source OBJ coordinates, not decoded from the
export texture. It saves `direct.png`, `reference.png`, and `results.txt`.
The raster target is 512 by 512, nearest filtering, depth testing, no culling,
no blending, no MSAA. The item fixture disables directional lighting.

Armor parity can additionally compare the unchanged release `41bf938` vertex
decoder against the port. Provide the directory containing the controlled
`audit_armor_chestplate_0.png` and `_1.png` equipment fixtures. The release Git
object must exist locally; this check does not fetch it.

```powershell
$equipment = 'audit/2026-09-28/direct-benchmark-fixtures/26.3/benchmark-models/assets/minecraft/textures/entity/equipment/humanoid'
node tools/render-tester/armor-raster-fixtures.mjs "$output/armor" $vanilla $equipment
& tools/render-tester/run-windows-check.ps1 -Mode raster -InputDirectory "$output/armor"
```

The armor reference uses the release's unmodified `objmc_main.glsl` and
`objmc_tools.glsl` inside the current uniform/interface wrapper and compiles
directly through OpenGL. The port uses ShaderC and SPIRV-Cross. Both use the
current fragment logic. Eight cases cover two layers, body/right arm/mirrored
left arm, rest/arbitrary limb poses, wearer scales 1 and 0.9375, reversed depth,
and vertex offset 28. An OpenGL 4.6 context is requested because the reference
uses native subgroup-quad operations. Items and the compile matrix request 3.3.
This comparison verifies migration parity, not the original armor calibration
or actual Minecraft humanoid draw submission.

A case requires at least 100 reference pixels. Allowed coverage disagreement
is at most the larger of 10 pixels or 0.2% of reference coverage. RGB disagreement
(sum of channel differences above 6) may affect at most the larger of 30 pixels
or 0.5%. Small edge differences are expected from fixed-point export rounding.
Inspect the saved images and counts as well as the PASS result. The checks make
no cross-vendor compatibility claim and do not validate actual atlas stitching,
GUI baking, game batching, equipment ordering, or gameplay performance.

The color-behavior check covers all 125 combinations of the five stored RGB
modes (`direct`, `time`, `scale`, `overlay`, `hurt`) on item, entity, block,
terrain, and equipment carriers. It adds zero/white and RGB24 playback cases,
each with and without the model's `noshadow` flag: 1390 raster cases in total.
It needs the local release `41bf938` Git object and the same installed libraries.

```powershell
node tools/render-tester/color-behavior-fixtures.mjs "$output/colors" $vanilla
& tools/render-tester/run-color-behavior-check.ps1 -InputDirectory "$output/colors"
node tools/render-tester/check-color-behavior.mjs "$output/colors"
```

The fixture exports a white quad with four distinct geometry frames and a real
equipment layer, then varies only color-mode and fullbright header bits. Input
RGB is supplied as a vertex attribute. The hidden 128×128 OpenGL 4.6 renderer
compares current ShaderC/SPIRV-Cross output against the release's original
`main/tools/light` includes in current interface wrappers. The CPU checker
independently computes HSV using the six-sector formula and checks the product
of direct tint, hue, and hurt. It also checks unchanged geometry, time-selected
poses, and reduced coverage under scale. `results.tsv` records every render,
`assertions.json` records contract failures, and selected PNG pairs are saved
under `images/`. A baseline match alone does not prove the color contract.

Equipment retains its existing RGB24 animation-control interpretation; block
and terrain retain their existing behavior without color-mode decoding. These
paths are regression checks, not a claim that they support item tint controls.
The shader `EMISSIVE` define removes the external lightmap texture from the
test, while the separate PNG `noshadow` flag tests fullbright model behavior.
No Minecraft client, Vulkan draw submission, OIT, UI, or gameplay FPS is tested
by this synthetic color check.

Texture-animation checks compare animated exports with a separate static export
of the expected source-image frame or blend. Expected pixels come directly from
the source RGBA images and time, not from decoding the animation header or from
an older shader. A patterned texture distinguishes material, frame, and both UV
axes. Both renders use the same geometry decoder, so this is a texture test.

```powershell
node tools/render-tester/texture-animation-fixtures.mjs "$output/textures" $vanilla
& tools/render-tester/texture-animation-check.ps1 -InputDirectory "$output/textures"
node tools/render-tester/texture-animation-results.mjs "$output/textures"
```

The 736-case matrix covers single strips; static atlases; animated plus static
textures; two, three, and four strips with different lengths; wraparound;
crossfade on/off; two and five ticks per frame; both Flip UV settings; and a
geometry animation manually fixed at two poses while texture time advances.
Each runs through item, entity, equipment, and a GUI orthographic context.
GUI expects frame zero at every time. Additional cases use modern Blockbench
`frameCount`/`display_height` with a logical UV grid smaller than pixel frames,
rectangular frames, a tall native static neighbor, disabled native animation,
and a source without animation metadata.
The source loader uses a minimal Image/canvas adapter, not Blockbench's GUI.

The generator calls the real `buildOutput` and `saveSingleOutput`, and builds
the synthetic torso carrier itself. Its optional third argument selects a saved
plugin source for a reproducible before check. Sources, exports, selected frame
numbers, shader hashes, and selected render PNG pairs are retained in the output
directory. Pixel tests require matching coverage within two pixels and tolerate
at most 0.5% (minimum four) pixels differing by more than two RGB code values.
`summary.json` additionally checks frame wrap, static materials over time, GUI
pinning, and manual geometry pose changes. This tests the plugin's own atlas
layout; actual Minecraft atlas stitching, live gameplay, and Vulkan submission
still require separate runtime checks.

Horse equipment has a separate independent geometry oracle. The CPU fixture
loader bakes and poses the actual installed Minecraft 26.3 `HorseModel` and
`EquineSaddleModel`; the hidden renderer receives every native polygon. Expected
OBJ vertices are transformed directly by the captured body matrix, without
using the shader's carrier-basis reconstruction.

```powershell
& tools/render-tester/horse-native-fixtures.ps1
node tools/render-tester/horse-equipment-matrix.mjs "$output/horse"
& tools/render-tester/horse-equipment-check.ps1 -InputDirectory "$output/horse"
```

The 133 cases cover native poses, uniform scale/reflection, all six carrier
faces, multiple layers, simultaneous armor/saddle, discarded native parts,
per-face emission, malformed headers, vanilla passthrough, RGB24 playback,
geometry interpolation, texture animation/crossfade and wrap. The source-image
and native-light reference is independent; the target is 512×512. See
`docs/HORSE_EQUIPMENT_VERIFICATION_2026-09-29.md` for exact coverage, measured
error bounds and limits. It does not measure Minecraft FPS or Vulkan draws.

## Animal v2 native carrier catalog

The reusable CPU probe reads the installed vanilla 26.3 client and its exact
`LayerDefinitions` / `ModelPart.setupAnim` geometry. It requires Java 25 and a
Prism installation of Minecraft 26.3; it does not open a game world, GPU context
or UI. `-PrismRoot` and `-JavaDirectory` override the installed runtime paths.
All relative output paths resolve from the repository root, even when the
scripts are called from another working directory.

```powershell
& tools/render-tester/run-native-equipment-probe.ps1 -OutputDirectory "$output/native-equipment"
node tools/render-tester/build-equipment-carriers.mjs --input "$output/native-equipment/native-models.json" --output "$output/native-equipment/equipment-carriers.json" --compare tools/equipment-carriers.json
```

This captures 20 native model layers and five poses per model, then generates
16 equipment targets, 50 selected bindings and 292 carrier quads. The generator
validates nondegenerate rectangular geometry and six distinct UV rectangles
per binding. `--compare` fails unless the generated catalog is byte-for-byte
identical to the checked-in catalog. `catalog-checks.json` records the input and
catalog hashes; `native-probe-manifest.json` records the client/probe hashes.
Native pose data contains a timestamp, while the generated catalog is stable.

Nautilus is deliberately shell-only: native body/mouth animation uses
nonuniform scale. Repeated legs and mirrored wings use one canonical carrier,
not independently identified bones. This catalog regeneration is a geometry
check, not proof of rendered pixels, gameplay behavior or FPS.

To intentionally update the checked-in catalog after reviewing a new probe,
pass `--output tools/equipment-carriers.json` without `--compare`, then run
`node tools/sync-equipment-carriers.mjs` to embed it in the standalone plugin.
The default output stays under `audit/native-equipment`. Use a fresh `$output`
directory to retain earlier evidence; these tools do not move archived files.

The same native JSON feeds the independent animal v2 GPU checks. With `$output`
and `$vanilla` from the beginning of this document, run after the CPU probe:

```powershell
node tools/render-tester/equipment-v2-fixtures.mjs "$output/equipment-native" "$output/native-equipment/native-models.json" $vanilla
& tools/render-tester/horse-equipment-check.ps1 -InputDirectory "$output/equipment-native"
node tools/render-tester/equipment-v2-animation-fixtures.mjs "$output/equipment-animation" "$output/equipment-native"
& tools/render-tester/horse-equipment-check.ps1 -InputDirectory "$output/equipment-animation"
node tools/render-tester/equipment-v2-results.mjs "$output/equipment-native" "$output/equipment-animation"
```

The first matrix covers 224 native-pose cases, including rider-only camel reins; the second adds 3,976 animation,
atlas, pivot, emission and invalid-header cases. The second generator inherits
the native/vanilla input paths from the first manifest. Expected geometry and
material pixels come from source OBJ/images and native model matrices, not from
the production shader's single-quad basis decoder. For the recorded oracle,
coverage, error bounds and limits, see `docs/ANIMAL_EQUIPMENT_VERIFICATION_2026-09-29.md`.
