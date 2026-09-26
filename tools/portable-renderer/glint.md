# Special item foil

`glint.glsl` reconstructs special item foil UV3 for the standard exported NORTH
carrier without adding varying components. Include it in the fragment stage.
Keep `pose.lift.y` from `oc_item_affine_init` for the active carrier, then after
choosing the decoded triangle use:

```glsl
#ifdef GLINT_SPECIAL
vec2 glintUV=oc_item_special_glint_uv(ids,weight,isGUI,isHand,carrierLift);
#else
vec2 glintUV=oc_carrier_uvs[ids.x]*weight.x
            +oc_carrier_uvs[ids.y]*weight.y
            +oc_carrier_uvs[ids.z]*weight.z;
#endif
texCoordGlint=(TextureMat*vec4(glintUV,0.0,1.0)).xy;
```

Use this only for custom item modes 1 and 3. Ordinary geometry retains the UV3
already computed by vanilla. Equipment uses ordinary foil UV0.

Verified against these methods in the official final Minecraft 26.3 client:

- `ItemFeatureRenderer.computeFoilDecalPose` copies the submitted item pose and
  multiplies every matrix component by 0.5 in GUI or 0.75 in first person.
- `VertexConsumer.putBakedQuadWithGlint` transforms baked positions by the item
  pose and supplies the inverse foil pose and inverse normal pose to
  `SheetedDecalTextureGenerator.setSheetedDecalUv`, with texture scale 1/128.
- For the NORTH face, the helper's fixed rotations produce negative local X/Y.
  The complete item pose cancels, including display transforms and left-hand
  reflections. Thus `UV3 = -bakedCarrierXY / (128 * contextScale)`.
- The exporter generates semantic corners `(1.5,1.5)`, `(1.5,0.5)`,
  `(0.5,0.5)`, `(0.5,1.5)`. Ground/on_shelf add 0.5 to baked Y; their slot
  marker records that shift. Geometry morphs deform the rendered surface but
  retain these original per-corner foil coordinates, matching the source path.

Calling the actual Java helper with rotated/nonuniformly scaled item poses
confirmed the formula in all three contexts. Java float inversion introduces
small roundoff (about 1e-8 for the tested poses) that the direct formula avoids.

The caller's GUI/hand flags must represent the item display context. Hand v3
exports encode it explicitly. Older PNGs still depend on the renderer's legacy
context heuristic and should be exported again. Hand-edited carrier geometry,
older carriers with a different baked origin, rotated JSON UVs, or a custom
face direction need their own baked-corner mapping; these cannot be recovered
from the standard shader header alone.
