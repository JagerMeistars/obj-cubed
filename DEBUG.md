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

Per-limb armor anchors the model to a body part via three lookup tables in the
armor block of `objmc_main.glsl` (indexed by the header byte `t[8].b`, set by the
exporter from the chosen slot):

- `AMOD[8]` — vertex modulus (parts×6×4). 72 for chest/arms/legs, 48 for head/feet.
- `ABOX[8]` — which `abody` is the carrier (0 chest=body=2, arms 0/1, legs 0/1, feet 0/1).
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
