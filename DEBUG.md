# Shader Debug Mode

Helper for diagnosing per-slot rendering differences without guesswork.

## How it works

Open `objcubed/assets/minecraft/shaders/include/objmc_main.glsl` and find
the `DEBUG MODE` block near the bottom. Uncomment **one** preset (just
the `// OC_DBG_COLOR(...)` line for that preset).

The debug uses `isCustom = 2` as a bypass flag. Entity/item fragment
shaders detect it and emit `overlayColor.rgb` directly — no texture
sampling, no light/shadow mix, no fog. **Pixel RGB == raw debug value**
regardless of model settings or texture. Works with shadows on or off.

Choose **one** preset:

- **A1** — final `Pos` (object space before ModelViewMat). Range ±32 BB units.
- **A2** — `posoffset` alone (encoded vertex from anchor). Range ±16 BB units.
- **A3** — `anchor` alone (`subgroupQuadBroadcast(Pos, 2)`). Range ±32 BB.
- **A4** — slot detection. R=GUI, G=Hand, B=other.

## Workflow

1. Uncomment ONE preset block in the shader.
2. In Blockbench, export a simple test cube (e.g. `[-1, 0, -1] → [1, 2, 1]`).
3. Copy the exported PNG + JSON into the test resource pack.
4. Reload Minecraft pack.
5. Screenshot the model in each slot (first-person hand L/R, third-person
   hand L/R, head, ground, inventory, item frame).
6. Read the RGB of a known vertex from each screenshot (pixel-precision; use
   any image tool that shows hex/RGB on hover).
7. Decode each RGB via:
   `node tools/decode_pixel.js <r> <g> <b> <range>`
   where `range` is 16 for A2, 32 for A1/A3.

The decoded `x, y, z` is the actual shader value for that slot. With A1
on, you see exactly where the vertex ends up in object space per slot —
revealing where the per-slot pipeline differences hide.

## Comparing slots

Run the same test cube model in each slot, decode a corner vertex
(e.g. top-right of front face). Tabulate:

| Slot                    | A1.x | A1.y | A1.z |
|-------------------------|------|------|------|
| first-person right hand | ...  | ...  | ...  |
| third-person right hand | ...  | ...  | ...  |
| head                    | ...  | ...  | ...  |

Differences between rows are exactly the per-slot pipeline drift.

## Per-limb armor calibration (A6 + AOFF table)

**Box-packing (perf):** the carrier mesh MC submits per equipment layer has `nboxes` cube
boxes (chest 3 = body+arms, head/feet 2, legs 3). The encoder packs model faces onto each
box's carrier faces and the shader reads them back per layer, so a chestplate rides
body+r_arm+l_arm on one draw instead of three. Header per layer: `t[8].a` = nboxes; per box
`abody`, model-face indices at NORTH `t[8+abody].r:g` (part in `.b`), SOUTH `t[11+abody]`,
WEST header-texel `14+abody`, EAST `17+abody`, and the 4 faces' EMISSIVE levels in texel
`20+abody` (r=N g=S b=W a=E). West/east/emissive are read directly via `getmeta` — they
overflow the `t[16]` array; needs texture width ≥ 23. index 65535 = that carrier face culled.
The shader derives `amod = nboxes*24` and keeps `f6 ∈ {2,3,4,5}` (W,N,E,S) of each box.
abody→part order per slot: chest [r_arm,l_arm,body], legs [l_leg,r_leg,waist], feet
[l_foot,r_foot], head [head].

Each non-north carrier face needs an orientation matrix `C_F` (so it faces front like north)
and a re-anchor onto the box's NORTH corner-2 so all faces overlay there. Both are **derived
from MC's `ModelPart$Cube` geometry** (jar-decoded: DOWN `[F,E,A,B]`, UP `[C,D,H,G]`, WEST
`[A,E,H,D]`, NORTH `[B,A,D,C]`, EAST `[F,B,C,G]`, SOUTH `[E,F,G,H]`; `mirror` swaps x0↔x1 and
reverses each quad's winding for left limbs) and numerically verified to overlay north to
~1e-15 for every part, both handedness, inflation grow 0/0.5/1. Anchors (n = cross(e1,e2)):
north `a2`; west `a2+(a0-a1)`; south `a2+(a0-a1) - depthₛ·n`; east `a2 - widthₑ·n`. The perp
dims (depthₛ, widthₑ) are inflation/scale-robust linear combos `a·|a0-a1| + b·|a0-a3|`:
depthₛ body (2,-1) else (1,0); widthₑ body (0.5,0.5) else (1,0). `C_F` (columns): SOUTH
diag(-1,1,-1), WEST [(0,0,-1),(0,1,0),(1,0,0)], EAST [(0,0,1),(0,1,0),(-1,0,0)].

- **Stage 1 (v0.5.32):** north-only, 1 face/box/layer. 168→84 layers/chestplate, 45→120 FPS.
- **Stage 2a (v0.5.36):** + south, 2/box → 84→42 (~4× vs original).
- **Stage 2b (v0.5.37):** + west + east, 4/box → 42→21 (~8× vs original). UP and DOWN are NOT
  packed: their anchors depend on handedness (X-mirror flips the Y-faces, unlike the Z/X
  faces N/S/W/E whose coeffs are handedness-uniform), and DOWN is geometrically unrecoverable
  on a square limb cap (4×4 face can't reveal the 12-long limb). Adding UP (body/head only)
  would need handedness branches for marginal gain.

**Per-face emissive (v0.5.38).** The vanilla `light_emission` model property only affects
item/block models, never equipment layers, so armor emissive is handled in-shader: the encoder
bakes each packed face's emissive level (0..15) into texel `20+abody` (r=N g=S b=W a=E), and
the armor block reads `aemis` for the current face and sets `noshadow = 1` when `aemis > 0`,
so `objmc_light.glsl` skips all shading/lightmap for that face → fullbright. `noshadow` is
`flat` and per-face (all 4 corners agree). Whole-piece "No Shadow" still works (global). Mark
faces in BB via right-click → emissive, then re-export. Currently boolean (any level → full);
the level byte is stored for a future graded-emission option.

- `AOFF[8]` — per-part anchor offset (all calibrated; see the table below).

**Orientation** is reconstructed as a full 3D basis from the carrier-quad corners
(Gram-Schmidt, the Der Discohund method — same as the world path), NOT from the
face normal. This tracks animated limbs **including twist**, and was the fix for
arms/legs: the old 2-DOF normal method (ay/ap) lost the twist axis and inverted
the swing. Facing is handled by the basis (`mat3(-e1, e2, -cross(e1,e2))` =
upright + 180° about up); no per-axis `atan` juggling.

**Left limbs are mirrored.** MC builds left_arm/left_leg/left_foot (parts 3/5/7)
with `CubeListBuilder.mirror()` — a pure X reflection. The shader un-mirrors them by
negating `posoffset.x` about the centred geometry (before AOFF), and uses basis
`mat3(-e1, -e2, -cross(e1,e2))` (up axis e2 negated) while right/head/chest keep
`mat3(-e1, e2, -cross(e1,e2))`. The e2 flip is also why left AOFF.y differs from the
right (see table).

**Placement reference:** each armor part's geometry is encoded RELATIVE TO its tagged
group's PIVOT (origin) — the artist sets the pivot at the vanilla MC bone position, so
the part anchors as drawn on any model (falls back to bbox-CENTER X/Z + bbox-MIN Y if
the pivot is unset). Faces are routed to parts by a temporary part-encoding name token
(order/collision-proof). AOFF is the per-part fine-tune against the corner anchor.

**Calibrated offsets** (left limbs need their own Y — the −e2 basis maps height
differently from the right):

| Part        | AOFF.x | AOFF.y  | AOFF.z  |
|-------------|--------|---------|---------|
| chest (0)   | 0.2925 | -0.785  | -0.175  |
| head (1)    | 0.2925 | -0.045  | -0.2925 |
| r_arm (2)   | 0.2375 | -0.66   | -0.175  |
| l_arm (3)   | 0.2375 | 0.16    | -0.175  |
| r_leg (4)   | 0.14   | -0.765  | -0.14   |
| l_leg (5)   | 0.14   | -0.015  | -0.14   |
| r_foot (6)  | 0.17   | -0.804  | -0.17   |
| l_foot (7)  | 0.17   | 0.004   | -0.17   |

**Re-calibrating a part:** set its `AOFF` to `vec3(0)`, equip the test cube in
that slot, nudge XYZ until it seats, record the vec3. The **A6 gate probe**
(uncomment `OC_DBG_COLOR(vec4(float(abody)/3.0, float(aface%6)/5.0, 0.0, 1.0));`
in the armor block and comment the `Pos = vec3(9999.0);` cull) colours
`abody`/face if you ever need to re-confirm the gate tables (`ABOX`/`AMOD`).

## Returning to normal

Comment all A* blocks back out and reload.
