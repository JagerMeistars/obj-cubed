# Shader Debug Mode

Helper for diagnosing per-slot rendering differences without guesswork.

## How it works

Open `objcubed/assets/minecraft/shaders/include/objmc_main.glsl` and find
the `DEBUG MODE` block near the bottom. Each preset has **3 lines** to
uncomment:
1. The `vertexColor = vec4(...)` block (writes debug RGB)
2. `lightColor = vec4(1.0);` (full bright — kills shadow modulation)
3. `overlayColor = vec4(0.0);` (clears damage tint)

For most reliable RGB readout, the model's texture should be uniformly
**white**. With a coloured texture the debug RGB will be tinted by it
(final pixel ≈ texture × debug).

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

## Returning to normal

Comment all A* blocks back out and reload.
