# objcubed: modeling and export guide

[Project overview](../README.md) · [Русское руководство](README_RU.md)

## Set up a model resource pack

Install the plugin and shader pack from the [project page](../README.md#start).

1. Create a folder for your models inside Minecraft's `resourcepacks/` directory.
2. Copy `pack.mcmeta` from `objcubed.zip` into that folder.
3. Select this folder when exporting from Blockbench. The plugin writes the model
   assets, but does not create `pack.mcmeta`.
4. Enable both the model pack and `objcubed.zip`. Keep the shader pack above other
   packs that replace the same core shaders, then reload with **F3+T**.
5. Use the command in the exported `_give.txt` file to obtain your item.

For animal equipment and elytra, start with an
[assembled template](../templates/animal-equipment/README-RU.md).
The [equipment guide](ANIMAL_EQUIPMENT_RU.md) lists available bindings and their
limits for each target. Both guides are in Russian.

## Modeling conventions

- **Build on the grid floor.** The BlockBench grid floor (y=0) is the block bottom
  in game: a model standing on the grid stands on the block, exactly like a
  vanilla JSON model built from 0..16. A model floating above (or straddling)
  the grid will float the same way in game — in every display slot at once.
- **Horizontal origin = block centre.** Centre the model on the origin in X/Z.
- Export from the **Edit** tab (the plugin guards against the Display and
  Animate tabs baking their pose into a static export, but Edit is the
  canonical state).

## Usage

1. Open or create a model in BlockBench (Generic Model or any format with mesh/cube elements)
2. File > Export > **Export as obj^3...**
3. Configure settings in the export dialog:
   - **Texture** — select texture or enable atlas for multiple textures; a frame-strip texture reveals the animated-texture controls
   - **Transform** — scale and offset the model
   - **Animation** — select animation, set FPS and time range
   - **Display** — rotation/translation/scale per display slot, one tab each (left and right hands have independent settings)
   - **Advanced** — easing, interpolation, color behavior, autorotate
4. Click **Export** — saves a PNG (encoded model) and JSON (Minecraft model) to your chosen location

### Datapack generation

When animation is enabled, you can generate a datapack for controlling animation via commands:

- **play** — start autoplay loop synced to GameTime
- **stop** — freeze at current frame
- **set** — freeze at a specific frame (set score before calling)
- **play_from** — autoplay starting from frame N
- **play_once** — play one cycle then freeze at last frame

Target types: equipment entity, item_display, or player (via temporary armor stand).

Example:
```mcfunction
execute as @e[type=armor_stand] run function mypack:walk/play
```

## Armor / equipment export

Instead of a held item, a model can be rendered as **worn armor** via the entity
equipment layer. A single armor piece can span several body parts — a chestplate
covers the torso **and both arms** — and each part follows its own bone, so the
sleeves swing with the player's arms.

**Body parts:** `0` body, `1` head, `2`/`3` right/left arm, `4`/`5` right/left leg,
`6`/`7` right/left foot. Left limbs are automatically un-mirrored to match the way
Minecraft mirrors the left arm/leg.

**Workflow:**

1. **Group by body part.** Put each part's geometry in its own group (a `body`
   group, a `right_arm` group, etc.). Model the set anatomically — body in the
   torso, arms out to the sides.
2. **Tag each group** — right-click the group → **obj³: Body part** → pick the part.
   Tags are saved into the `.bbmodel` (so they survive save/reload).
3. **Set each group's pivot** (the orange origin point) at the point where the part
   attaches to the body — i.e. the vanilla bone position (shoulder, hip, …). The
   geometry is anchored relative to this pivot, so the part lands where you placed
   the pivot regardless of the model's size or layout.
4. In the export dialog enable **Export as Equipment (armor)** and tick the
   **Armor pieces** to export. Each writes its own equipment asset spanning its parts:

   | Piece | Body parts | Equipment layer |
   |-------|------------|-----------------|
   | Helmet | head | `humanoid` |
   | Chestplate | body + both arms | `humanoid` |
   | Leggings | both legs | `humanoid_leggings` |
   | Boots | both feet | `humanoid` |

5. **Export.** obj³ writes, per checked piece, an equipment definition
   (`assets/minecraft/equipment/<name>_<piece>.json`), one layer texture per model
   face, and a `<name>_<piece>_give.txt` containing the command to equip it, e.g.:

   ```mcfunction
   give @s minecraft:leather_chestplate[minecraft:equippable={slot:"chest",asset_id:"minecraft:<name>_chestplate"}]
   ```

   (`<name>` is the **Custom model data name** field from the export dialog — it names
   all output assets, so several models coexist without overwriting each other.)

Faces that belong to no tagged part are skipped, so untagged geometry will not
appear. (The old single-slot export — the whole model anchored to one body
part — still runs when no pieces are checked, for old projects; its UI is
retired in favour of the piece checkboxes.)

## Right-click tools

obj³ adds two entries to the Outliner right-click menu:

- **obj³: Body part** (on a group) — assign the group to a body part for armor
  export (see above). Saved in the project.
- **Emissive toggle** (on a cube/mesh) — mark faces as fullbright so they ignore
  world lighting (glowing trims, eyes, runes). Saved in the project.

## Resource pack structure

Export is one-shot: pick the resource pack root once and the plugin writes
everything below it with no further dialogs. Re-exporting overwrites cleanly;
a second model on the same base item coexists via custom_model_data.

```
<resource pack root>/
  pack.mcmeta
  assets/objcubed/
    textures/item/<name>.png         — your exported PNG texture
    models/item/<name>_<slot>.json   — per-slot JSON models (ref objcubed:item/<name>)
  assets/minecraft/
    items/<baseItem>.json            — item override (custom_model_data select)
    items/<baseItem>_give.txt         — give commands, preserving existing entries
    equipment/<name>_<piece>.json            — armor definitions (equipment export only)
    textures/entity/equipment/<layer>/...    — per-face armor layer textures
    shaders/
      core/
        terrain.vsh / terrain.fsh    — placed blocks
        block.vsh / block.fsh        — falling blocks, pistons
        entity.vsh / entity.fsh      — entities, armor
        item.vsh / item.fsh          — items in hand + GUI
      include/
        objmc_main.glsl              — core model decoding
        objmc_tools.glsl             — vertex math utilities
        objmc_light.glsl             — lightmap sampling
```

## Shader pipelines

| Pipeline | Shader | Use case |
|----------|--------|----------|
| Terrain | `core/terrain` | Chunk blocks (placed in world) |
| Block | `core/block` | Falling blocks, pistons |
| Entity | `core/entity` | Entities, armor stands, armor |
| Item | `core/item` | Items in hand and GUI |

## Performance

Cost depends on face count, animation frames, the number of visible models and
their screen coverage. Equipment also uses multiple rendering layers. There is
no fixed FPS guarantee; see the dated [verification reports](RELEASE_26.3.md)
for measured results and the limits of those checks.

## Controlling models via color

Items with overlay color (for example, potions) can pass data to the shader through RGB bytes. Worn equipment uses its dye color for animation control; the item tint and hue modes do not apply to it. The `colorbehavior` setting defines what each byte controls:

- `direct` — passes the channel value directly as model color (tint). With all three channels set to direct, `custom_color` is used as an RGB tint multiplied with the texture. White (`0xFFFFFF`) preserves the original texture; other values tint it.
- `time` — animation time offset
- `scale` — model scale
- `overlay` — overlay color hue (converts value to HSV palette color)
- `hurt` — hurt flash (red tint)

Default is `direct/direct/direct`.

Example — tint a model red:
```mcfunction
give @s minecraft:potion[potion_contents={custom_color:16711680}]
```

When `colorbehavior = time/time/time` (set automatically when generating a datapack), the shader uses `potion_contents.custom_color` as a 24-bit animation control value. Values below 8388608 are autoplay offsets; values above are manual frame indices.

## Limitations (by design or not yet supported)

- **Up to four animated strips per atlas**: available header space can reduce
  this to three at 16px width with 7–8 dynamic display contexts. Extra strips
  remain on frame zero with an export warning. All strips share the frame
  duration and fade setting; each wraps at its own frame count (at most 255).
- **Ground / shelf Y translation** is clamped by Minecraft itself; obj³
  compensates the base height internally, but a custom Y translation on these
  slots will not move the model.
- **GUI icons don't animate** — Minecraft bakes inventory icons once per
  resource reload; obj³ pins them to frame 0 instead of a random frame.
- **Legacy armor PNGs (marker 254, pre-v0.5.31)** are no longer decoded —
  re-export old armor with the current plugin.
- **UV tiling** (coordinates outside 0..1) is clamped — keep the model UV-mapped
  inside the texture frame. In atlas mode this clamp is per-texture.

## Notes

- **Flipped UV** — BlockBench OBJ export sometimes flips UVs. Use the Flip UV option if the model looks wrong.
- **Alpha preservation** — The plugin uses a custom PNG encoder (Node.js zlib) instead of canvas to avoid alpha premultiplication corrupting RGB data.
- **Texture size** — Minimum 8px wide; seven dynamic display contexts need 9px and eight need 10px. Use 16px+ for the GUI transform header. The exporter rejects textures too narrow for the display table. Wider textures are recommended for high vertex counts or animations.
- **Frame count** — More FPS and longer animations = larger texture. The shader interpolates between frames, so fewer keyframes are often sufficient.

## How it works

Model geometry (vertex positions, UVs, face indices) is encoded into a specially formatted PNG texture. A set of core shaders included in the resource pack reads this texture at render time, reconstructing the 3D mesh from the pixel data. The vanilla Minecraft renderer displays the result — no mods required.

## Credits

**[Godlander](https://github.com/Godlander)** — original objmc concept, Python tool, and core shaders

**[JagerMeistars](https://github.com/JagerMeistars)** — objcubed Blockbench plugin

### Original contributors

- **vilder50** — original concept of mesh models
- **Onnowhere** — formatting and testing
- **DartCat25** — early development help
- **The Der Discohund** — matrix operations
- **Suso** — controlled interpolated animation concept
- **Dominexis** — spline math
- **Barf Creations** — Minecraft Pose rotation matrix replication
- **kumitatepazuru** — CLI arguments for original script
- **Daminator** — tkinter GUI
- **thebbq** — edge case debugging and stability
- **midorikuma** — concept of using player heads to encode arbitrary models

## License

MIT License (c) 2022 Godlander. See [LICENSE](../LICENSE).

## Export only the files you need

Choose **Export to → Model and texture** to save the PNG and model JSON directly into a folder, without an `assets` tree, item definition or give command. Set **Texture resource ID** if you use your own namespace/path; place the PNG at that resource location yourself. Equipment and datapacks use **Resource pack** mode.

Under **Display contexts → Choose contexts**, keep only the variants you need. **Default only** exports `<model>_default.json` and the PNG. Unselected contexts fall back to default rather than hiding the model. Keep the hand, ground and shelf variants when you need their positioning. Previously exported files are not deleted.
