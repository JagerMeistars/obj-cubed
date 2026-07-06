# obj^3 (objcubed)

A [BlockBench](https://www.blockbench.net/) plugin for exporting arbitrary 3D models into Minecraft resource packs using custom core shaders.

Forked from [Godlander's objmc](https://github.com/Godlander/objmc) — the original Python-based tool that pioneered the technique of encoding OBJ mesh data into textures and decoding it in vanilla Minecraft shaders.

**obj^3** replaces the Python script + CLI workflow with a single BlockBench plugin.

## How it works

Model geometry (vertex positions, UVs, face indices) is encoded into a specially formatted PNG texture. A set of core shaders included in the resource pack reads this texture at render time, reconstructing the 3D mesh from the pixel data. The vanilla Minecraft renderer displays the result — no mods required.

## Features

- **Direct BlockBench export** — File > Export as obj^3
- **Armor / equipment export** — render a model as worn armor; one piece can span several body parts (a chestplate = torso + both arms), each following its own bone on the player/armor stand
- **Body-part tagging** — right-click a group to assign it a body part; tags persist in the `.bbmodel`
- **Emissive faces** — right-click a cube/mesh to make it fullbright
- **Keyframe animation baking** — BB animations are baked frame-by-frame into the encoded texture
- **Animated textures** — a frame-strip texture plays in game (hand, GUI, world, armor), with per-frame tick rate and optional cross-fade; works standalone or inside an atlas
- **Armature & bone skinning** — weighted vertex skinning from BB Generic Model rigs
- **Multi-texture atlas** — combine multiple textures into one atlas automatically (one animated strip per atlas keeps animating)
- **Datapack generation** — animation control functions (play, stop, play_once, etc.) with GameTime sync
- **Vanilla-exact display** — every display slot (right/left hand in first and third person, head, GUI, ground, item frame, shelf) has its own tab with rotation/translation/scale, and a model lands exactly where the same vanilla model would — rotations included
- **Presets** — multiple named export configurations saved per project
- **Localized UI** — English and Russian, with an in-dialog guided tour of every control
- **Custom PNG encoder** — bypasses browser alpha premultiplication to preserve exact RGB values

## Requirements

- BlockBench 4.8.0+ (desktop variant — the custom PNG encoder needs Node.js)
- Minecraft 26.1.2 — the bundled core shaders target this core-shader version
- Armor export additionally needs the entity equipment pipeline (included in the pack)

Core shaders are a vanilla resource-pack feature, but they are version-sensitive: the
shaders are tuned for 26.1.2 and may need updating for other versions. Modded
compatibility is not guaranteed.

## Installation

1. Download `objcubed.js`
2. In BlockBench: File > Plugins > Load Plugin from File > select `objcubed.js`
3. Copy the `objcubed/` resource pack folder to your Minecraft `resourcepacks/` directory

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
   - **Display** — rotation/translation/scale per display slot, one tab each (the third-person left hand mirrors the right until unticked)
   - **Advanced** — easing, interpolation, color behavior, autorotate
4. Click **Export** — saves a PNG (encoded model) and JSON (Minecraft model) to your chosen location

### Export settings

| Setting | Description |
|---------|-------------|
| **Scale** | Multiplies vertex positions before encoding |
| **Offset** | Adds to vertex positions (X, Y, Z) |
| **FPS** | Frames per second for animation baking |
| **Autoplay** | Animation loops automatically using GameTime |
| **Easing** | Interpolation between vertex frames: none, linear, cubic ease-in-out, bezier |
| **Fade** (animated texture) | Cross-fade between texture frames, like `interpolate` in a vanilla `.mcmeta` |
| **Color behavior** | What each RGB byte of overlay color controls (direct/time/scale/overlay/hurt) |
| **Auto Rotate** | Shader estimates rotation from normals (yaw, pitch, or both) |
| **No Shadow** | Disable face-normal shading |
| **Flip UV** | Flip texture UVs vertically (try if model looks wrong) |
| **No PoT** | Don't round texture height to power of two |
| **Filter Armature** | Exclude bone shapes from export (enable for armature rigs) |

### Animated textures

A texture that is a **stack of frames** can play in game independently of the
geometry animation (its clock is separate — both can run at once):

- **Best path:** mark the texture animated **in Blockbench** (texture
  properties). BB then shows a one-frame UV grid — just UV-map your model as
  usual, no special rules.
- **Plain strip:** a texture whose height is a whole multiple of its width is
  treated as vertical square frames; UV-map onto the **top** frame.
- Set **ticks per frame** and optional **cross-fade** (like `interpolate` in a
  vanilla `.mcmeta`).
- Works in hand, GUI, world and **on armor**. Inside an **atlas**, one animated
  strip is supported per atlas — it animates, the other textures stay static.
- The GUI icon is pinned to frame 0 of both the geometry and the texture (MC
  bakes inventory icons once, so a live clock would freeze a random frame).

### Datapack generation

When animation is enabled, you can generate a datapack for controlling animation via commands:

- **play** — start autoplay loop synced to GameTime
- **stop** — freeze at current frame
- **set** — freeze at a specific frame (set score before calling)
- **play_from** — autoplay starting from frame N
- **play_once** — play one cycle then freeze at last frame (shader-driven, no tick function needed)

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
  assets/objc_cubed/
    textures/item/<name>.png         — your exported PNG texture
    models/item/<name>_<slot>.json   — per-slot JSON models (ref objc_cubed:item/<name>)
  assets/minecraft/
    items/<baseItem>.json            — item override (custom_model_data select)
    atlases/blocks.json              — stitches objc_cubed item textures into the atlas
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

objmc models add minimal overhead — mostly extra texture fetches. Performance scales linearly with face count. A 20K-face block model performs similarly to rendering ~3300 regular blocks without culling. Block models are significantly more performant than entity models.

High face counts (50K+) in a single chunk section can hit the UberGpuBuffer 2MB limit and crash the game. Use blockstate overrides to redirect high-poly block models if needed.

## Controlling models via color

Items with overlay color (potions, dyed leather armor) can pass data to the shader through RGB bytes. The `colorbehavior` setting defines what each byte controls:

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

- **One animated strip per atlas.** Several animated textures in one atlas are
  not supported — the first strip animates, the rest are exported static (with
  a warning).
- **Per-axis depth (Z) display scale** cannot be reproduced in hand/world slots:
  the shader reconstructs scale from the flat carrier quad, which only exposes
  X/Y. Uniform and X-/Y-only scales are exact; a distinct Z scale falls back to
  `min(Sx, Sy)`. The GUI slot is exact (its scale rides the header).
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
- **Texture size** — Minimum 8px wide (16px+ if you use the GUI slot — the icon transform header needs the width). Wider textures are recommended for high vertex counts or animations.
- **Frame count** — More FPS and longer animations = larger texture. The shader interpolates between frames, so fewer keyframes are often sufficient.

## Credits

**[Godlander](https://github.com/Godlander)** — original objmc concept, Python tool, and core shaders

**JagerMeistars** — obj^3 BlockBench plugin (this fork)

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

MIT License (c) 2022 Godlander. See [LICENSE](LICENSE).
