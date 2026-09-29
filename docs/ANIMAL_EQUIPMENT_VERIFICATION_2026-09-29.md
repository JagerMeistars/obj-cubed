# Animal equipment 0.9.0 verification — Minecraft 26.3

The final v2 equipment exporter and shader passed **1564/1564 independent GPU
raster cases**: 200 native-pose cases and 1364 animation, atlas, pivot, emission
and invalid-data cases. These are hidden OpenGL correctness checks; they do
not measure Minecraft FPS. Actual Minecraft checks are recorded separately.

## Final sources and evidence

- `objcubed.js` SHA-256:
  `67ecd81279bad9b94b7fb1d862660f495bfce8c3d1a8a21be398ad502f0eb70a`.
- `objmc_animal_v2.glsl` SHA-256:
  `07cc12939420a47c302f087316d61e904641f53757bb777874a17213309665e7`.
- `tools/equipment-carriers.json` SHA-256:
  `fddc5c9edecdd67827e98b7969536a1ac6356ca9bf26b6fa0b0f3eb27c13e6a7`.
- Native-pose results:
  `audit/2026-09-29/equipment-expansion/v2-native-final-0.9.0/`.
- Animation/guard results and `combined-summary.json`:
  `audit/2026-09-29/equipment-expansion/v2-animation-final-0.9.0/`.

Both final suites were regenerated from the same frozen plugin and shader.
Each retains real exported PNG/RGBA layers, input and expected geometry,
expanded shader sources, case manifests, per-case measurements, selected PNG
pairs, source hashes and UTC execution timestamps. The report aggregator
checks completeness and that the recorded plugin/catalog match current source.
Earlier runs remain preserved rather than overwritten.

## Independent reference and native model capture

The native probe reads the installed Minecraft 26.3 client JAR through
`LayerDefinitions.createRoots()`. It instantiates the actual equipment models,
calls `setupAnim`, and captures every part's local/model matrix, visible cube,
native UV rectangle, polygon vertices and normals. The catalog contains
**16 targets, 44 bindings and 264 nondegenerate carrier quads**. Its construction
checks rectangular closure, UV area and a nonsingular local basis.

Fixtures call the real plugin's `buildOutput` and `saveSingleOutput`, including
the appended v2 descriptor. The shader receives each complete native posed
mesh. Reference vertices instead come from the original OBJ, the artist pivot,
and the captured native `ModelPart` matrix. Repeated or mirrored bindings use
an independently fitted correspondence across all **24 vertices of the bind
cube**. The reference does not reconstruct a pose from a single carrier quad
and does not read the encoded geometry or appended descriptor back.

The 200 cases cover all 44 bindings in four poses, plus undead horse armor,
baby happy-ghast harness and baby elytra variants. Poses include movement,
head rotation, horse eating/rearing, wolf sitting/shaking, harness-goggle state
and crouching/fall-flying elytra state where the native model consumes those
fields. Camel/nautilus captures do not imply exhaustive playback of their
native keyframe animation trajectories. The original baby harness view covered
only 32 pixels, although actual/reference pixels matched; its camera was
reframed before final verification. No production fix was needed for that.

## Animation, textures, pivot and rejection checks

The extended suite tests every target's default binding plus horse head,
horse/wolf/llama/pig shared legs and happy-ghast goggles: **22 bindings**.

| Cases | Coverage |
| --- | --- |
| 1056 | Two- and four-frame geometry; linear and existing cubic interpolation; single three-frame strip; two animated strips plus static material; four strips of 2/3/4/5 frames plus static material; two equipment layers; Flip UV; crossfade; independent geometry/texture clocks; manual first/last frame, overflow clamp and autoplay; time/wrap samples; nonzero artist pivot on all cases |
| 22 | Alternating emission 0/15 on six faces with model `noshadow` disabled; mathematical native directional-light reference verifies lit and fullbright faces independently |
| 286 | Thirteen invalid/empty-data cases on each binding: invalid kind/signature/slot count/reserved byte, descriptor row outside texture or overlapping payload, insufficient remaining scalar capacity, empty/out-of-range face indices, NaN pivot/UV/normal, and zero-length local basis |

Expected texture pixels are sampled directly from the original patterned RGBA
strips using time and frame duration. Crossfades blend the original source
frames, independently of the exported atlas layout. Expected geometry follows
the original OBJ frames with an artist pivot of `[0.17, -0.23, 0.11]` blocks;
the test includes depth offsets and slanted panels. Invalid/empty cases require
exactly zero rendered pixels.

## Measured raster error

The runner uses ShaderC to compile to SPIR-V, Minecraft's SPIRV-Cross settings
to translate to GLSL 330, and a hidden **OpenGL 3.3** context on an **NVIDIA
GeForce RTX 4060 Ti, driver 595.71**. The target is 512×512 RGBA8, with nearest
texture sampling and no MSAA. `NO_OVERLAY` and `EMISSIVE` isolate equipment
decoding from external overlays/lightmap; the per-face test separately exercises
the PNG fullbright/emission flags and native directional shading.

| Suite | Passed | Maximum missing pixels | Maximum extra pixels | Maximum pixels with RGB channel error >2 | Maximum mean RGB error, 0–255 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native poses | 200/200 | 1 | 3 | 40 | 0.014729 |
| Animation/pivot/emission/guards | 1364/1364 | 7 | 7 | 9 | 0.237378 |

Nonempty reference coverage is at least 3858 and 12236 pixels respectively.
140/200 native-pose cases have exact coverage; 128 are entirely exact.
609/1364 extended cases have exact coverage; 492 are entirely exact, including
the 286 deliberately empty cases. Small edge/texture-boundary differences are
consistent with the exporter's quantized positions and UVs. These results are
not presented as pixel-exact equality for every case.

The fixed pass threshold requires more than 50 reference pixels, at most
`max(12, 0.2% of reference area)` missing-plus-extra pixels, and at most
`max(30, 0.5% of reference area)` pixels whose largest RGB channel error exceeds
two. The table reports observed errors, not just PASS flags.

## Existing renderer regression

The same final v2 shader passed **83/83 program combinations**: 166 ShaderC
stages, 166 SPIRV-Cross translations and 83 OpenGL links. The separate legacy
horse-v1 suite passed **133/133** against its independent reference. All 133
measurement rows match the preceding v1 baseline, and all 25 saved actual PNGs
have identical decoded RGBA data. Only those 25 cases save PNGs, so exact-RGBA
equality is not claimed for the other 108 cases.

Evidence: `audit/2026-09-29/equipment-expansion/regressions-v2-final/summary.json`.
That regression suite recorded an earlier plugin hash; it exercises preserved
v1 behavior. The 1564 new v2 checks above use the final plugin hash explicitly.

## Reproduction and limits

Run from the repository root after preparing the vanilla shader includes and
native model JSON. Native probe/catalog generation is documented in
`tools/render-tester/README.md`.

```powershell
node tools/render-tester/equipment-v2-fixtures.mjs audit/v2-native audit/native-equipment/native-models.json audit/vanilla
& tools/render-tester/horse-equipment-check.ps1 -InputDirectory audit/v2-native
node tools/render-tester/equipment-v2-animation-fixtures.mjs audit/v2-animation audit/v2-native
& tools/render-tester/horse-equipment-check.ps1 -InputDirectory audit/v2-animation
node tools/render-tester/equipment-v2-results.mjs audit/v2-native audit/v2-animation
```

Shared legs repeat one carrier-relative attachment, rather than offering four
independent pivots. Native horse hind-leg cubes are offset by about 0.9 native
pixels in local Z from the canonical front-leg cube; wolf left-leg reflection
is around local X=1 pixel. These native carrier offsets are preserved by the
oracle. Shared wings mirror the canonical left-wing attachment. Tests do not
turn those ambiguous UV layouts into independent left/right or front/rear
controls.

Nautilus supports the rigid shell only: body/mouth nonuniform scale cannot be
fully recovered from one quad. The shader/catalog do not promise arbitrary
nonuniform part scaling. Wolf armor and custom llama carpets are adult paths;
baby model presence alone does not establish native equipment rendering.
Native wolf crack-overlay textures are outside this custom-model decoder.

These synthetic checks establish the listed geometry/texture contracts on this
driver. They do not establish cross-vendor behavior, actual game batching,
player elytra flight, gameplay collision, pack-order compatibility or FPS.
No Computer Use or simulated keyboard/mouse input was used. Runtime screenshots
and commands have a separate scope from these independent pixel comparisons.


## Actual Minecraft OpenGL and Vulkan checks

The final resource-pack shader bytes were installed and checked against source
in the two isolated audit profiles, then rendered by Minecraft 26.3 itself.
The native logs confirm OpenGL and Vulkan respectively. Both runs used a 60 FPS
cap while the GPU was shared; they are functional checks, not benchmarks.

| Per backend | Confirmed |
| --- | ---: |
| Equipment targets shown | 16 |
| Successful native summons, including horse armor + saddle together | 17 |
| Native screenshots | 38 |
| Generated animation `set` followed by actual `dyed_color` readback of 8388609 | 15 |

The 76 screenshots include separate body/head equipment, all four repeated legs,
wolf sitting and head pitch, both sides of elytra on an armor stand, and horse
armor/saddle worn together. Patterned texture strips animate during the run.
Screenshots were inspected; these are visible functional observations, not a
pixel-by-pixel comparison between backends. Camera framing and audit worlds
also differ, so they must not be treated as an FPS A/B test. The procedural
colored shells are test fixtures, not finished art models.

Player elytra flight was not exercised in these live sessions. The independent
native-pose suite covers the model's fall-flying/crouching rotations, and the
real native ItemParser/ItemStack codecs confirm that the exported elytra retains
the GLIDER component. No claim is made that every gameplay interaction, shearing
operation or damage overlay was tried interactively.

The native component probe passed 16/16 real export commands and 15 generated
summon item-stack payloads; elytra uses the player path and has no summon command.
All component fields retain the intended native defaults or the documented
species restriction. The complete unit suite passed 412/412 in 29 files;
resource-pack validation passed for 14 shader files and format 97.1.

Evidence:

- `audit/2026-09-29/equipment-expansion/live-final-summary.json` indexes the
  actual backend log lines, final source hashes, successful commands and all
  76 screenshot hashes.
- `audit/2026-09-29/horse-live/animal-opengl-0.9.0/animal-visual-final/`
- `audit/2026-09-29/horse-live/animal-vulkan-0.9.0/animal-visual-final/`
- `audit/2026-09-29/animal-equipment/expanded-component-probe.json`
- `audit/2026-09-29/equipment-expansion/unit-final.log`

Both audit clients exited normally after capture; other running profiles were
not stopped. Automation used native Java APIs, commands and Screenshot.grab,
without Computer Use, simulated keyboard input or mouse input. No numerical
correction for a busy GPU was applied, and no new FPS result is claimed.
