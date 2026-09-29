# objcubed GPU verification, 2026-09-28

Tested the working `codex/direct-port-26.3` shaders against the published 26.2
release decoder (`41bf938`) and independent source geometry. All isolated checks
below were rerun after applying the runtime-verified derivative-order fix.

Hardware: NVIDIA GeForce RTX 4060 Ti, Windows driver 595.71. Minecraft's installed
LWJGL ShaderC/SPIRV-Cross 3.4.3 was used; SPIRV-Cross reports commit `6328376`,
2026-07-08T15:13:17. The 26.3 client archive SHA256 is
`4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d`.

| Check | Result | Completed UTC |
| --- | --- | --- |
| Actual 26.3 ShaderC -> SPIRV-Cross -> native GPU program link | 166/166 stages compiled and translated; 83/83 programs linked | 20:24:24 |
| Item pixels against independent source OBJ mesh | 8/8 cases passed | 20:24:27 |
| Armor pixels against original release decoder | 8/8 cases passed | 20:24:30 |

Real Minecraft 26.3 OpenGL captures exposed a separate lighting defect on tiny
OBJ faces: derivatives were evaluated after alpha discard. The original 26.2
shader calculated lighting before discarding; native Minecraft normals are
provided by the vertex shader. The fix computes `dFdx(Pos)` and `dFdy(Pos)` at
the start of all four fragment shaders, then uses those values in the existing
custom lighting. Texture sampling, light equations, the native color path,
geometry, and vertex shaders are unchanged by this fix.

The same 51-model scene and corrected atlas configuration were captured before
and after the derivative change, with a native model reference in each capture.
The saturated-color mask excludes moving clouds and sky; it finds zero pixels
in both empty reference scenes.

| Live OpenGL native-versus-OBJ metric | Before fix | After fix |
| --- | --- | --- |
| Visible colored coverage IoU | 0.99990082 | 0.99990082 |
| Common colored pixels | 70,572 | 70,572 |
| Exact RGB matches | 67,562 | 70,525 |
| Pixels with any RGB channel difference above 5 | 3,003 | 40 |
| Mean absolute RGB error, 0–255 scale | 2.332337 | 0.033961 |

This confirms removal of the observed dark-pixel regression without changing
visible coverage. The remaining small differences mean the result is not a
claim of universal pixel-exact rendering. Evidence is in
`audit/2026-09-28/color-before-normal.json`, `color-after-normal.json`, and their
referenced original PNGs; source hashes and reproduction are recorded below.

The item cases cover 11 quads, arbitrary XYZ pose, nonuniform XYZ scale,
first-person context markers, half-frame linear animation, and shared-buffer
vertex offsets 4/28/32. Seven cases had identical coverage; one differed by one
edge pixel out of 19,742. Between 2 and 10 covered pixels per case differed in
RGB; mean absolute channel error was 0.00689–0.02805 on the 0–255 scale. Source
coordinates and a conventional textured native mesh form the independent
reference. No model position or UV is decoded back from the PNG for that reference.

The armor cases cover body and both arms, mirrored left-arm geometry, two
equipment layers, arbitrary separate limb poses, wearer scales 1/0.9375, and
reversed depth. Four cases missed one boundary pixel; all had zero extra pixels.
RGB disagreement affected 0–2 pixels per case, with mean absolute channel error
0–0.01209. The reference preserves the original release's vertex decoder while
adapting its uniform/interface wrapper to the harness. Both sides use the current
fragment logic. The original decoder uses native OpenGL subgroup-quad operations;
the port traverses the actual 26.3 ShaderC/SPIRV-Cross route.

Final isolated evidence resides under `audit/2026-09-28/final-direct-matrix`,
`final-direct-raster`, and `final-direct-armor-raster`: expanded shaders, source hashes, SPIR-V/translated GLSL,
real exported textures/carriers, expected geometry, rendered PNGs, and numeric
results. The earlier `direct-*` evidence remains intact.
`audit/2026-09-28/final-direct-gpu-evidence.json` records final evidence/source
hashes and timestamps. Reproduction commands and exact tolerances are documented
in [the render tester](../tools/render-tester/README.md).

The isolated checks and the additional live color capture do not establish
Minecraft FPS, OIT visual correctness, GUI/item-atlas baking, atlas stitching,
game batching, entity layer ordering, original armor calibration accuracy, or
support on another driver. The direct carrier still assumes four consecutive
subgroup invocations belong to a quad; testing several offsets on NVIDIA does
not establish that scheduling assumption on every GPU backend. Gameplay results
must be reported separately from these checks.

Final live captures were then compared for **all four complete series**: 26.2
OpenGL, 26.3 OpenGL, 26.2 Vulkan, and 26.3 Vulkan. Only each run's `final/`
directory was used, never earlier `results/` screenshots. In all four series,
native-versus-OBJ visible colored coverage IoU is **0.99990082**. The final RGB
MAE is **0.028765/255** for 26.2 and **0.033961/255** for 26.3 on either backend.
Within each version, static cube/native-medium/OBJ-medium pixels match exactly
between OpenGL and Vulkan; armor differs by one channel step in one pixel.
Static coverage is identical across versions. Both animation captures change
in every series, but their phases were not synchronized across runs. Full CPU
metrics, source PNG hashes, and capture times are in
`audit/2026-09-28/final-live-raster-analysis.json`.

The final-authorized Vulkan context screenshots also show the models in first
person, third person, and inventory. First-person and inventory item regions
in 26.3 match native coverage and RGB exactly: **315,301** visible held-item
pixels after excluding HUD overlays, and **896** inventory-icon pixels. Native
and OBJ first/third-person display attributes both specify identity rotation,
translation, and unit scale; this intentionally makes the first-person cube
large and viewport-clipped. Third-person captures have unsynchronized player
idle poses and different chat overlays, so they establish visibility only,
not precise pose/color parity. Inventory measurements cover the item icon,
not the entire GUI or player preview. These boundaries and all six captures
per Vulkan version are recorded in
`audit/2026-09-28/final-vulkan-context-analysis.json`. Original PNGs were not
modified by either CPU analysis.
