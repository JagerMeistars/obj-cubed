# Item predecode and affine carrier pose

`item-affine.glsl` lets the experimental renderer evaluate the existing item decoder in the vertex shader and reuse its four decoded vertices in fragments. It handles item/block carriers; armor still needs its own limb reconstruction. This helper does not modify the ordinary renderer or implement rasterization, lighting, or OIT.

The generated vertex decoder must use canonical carrier positions:

```text
0=(1,1,0), 1=(1,0,0), 2=(0,0,0), 3=(0,1,0)
```

Supply every `oc_read_carrier` UV as `(markerPixel + 0.5) / atlasSize`, while keeping the decoder's input `UV0` inside the actual face-marker pixel. Force the generated decoder's `visibility` to `bvec3(true)`; real visibility is checked after reconstructing context. Decode model corners 0–3 with the existing main. GUI classification still comes from the original projection checks, including the inventory-preview exception.

The neutral midpoint is essential: one input UV is an **endpoint**, so using it as the midpoint gives wrong slot IDs. The canonical pass intentionally applies no dynamic Z override or dropped-item lift. Hand/world canonical transforms are both identity. GUI q16 display rotation/scale/translation, its Y reflection, color behavior, frame selection, and texture animation remain in the existing decoder.

In the fragment shader, first reorder recovered sparse slots, then initialize the real pose once:

```glsl
vec3 orderedPos[4];
vec2 orderedUV[4];
if (!oc_item_order_carrier(carrierPos, carrierUV, orderedPos, orderedUV)) discard;
OcItemAffine pose = oc_item_affine_init(orderedPos, orderedUV, markerPixel, gui);
if (!pose.visible) discard;
for (int i = 0; i < 4; ++i)
    actualPos[i] = oc_item_affine_apply(pose, canonicalPos[i]);
```

`carrierUV` must be actual normalized atlas UVs. `markerPixel` is the integer atlas coordinate of the face marker. `gui` is the canonical decoder's `isGUI != 0`. `pose.hand` supplies actual hand context. The helper reads marker versions 0/1/2, dynamic Z and lift flags, and the header's visibility bits. World/hand reconstruction follows the existing Gram–Schmidt carrier basis and edge scales. Only GUI header version 2 gets slot-size multiplication; older GUI headers remain unscaled, as in the original shader. BLOCK applies only the carrier anchor.

The ordering follows the Minecraft 26.3 client jar: `FaceInfo.NORTH` uses MAX_X/MAX_Y, MAX_X/MIN_Y, MIN_X/MIN_Y, MIN_X/MAX_Y. `CuboidFace.UVs.getVertexU` chooses minU for corners 0/1, and `getVertexV` chooses minV for 0/3. Thus exported north-face corners are min/min, min/max, max/max, max/min in UV space. Sorting by UV quadrant removes arena base-offset dependence; FaceBakery winding recalculation swaps positions and UVs together. This assumes the exporter's unrotated, unmirrored UV rectangle, not an arbitrarily edited model JSON.

For compact cached UV output, `uv2 - uv` is face-constant when texture cross-fading is active. Without texture animation the old main leaves `texCoord2` at the original carrier UV, so that delta need not be constant; its blend is zero and it is visually unused. Packed color/light values and the approximate carrier transport introduce separate errors that this affine helper does not remove.

## Original-decoder GPU parity test

The test builds two shader functions from the current `objmc_main.glsl`: an unmodified item branch reading an actual carrier, and a canonical branch with only visibility forced true and carrier inputs replaced. It compares the first result against canonical decode plus `item-affine.glsl`. No subgroup operation or CPU reimplementation supplies the reference. Transform feedback captures all four corners, and a primitive query requires all four outputs, so a draw that produces no data cannot pass.

From the repository root, pass an actual exported animated item PNG:

```sh
mkdir -p work
node tools/portable-renderer/item-affine-test.mjs /path/to/export.png work/item-affine
cc -std=c11 -O2 -Wall -Wextra -Werror tools/portable-renderer/item-affine-test.c \
  -o work/item-affine-test $(pkg-config --cflags --libs epoxy) -lm
work/item-affine-test work/item-affine
```

The 12,960 draws cover ENTITY and BLOCK, marker versions 0/1/2, slots 0–8, every visibility combination, GUI q16 and legacy GUI, world/hand/player preview, reflected/nonuniform/sheared carrier poses, UV shrink, all four cyclic sparse-slot offsets, multiple tint/scale/hue/time controls, and all faces of the supplied fixture. Geometry easing modes vary too. The source PNG used for the recorded run was a 24-face, 40-frame animated fixture; selection includes its moving faces.

On 2026-09-26, NVIDIA GTX 1650 / driver 610.43.03 / OpenGL 3.3 passed all **51,840 corner comparisons**. Maximum position difference was **0.000000953674**, UV difference was zero, and tint/context/visibility comparisons passed. The position allowance is 0.00002. An AMD attempt was stopped after waiting over two minutes in a GPU synchronization wait while the device was already stalled by test-game work; it provides no AMD parity result.

A negative control swapped the reconstructed X/Y scale factors in the generated
test shader. It failed 2,592 ENTITY draws with maximum position error 2.11304;
BLOCK remained unchanged as expected. The original helper was not modified.

This establishes the tested decoder/pose factorization. It does not establish complete Minecraft visual parity, arbitrary exporter UV edits, GPU compatibility, or the speed of the full-screen renderer.
