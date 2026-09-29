# Texture animation and atlas verification — 2026-09-29

**Плагин 0.8.4: 736/736 GPU-сравнений и 154/154 проверок времени прошли.** Исправлены
обратный порядок кадров при Flip UV в анимированном атласе и неверное чтение
размера кадра из современных данных Blockbench. Анимация текстур работает
совместно с атласами, включая несколько полос разной длины и статичные текстуры.
GUI-иконки остаются на кадре 0.

## What was tested

The real plugin `buildOutput` and `saveSingleOutput` produce each tested model
and equipment layer. An independent reference selects the expected frame from
the original RGBA source, or blends two source frames on the CPU, then exports
that image as a **static** texture. The GPU compares the animated export with
this static reference. Expected colors do not come from animation headers or
an older shader. A pattern identifies material, frame, and both UV axes.

| Coverage | Result |
|---|---|
| Single strip, static multi-texture atlas, animated + static atlas | Pass |
| Two, three, and four strips with different frame counts (2–5) | Pass |
| Frame wrap; crossfade on/off; 2 and 5 ticks per frame | Pass |
| Flip UV on/off, including animation inside an atlas | Pass |
| Geometry fixed at frames 0 and 3 while texture time advances | Pass |
| Item, entity, worn-equipment carrier, orthographic GUI | Pass |
| Modern Blockbench metadata with a logical UV grid smaller than frame pixels | Pass |
| 32×16 rectangular frames, single and inside an atlas | Pass |
| A tall 32×96 native static texture beside an animated strip | Pass |
| Manually enabled strips with native animation disabled or metadata absent | Pass |

GUI renders match frame 0 at every sampled time. They do not animate after
Minecraft bakes them into the inventory atlas. Texture animation and geometry
animation use separate clocks in the tested world/equipment paths.

## Before and after

The initial 576-case comparison failed **157** raster cases and **6** temporal
checks. All raster failures belonged to animated atlases with Flip UV, or to
modern Blockbench metadata. The same 576 cases pass after the corrections.
The final matrix adds 160 rectangular/static/fallback cases: **736/736** pass,
with **154/154** temporal checks passing.

Flip UV previously reversed frame order inside an atlas: at time zero the
three-frame strip showed its last frame. Frame storage now preserves animation
order independently of flipping pixels within a frame. Frame dimensions now
come from Blockbench's native frame count and image dimensions; the logical
`uv_height` grid is not treated as a pixel height. UV remapping and animation
bands use the same resolved frame height, including static textures.

The full CPU suite passes **320/320 tests**, including **21 new atlas-animation
and UI regression tests**. The dialog's frame count and preview validation now
use the same frame-size rules as export: rectangular native frames reveal the
animation controls, tall static textures do not, and valid rectangular frames
no longer show a false export error. Updated help describes multiple atlas
strips and the GUI frame-zero boundary. These checks exercise dialog computed
state under the test harness; they do not claim a visual Blockbench UI run.

Coverage matches exactly in every final case: no missing or extra pixels.
Maximum mean RGB difference is **0.333333/255** over covered pixels, from
rounding the CPU reference blend into RGBA8. The raster check permits at most
two pixels of coverage difference and at most 0.5% (minimum four) pixels with
more than two RGB code values of color error.

## Reproduction and evidence

Run from the repository root with the extracted Minecraft 26.3 vanilla assets
and installed PrismLauncher Java/LWJGL dependencies:

```powershell
$vanilla = 'audit/2026-09-28/vanilla'
$output = 'audit/my-texture-check'
node tools/render-tester/texture-animation-fixtures.mjs $output $vanilla
& tools/render-tester/texture-animation-check.ps1 -InputDirectory $output
node tools/render-tester/texture-animation-results.mjs $output
```

Recorded evidence is under `audit/2026-09-29/texture-animation-before-complete`,
`texture-animation-after`, and `texture-animation-final-0.8.4`. Each includes source
images, actual/reference exports, shader sources and hashes, selected render
PNG pairs, `manifest.json`, `results.tsv`, `summary.json`, and `runtime.txt`.
The archived before-plugin source was hash-checked against its original
manifest. The final GPU run was repeated after the last UI/help changes and
version bump, completing at **2026-09-28 22:18:27 UTC** (2026-09-29 locally).
Its source-plugin SHA-256 matches the final working file:
`ce5d406e9860778d275c1721dc01c7687a530353cff5f05ce339a2198bdc1539`.
CPU-suite evidence is `audit/2026-09-29/tests-0.8.4.log`.

Environment: NVIDIA GeForce RTX 4060 Ti, driver 595.71; hidden OpenGL 3.3 context;
128×128 RGBA8 target, nearest filtering, depth test, no blending/MSAA/dithering.
Shaders pass through ShaderC targeting Vulkan 1.2 and Minecraft's SPIRV-Cross
GLSL conversion before actual OpenGL rendering. Fullbright fixtures isolate
texture pixels from world lighting. Humanoid carrier geometry is synthetic.

This verifies rendered texture/frame behavior on this driver. Both sides share
the geometry decoder; it is not a new geometry-calibration test. No Minecraft
client, Computer Use, actual Vulkan draw submission, OIT, Minecraft atlas
stitching, GUI interaction, or gameplay FPS was tested in this run. Blockbench
image loading uses a small Image/canvas adapter; native API checks are separate.
