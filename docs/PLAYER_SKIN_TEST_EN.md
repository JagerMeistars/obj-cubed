# Player skins — experimental release 26.3v3

[Русская версия](PLAYER_SKIN_TEST_RU.md)

Player skin shaders are included in the main objcubed resource pack. No client
mod is required. Skin support is experimental; dynamic skins on worn armor are
not included in this release.

| Feature | Status |
| --- | --- |
| Skin from `minecraft:profile` on selected faces | Supported |
| Eight different profiles on `item_display` entities with context `none` | Eight slots assigned during export |
| `item_display` rotation, position and non-uniform scale | Tested in game |
| Lighting and transparent skin areas on `item_display` with context `none` | Requires Improved Transparency |
| Skins on first-person items | Lighting, transparent areas, transforms and animations |
| Dropped items, item frames, third person and the inventory player preview | Direct profile rendering, lighting and transparent areas |
| Dynamic skins on ordinary armor | Not implemented; export is rejected |
| Ordinary animated textures alongside a skin | Supported in the atlas; export has been tested |
| GUI | Shows the exported model with its skin and GUI display settings |

Here, lighting means Minecraft's normal face shading and lightmap lighting.
This feature does not add shadows cast by the model onto the ground.
The exporter's **Glow entire model** option disables lighting on the model itself.

## Installing the release

1. Install `objcubed.js`, replacing the previous copy of the plugin.
2. Extract `objcubed.zip` into a separate resource pack folder and export your
   models into that folder. You do not need a separate skin resource pack.
3. When exporting a model with skin faces, set **Datapack output directory** to
   `saves/<world>/datapacks`. The plugin creates an `objcubed_skin` folder there
   automatically. The release does not include an `objcubed_skin.zip` download;
   the plugin generates the datapack for your models.
4. Enable the resulting resource pack. For `item_display` with context `none`,
   enable **Improved Transparency**. Press F3+T and run `/reload`.
5. Re-export older models that use player skins: the item definition has changed.
   Replacing the PNG alone does not update it.

The release contains the plugin and the main resource pack, without test models
or test datapacks. Disable the earlier test packs to avoid mixing versions.
The unmodified release pack has no active post-processing effect. When you
export the first model with a skin, the plugin adds its effect definition;
the shaders themselves are already included in the main pack.
This effect is needed for the legacy first-person rendering path. It slightly
zooms the image to hide reserved screen edges: at 1280×720, 13 rows are reserved
at both the top and bottom. The game interface is not cropped.

Export all skin models that you intend to use together into the same resource
pack folder. The plugin extends the shared catalog at
`assets/objcubed/native_profiles.json` and its corresponding shader at
`assets/objcubed/shaders/include/profile_geometry.glsl`. Do not copy only the
model's PNG and JSON files, or stack packs exported separately: the shared
catalog and shader must contain all of the models.

## Using your own model

Right-click an empty area of Blockbench's **Textures** panel, then choose
**obj³: Add player skin template** → **Steve (Classic)** or **Alex (Slim)**. These are the original
64×64 Blockbench skin templates. Assign the template to the faces that should
use a player skin and arrange their UVs. Leave ordinary textures assigned to
the other faces. The export uses the template's UV coordinates; the template
image itself does not become the player's skin.

The exporter detects the template automatically. The texture list remains
accessible, and the atlas is enabled automatically. You can enable animation
for ordinary textures in the same section, separately from geometry animation.
The skin template itself must remain static.
Choose a **Skin slot** from 1–8, a model ID, the folder containing the extracted
main resource pack, and `saves/<world>/datapacks` as the datapack directory.
Set **Export as** to **Resource pack** and export.

To give yourself the model with a profile linked to your player, run:

```mcfunction
/function objcubed:skin/<model_id>/give
```

The generated datapack updates the profile of these models when they are held
in the main hand or offhand. For an `item_display`, set `minecraft:profile` when
creating it, or copy an item given by the function. The profile does not replace
the ordinary textures on the model's other faces.

With `item_display` context `none`, different profiles visible at the same time
need different slots. A slot belongs to the exported model: two items using
the same model but different profile names will conflict. Slots are not
automatically assigned to players.
First person, third person, item frames, dropped items and GUI read each item's
profile separately. Different profiles on the same model do not conflict in
those contexts.

## Examples from the separate test pack

The following commands and `.bbmodel` files belong to the earlier example pack.
They are not included in release 26.3v3 and will not appear after installing
the release resource pack. For your own model, use the give function above.

```mcfunction
/function objcubed:skin/test/three
/function objcubed:skin/test/eight
/function objcubed:skin/test/clear
/function objcubed:skin/skin_player_steve/give
/function objcubed:skin/skin_player_alex/give
/function objcubed:skin/skin_arm/give
```

The mannequins appear north of the player, towards −Z. The `clear` command
removes only the test mannequins. Steve and Alex use slot 1; the eight-mannequin
test uses slots 1–8. If Minecraft cannot load a profile by name, it displays
a default skin. Seeing a default skin does not prove that the requested
profile loaded successfully.

`skin_player_steve.bbmodel` and `skin_player_alex.bbmodel` include the base and
outer layers: 12 parts and 72 faces. Their geometry and UVs come from the
standard Blockbench 5.2.2 templates. Steve's arms are 4 pixels wide; Alex's are
3 pixels wide. `skin_faces.bbmodel` demonstrates ordinary materials and skin
faces on the same model.

## Limits and test coverage

Testing in Minecraft 26.3 / OpenGL / RTX 4060 Ti / 1280×720 covered eight profiles,
rotation and non-uniform scale, placement at X/Z=10000, the outer layer,
day and night lighting, simultaneous rendering in hands and in the world,
and toggling F3. At that time, 504 automated tests passed. This is a historical
result, not the test count for release 26.3v3. The interface was checked by
rendering its Vue template and testing its state; it was not tested
interactively in a running Blockbench instance. This build has not been
verified on AMD or Vulkan, or with a controlled comparative FPS benchmark.

A previous short first-person A/B test on October 11 used the same stationary
scene: an ordinary texture took 0.668–0.689 ms/frame, and a profile texture took
0.763–0.778 ms/frame. Each had two 3-second runs at 1280×720 with no FPS limit
and one 12-face arm model. Other tasks were also using the GPU. These results
do not establish performance for larger models or AMD hardware.

The October 14 context fixes require updating both the plugin and the main
resource pack, then re-exporting models that use skins. Set scale, rotation
and position in Blockbench's **Display** mode. Older exports keep the previous
rendering path until they are exported again.

Static models, automatic looping playback and commands from datapacks generated
by the new exporter are supported. For these models, the first entry of
`custom_model_data.floats` controls direct rendering; do not edit it separately.
Existing controllers that only change the potion color do not provide this
parameter. Manually selecting the RGB **Animation** mode (internally `time`)
without generating a datapack, and other special Color behavior modes, use
the legacy rendering path. Arbitrary tinting of the skin through the item's
color is not implemented in the new path.

The exporter adds direct-rendering geometry to the resource pack. More animated
models and frames can increase shader loading time; allow the first load of the
test pack to finish. The catalog is limited to 4095 identifiers: each group of
up to 12 faces uses one identifier for each of the nine display contexts.
Datapack-controlled animation adds variants for the animation frames.
If the limit would be exceeded, export stops with a message before writing
the model. On the test machine, the first compilation took about 1–2 minutes.

The separate test pack also contains `skin_control` for testing animation
commands. It is not included in the release:

```mcfunction
/function objcubed:skin/skin_control/give
/function objcubed:skin_control/init
/function objcubed:skin_control/play_once
```

Hold the given item in your main hand. `play` starts looping playback and
`stop` stops it. `skin_transform` demonstrates rotation and non-uniform scale;
give it to yourself with `/function objcubed:skin/skin_transform/give`.

In-game checks covered the right and left hands, two different profiles at
the same time, Steve and Alex with their outer layers, F3, day and night
lighting, non-uniform scale, rotation, translation, frame selection and
one-shot animation stopping on its last frame. These were local OpenGL checks
on an RTX 4060 Ti; the distributed feature requires no client mod. Command
behavior under multiplayer latency, AMD and Vulkan has not been tested.
Transparent areas were tested with skin alpha values of 0 and 255; arbitrary
partial transparency has not been tested with a separate in-game skin.
Without **Improved Transparency**, `item_display` with context `none` uses
the legacy path.

On October 14, separate checks covered dropped items, wall-mounted item frames,
the inventory icon and the item on the player in the inventory window.
Direct rendering preserves lighting and transparent areas with Improved
Transparency either enabled or disabled. The blue material in the player
preview has been fixed. For an `item_display` with external non-uniform scaling,
keep context `none`: explicitly selecting `fixed` enables direct rendering,
which does not support that scaling.

Ordinary armor uses a different rendering pass, without the required buffer
or the wearer's profile texture. The current method cannot simply be applied
to that pass. The vanilla requirement remains in place; dynamic player skins
on worn armor are not implemented. Ordinary armor with exported textures still
uses the existing system.

Compatibility with Chroma or Iris is not claimed for this integration. If the
target resource pack already has another end-of-frame effect, export stops
before writing files instead of replacing that effect.
