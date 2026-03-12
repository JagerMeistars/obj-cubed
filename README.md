# obj^3 (objcubed)

A [BlockBench](https://www.blockbench.net/) plugin for exporting arbitrary 3D models into Minecraft resource packs using custom core shaders.

Forked from [Godlander's objmc](https://github.com/Godlander/objmc) — the original Python-based tool that pioneered the technique of encoding OBJ mesh data into textures and decoding it in vanilla Minecraft shaders.

**obj^3** replaces the Python script + CLI workflow with a single BlockBench plugin: model, rig, animate, and export — all inside BlockBench.

## How it works

Model geometry (vertex positions, UVs, face indices) is encoded into a specially formatted PNG texture. A set of core shaders included in the resource pack reads this texture at render time, reconstructing the 3D mesh from the pixel data. The vanilla Minecraft renderer displays the result — no mods required.

## Features

- **Direct BlockBench export** — File > Export as obj^3
- **Keyframe animation baking** — BB animations are baked frame-by-frame into the encoded texture
- **Armature & bone skinning** — weighted vertex skinning from BB Generic Model rigs
- **Multi-texture atlas** — combine multiple textures into one atlas automatically
- **Datapack generation** — animation control functions (play, stop, play_once, etc.) with GameTime sync
- **Display transforms** — per-slot rotation/translation (thirdperson, head, ground, fixed)
- **Custom PNG encoder** — bypasses browser alpha premultiplication to preserve exact RGB values

## Requirements

- BlockBench 4.8.0+ (desktop variant)
- Minecraft 1.21+ (core shaders)
- Compatible with 26.1-snapshot-9 and later

Modded compatibility is not guaranteed. Core shaders are a vanilla resource pack feature.

## Installation

1. Download `objcubed.js`
2. In BlockBench: File > Plugins > Load Plugin from File > select `objcubed.js`
3. Copy the `objcubed/` resource pack folder to your Minecraft `resourcepacks/` directory

## Usage

1. Open or create a model in BlockBench (Generic Model or any format with mesh/cube elements)
2. File > Export > **Export as obj^3...**
3. Configure settings in the export dialog:
   - **Texture** — select texture or enable atlas for multiple textures
   - **Transform** — scale and offset the model
   - **Animation** — select animation, set FPS and time range
   - **Display** — rotation/translation per display slot (sliders)
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
| **Interpolation** | Interpolation between texture frames: none, linear fade |
| **Color behavior** | What each RGB byte of overlay color controls (pitch/yaw/roll/time/scale/overlay/hurt) |
| **Auto Rotate** | Shader estimates rotation from normals (yaw, pitch, or both) |
| **No Shadow** | Disable face-normal shading |
| **Flip UV** | Flip texture UVs vertically (try if model looks wrong) |
| **No PoT** | Don't round texture height to power of two |
| **Filter Armature** | Exclude bone shapes from export (enable for armature rigs) |

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
execute as @e[type=armor_stand] run function mypack:animations/walk/play
```

## Resource pack structure

```
objcubed/
  pack.mcmeta
  assets/minecraft/
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
    models/custom/                   — your exported JSON models
    textures/block/                  — your exported PNG textures
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

## Controlling animation via color

Items with overlay color (potions, dyed leather armor) can pass data to the shader through RGB bytes. The `colorbehavior` setting defines what each byte controls:

- `pitch` / `yaw` / `roll` — rotation angles
- `time` — animation time offset
- `scale` — model scale
- `overlay` — overlay color hue
- `hurt` — hurt flash

When `colorbehavior = time/time/time`, the shader uses `potion_contents.custom_color` as a 24-bit animation control value. Values below 8388608 are autoplay offsets; values above are manual frame indices.

## Notes

- **Flipped UV** — BlockBench OBJ export sometimes flips UVs. Use the Flip UV option if the model looks wrong.
- **Alpha preservation** — The plugin uses a custom PNG encoder (Node.js zlib) instead of canvas to avoid alpha premultiplication corrupting RGB data.
- **Texture size** — Minimum 8px wide. Wider textures are recommended for high vertex counts or animations.
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
