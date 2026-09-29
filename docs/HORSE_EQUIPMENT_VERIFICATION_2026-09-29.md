# Horse equipment renderer verification — 2026-09-29

**421/421 horse GPU cases passed** for plugin **0.8.5** and the marker-252 horse
renderer: 133 native geometry/animation cases plus 288 combined atlas cases.
These are independent correctness tests in a hidden OpenGL context. Actual
Minecraft OpenGL/Vulkan checks and the separate FPS limitation are recorded
at the end of this report.

## Reference and execution

`HorseNativeFixtures.java` loads the installed Minecraft 26.3 client classes,
bakes the actual horse armor and saddle models, calls their `setupAnim`, and
captures all native polygons through `ModelPart.visit` and `PoseStack`. The nine
states per model are rest, walking, grazing, rearing, feeding, an additional
rotation/translation, uniform scales 0.65 and 1.7, and an X reflection. The baked
1.1 equipment scale and native body pivot are preserved. Every GPU draw receives
the full native equipment mesh, including parts that must be discarded.

The exporter is the real `buildOutput` → `saveSingleOutput` path. Expected
geometry is constructed directly from the original OBJ vertices and the
captured native body matrix. It does **not** reconstruct the shader's carrier
basis or decode positions from the exported texture. Expected pixels use the
original patterned RGBA images, independently selected/blended frames and the
native directional-light formula.

Actual shaders use Minecraft's ShaderC → SPIRV-Cross options, then compile/link
and draw on **NVIDIA GeForce RTX 4060 Ti, driver 595.71**, OpenGL 3.3. The target
is 512×512 RGBA8 with depth testing, nearest filtering, and no blending,
culling, MSAA or dithering. `NO_OVERLAY` and `EMISSIVE` isolate the texture and
directional-light contract from the external overlay/lightmap textures.

## Coverage

| Cases | Check |
| ---: | --- |
| 36 | Both native models × nine poses × six disjoint panels / 12-face, two-layer geometry |
| 2 | One used face and five empty carrier slots |
| 2 | Cycled native polygon corners and vertex arena offset 12 |
| 4 | Lit geometry and alternating emission 0/15 on all six carrier faces |
| 8 | Unsupported version/kind, empty slots and out-of-range face indices: complete cull |
| 2 | Ordinary unmarked equipment: unchanged native geometry and lighting |
| 20 | Manual geometry frames 0/3 while texture time advances and wraps |
| 2 | Manual control beyond the frame count: hold the last frame |
| 48 | Autoplay, easing 0/1/2/3, texture crossfade and geometry/texture wrap |
| 6 | Loop phase offset, play-once interpolation and final-frame hold |
| 3 | Armor and saddle rendered together in rest, rear and rotated poses |

The emission test points both lights away from the panels: ordinary faces have
brightness 0.4 and emissive faces 1.0. Thus it checks visible localization, not
just a header or a scene where every face is already fully lit. The combined
armor/saddle tests use different colors and intentionally separated geometry.

All 133 cases passed. 110 had identical coverage; the largest discrepancy was
two missing pixels or one extra pixel at an edge. 103 had zero mean RGB error;
the maximum mean RGB error was **0.666667/255**, including blend quantization.
At most one shared pixel in a case differed by more than two channel values.
The acceptance bounds are 0.2% coverage disagreement (minimum 12 pixels) and
0.5% RGB disagreement (minimum 30 pixels); the actual observed errors above are
substantially smaller.

Before the shader was added, both six-panel cases failed: 22,156 of 22,326
expected pixels were missing. With the new shader those same cases had zero
coverage or RGB differences. The before snapshot retains its expanded shaders.

## Evidence and reproduction

- Before: `audit/2026-09-29/horse-equipment-red/`.
- Initial exact matches: `audit/2026-09-29/horse-equipment-first-green/`.
- Initial 133-case pass: `audit/2026-09-29/horse-equipment-final-0.8.5/`.
- Final 133-case pass after the UV correction: `audit/2026-09-29/horse-equipment-uv-fixed-0.8.5/`.
- Native poses: `audit/2026-09-29/animal-equipment/native-poses.json`.
- File hashes: `audit/2026-09-29/horse-equipment-evidence.json`.

The final manifest records plugin SHA-256
`c4ef6bd63bcae43e6a4da467f9ce98c9ec5a0316b759cfbd9a9a2ea2550cb677`,
expanded shader hashes, timestamps and every draw. `results.tsv` stores all
pixel metrics; `summary.json` aggregates them. Saved PNG pairs include the
rest, animation and any failed cases. Audit output is local evidence and is
not included in the runtime resource pack.

From the repository root, using the installed PrismLauncher Minecraft 26.3
libraries and extracted vanilla shaders at `audit/2026-09-28/vanilla`:

```powershell
& tools/render-tester/horse-native-fixtures.ps1
node tools/render-tester/horse-equipment-matrix.mjs audit/horse-check
& tools/render-tester/horse-equipment-check.ps1 -InputDirectory audit/horse-check
```

The CPU model loader never starts a world or Minecraft window. The renderer
uses a hidden GLFW context; no Computer Use is involved. The check intentionally
covers rigid body attachments under rotation and uniform scale/reflection.
It does not claim independent head/leg/tail attachment, nonuniform scaling,
other animal models, atlas stitching by Minecraft, OIT/transparency variants,
other GPUs, or gameplay performance. The animation cases here use a single
three-frame strip; the general item/humanoid atlas regression suite is recorded
separately.

Live-scene fixtures can be generated with
`node tools/render-tester/horse-live-fixtures.mjs <output-directory>`. They
contain distinct body/saddle item names, 6/12/60-face models, four-frame geometry
animation plus a three-frame texture strip, readable OBJ sources, give commands
and the `horse_live:body` / `horse_live:saddle` datapack controls. The current
staged visible fixture pack is `audit/2026-09-29/horse-models-visible-0.8.5`; its 60-face model is
for the separate live performance check, not an extra case in the 133 count.

## Horse atlas follow-up: combined geometry and texture animation

An additional **288/288 GPU cases passed** after correcting a reproducible
texture-edge defect in the horse shader. These use actual multi-texture horse
exports and a fully independent reference: each material samples its original
RGBA image outside any atlas, while source OBJ vertices are transformed by the
native body matrix. The 133 cases above were rerun on the corrected shader and
again passed **133/133**. Their original evidence directory was preserved.

The added matrix covers both armor and saddle; two animated strips with 2 and
3 frames; a static neighboring material; Flip UV off/on; crossfade off/on; and
four animated strips with 2/3/4/5 frames plus a static material, spanning two
equipment layers. Every export also has four geometry frames with linear
interpolation. Each runs at eight texture times, including a fractional frame
and complete wrap, with geometry fixed at frame 0, fixed at frame 3, and playing
automatically. This explicitly tests independent geometry and texture clocks.

Before correction, **12/288 cases failed** at geometry time 0.5. Coverage was
identical, but a one-pixel texture edge could contain an adjacent material or
encoded metadata row. UV encoding has 16-bit precision; rounding at a band
boundary and the outward per-corner UV jitter could move the sample outside
that band's edge. The horse shader now moves each UV inward by at most one
encoded UV step toward its opposite-corner midpoint. It reuses that midpoint
for atlas-band selection. This changes only texture coordinates, not geometry,
animation timing, the plugin or the export format.

After correction, all 288 cases have **identical coverage**, no shared pixel
differs by more than two RGB values, and maximum mean RGB error is
**0.222973/255**. The rerun of the original 133 cases retains its previous
maximum of two missing pixels, one extra pixel, and mean RGB error
0.666667/255. Final `objmc_animal.glsl` SHA-256:
`ae31bea6344d5e6599b07711cf8e74d4ed6d017516c606b663ccb928909cd484`.
The plugin hash is unchanged from the 133-case report.

Evidence:

- Before atlas correction: `audit/2026-09-29/horse-atlas-0.8.5/`.
- After correction: `audit/2026-09-29/horse-atlas-fixed-0.8.5/`.
- Rerun of the original cases: `audit/2026-09-29/horse-equipment-uv-fixed-0.8.5/`.
- Hash index: `audit/2026-09-29/horse-atlas-evidence.json`.
- Actual exported pack for a separate live check:
  `audit/2026-09-29/horse-atlas-live-0.8.5/live-pack/`.

```powershell
node tools/render-tester/horse-atlas-fixtures.mjs audit/horse-atlas-check
& tools/render-tester/horse-equipment-check.ps1 -InputDirectory audit/horse-atlas-check
```

The generator also saves the actual exports under `live-pack`. Its optional
`--live-pack-only` argument skips raster-case generation. The two equipment
assets `four_strips_static_flip_fade_horse_body_horse_body` and
`four_strips_static_flip_fade_horse_saddle_horse_saddle` use the same panel
geometry and should be viewed separately in the live scene.

This follow-up is a correctness test, not a timing measurement: other GPU work
was allowed during execution. The item and humanoid decoders still contain
their existing outward UV jitter. The older 736-case regression passed, but
does not prove this exact fractional-geometry boundary safe in those paths;
that remains unverified. They were not changed without a reproduced failure.

## Final regression and actual Minecraft checks

The final shader above passed **83/83 program compile/link combinations**:
166 SPIR-V stages and 166 SPIRV-Cross GLSL 330 translations, with zero failures.
The 89 vanilla shader inputs were verified byte-for-byte against the installed
Minecraft 26.3 client JAR. CPU tests passed **341/341 across 27 files**;
pack validation confirmed 13 shader files, resource format 97.1 and data format
121.0. Evidence: `audit/2026-09-29/horse-matrix-final-0.8.5/summary.json`.

Existing item/humanoid paths were rerun after the UV correction: **1390 color
cases / 5568 assertions** and **736 texture cases / 154 temporal checks** passed.
All 2126 output RGBA hashes are unchanged from the previous run. Full source
snapshots and hashes are in
`audit/2026-09-29/horse-regression-final-0.8.5-uvfix/`.

The same final source was then loaded in actual Minecraft 26.3 on **both OpenGL
and Vulkan**, using separate isolated PrismLauncher profiles. The backend is
confirmed by each client log. Each backend passed **33 positive command/effect
assertions**: all eight exported give commands, both generated summons,
equipment components, manual frame selection, play, stop and play-once's final
frame. A separate native codec probe confirms horse-only eligibility and the
saddle's shearing fields; an actual player's shears interaction was not tested.

Native Minecraft screenshots were saved and inspected for body armor and saddle
together, geometry frames 0/3, autoplay, and four animated atlas strips plus a
static material on each equipment slot separately. The simple models use
different colors and separated geometry. Atlas panels deliberately overlap the
native horse in the center; the outside panels make their changing materials
visible. The independent GPU oracle above checks all panel pixels without that
occlusion. These captures demonstrate successful native draw submission; they
are not a pixel-exact comparison between the two backends or an exhaustive
gameplay test. Runtime checks used client APIs and Minecraft's screenshot API,
without Computer Use or simulated keyboard/mouse input.

Final runtime evidence and SHA-256 index:

- `audit/2026-09-29/horse-live/final-summary.json`.
- OpenGL: `horse-live/opengl-final/visual-final/` under the same audit date.
- Vulkan: `horse-live/vulkan/visual-final/` under the same audit date.

Both final functional sessions were capped at **60 FPS** because the GPU was
also being used by another task. They make **no performance claim**. The two
isolated clients were closed normally afterwards. The user's other client and
profile were not changed. Blockbench's dialog states and export settings were
checked programmatically; the editor UI itself was not visually operated.

## Performance status and comparison with humanoid armor

New FPS measurements were deferred at the user's request while the GPU was
occupied. A busy GPU does not admit a reliable numerical correction factor.
Earlier OpenGL observations are retained in
`audit/2026-09-29/horse-live/preliminary-summary/README.md`; the overlapping
second-client series was excluded. The remaining observations are preliminary,
from a static grid in a mostly empty world, and predate the final UV correction.
They do not establish a causal regression or performance of this final build.

The decoder uses the same general approach as humanoid OBJ armor: reconstruct
vertices from texture data and discard unused carrier faces early. However,
each horse layer submits a larger native mesh. The installed 26.3 models have
72 input vertices per humanoid chest layer, 288 per horse-armor layer, and
408 per saddle layer without a rider (456 with all baked reins parts).
A horse layer holds six OBJ faces. A humanoid chest layer can hold twelve
when spread equally across its three parts, or four if all geometry belongs
to the torso. Thus equal FPS or equal cost per layer is **not confirmed**.
These vertex counts are not an FPS multiplier. The exact native-model probe is
`audit/2026-09-29/horse-live/geometry-layer-cost.json`.
