// Special item foil for exporter-generated NORTH carriers, without more
// varyings. Minecraft 26.3 builds UV3 by applying inverse(foilPose) to the
// CPU-transformed vertex. foilPose is the SAME item pose, multiplied component
// wise by s=0.5 for GUI or s=0.75 for first person. The pose therefore cancels.
// SheetedDecalTextureGenerator's NORTH rotations produce -localXY/(128*s).
// These semantic corners match oc_item_order_carrier, regardless of arena IDs.
#ifndef OBJCUBED_PORTABLE_GLINT_GLSL
#define OBJCUBED_PORTABLE_GLINT_GLSL

vec2 oc_item_special_glint_corner(int corner,int gui,int hand,float carrierLift) {
    vec2 local=vec2(corner<2?1.5:0.5,(corner==0||corner==3)?1.5:0.5);
    // Ground/on_shelf JSON carriers have +8 model pixels in Y. The exporter
    // records this with the same flag used for pose.lift.y (0.5 block).
    local.y+=carrierLift;
    float foilScale=gui!=0?0.5:hand!=0?0.75:1.0;
    return -local*(0.0078125/foilScale);
}

// `weight` is the perspective-correct weight of the reconstructed hit.
// Apply TextureMat to the returned UV exactly as the original item.vsh does.
vec2 oc_item_special_glint_uv(ivec3 corners,vec3 weight,int gui,int hand,float carrierLift) {
    return oc_item_special_glint_corner(corners.x,gui,hand,carrierLift)*weight.x
         + oc_item_special_glint_corner(corners.y,gui,hand,carrierLift)*weight.y
         + oc_item_special_glint_corner(corners.z,gui,hand,carrierLift)*weight.z;
}

#endif
