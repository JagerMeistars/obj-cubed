// Apply a real item's affine carrier pose to geometry decoded once in a
// canonical carrier. Requires Sampler0 and ProjMat; no subgroup operations.
#ifndef OBJCUBED_PORTABLE_ITEM_AFFINE_GLSL
#define OBJCUBED_PORTABLE_ITEM_AFFINE_GLSL

// Exported NORTH carriers have semantic UV corners min/min, min/max,
// max/max, max/min. Recover them after an arbitrary arena baseVertex rotates
// the sparse transfer's vertexID&3 slots. Not for rotated/mirrored JSON UVs.
bool oc_item_order_carrier(vec3 sourcePos[4],vec2 sourceUV[4],
                           out vec3 orderedPos[4],out vec2 orderedUV[4]) {
    vec2 middle=(sourceUV[0]+sourceUV[1]+sourceUV[2]+sourceUV[3])*0.25;
    int mask=0;
    for(int i=0;i<4;++i) {
        bool right=sourceUV[i].x>middle.x, bottom=sourceUV[i].y>middle.y;
        int corner=right?(bottom?2:3):(bottom?1:0);
        if((mask&(1<<corner))!=0) return false;
        mask|=1<<corner;
        orderedPos[corner]=sourcePos[i];orderedUV[corner]=sourceUV[i];
    }
    return mask==15;
}

struct OcItemAffine {
    mat3 transform;
    vec3 anchor;
    vec3 lift;
    bool visible;
    int gui;
    int hand;
};

// canonical main must receive positions (1,1,0),(1,0,0),(0,0,0),(0,1,0),
// oc_uv[*]=(markerPixel+0.5)/atlasSize, and an actual UV0 within markerPixel.
// It must decode with visibility forced true. It therefore includes GUI q16
// display and color behavior, but has no dynamic Z override or ground lift.
// carrierUV contains the actual normalized source UVs, in carrier corner order.
OcItemAffine oc_item_affine_init(vec3 carrierPos[4], vec2 carrierUV[4],
                                 ivec2 markerPixel, bool gui) {
    OcItemAffine result;
    result.transform=mat3(1.0);
    result.anchor=carrierPos[2];
    result.lift=vec3(0.0);
    result.gui=int(gui);
    result.hand=0;
    result.visible=false;
    ivec2 atlas=textureSize(Sampler0,0);
    ivec4 offset=ivec4(texelFetch(Sampler0,markerPixel,0)*255.0+0.5);
    ivec2 origin=markerPixel-ivec2(offset.r*256+offset.g,offset.b*256+offset.a);
    if(any(lessThan(origin,ivec2(0)))||any(greaterThanEqual(origin,atlas))) return result;
    ivec4 header6=ivec4(texelFetch(Sampler0,origin+ivec2(6,0),0)*255.0+0.5);
#ifdef ENTITY
    ivec4 flags=ivec4(texelFetch(Sampler0,origin+ivec2(5,1),0)*255.0+0.5);
    float midpoint=(carrierUV[0].x+carrierUV[2].x)*0.5*float(atlas.x);
    float fraction=fract(midpoint);
    int slot=flags.b>=1?clamp(int(round((fraction-0.5)/0.035)),0,8)
                       :(fraction>0.575?-1:0);
    ivec4 entry=ivec4(0);
    if(flags.b>=1 && slot>=1) {
        int x=slot<=4?slot-1:6+2*flags.g+slot-5;
        entry=ivec4(texelFetch(Sampler0,origin+ivec2(x,1),0)*255.0+0.5);
    }
    result.hand=int(abs(ProjMat[3][2]+0.10005)<0.00001);
    if(flags.b>=2) {
        result.hand=int(slot>=1 && slot<=((flags.r>>1)&15)
                        && (entry.b&2)!=0 && !gui);
    }
    bool world=result.gui+result.hand==0;
    result.visible=(world && (header6.r&16)!=0)
                  || (result.hand!=0 && (header6.r&8)!=0)
                  || (gui && (header6.r&4)!=0);
    // Only q16 GUI headers use the slot-size multiplication in existing main.
    if(gui && header6.b==2)
        result.transform*=distance(carrierPos[0],carrierPos[1]);
    if(result.hand!=0 || world) {
        vec3 ex=carrierPos[0]-carrierPos[1];
        vec3 ey=carrierPos[0]-carrierPos[3];
        float sx=length(ex), sy=length(ey);
        if(sx<=1e-12 || sy<=1e-12) { result.visible=false; return result; }
        vec3 uy=ex/sx;
        vec3 ux=ey-dot(ey,uy)*uy;
        float uxLength=length(ux);
        if(uxLength<=1e-12) { result.visible=false; return result; }
        ux/=uxLength;
        mat3 rotation=mat3(ux,uy,cross(ux,uy));
        float sz=min(sx,sy);
        if(flags.b>=1 && slot>=1) {
            float encodedZ=float(entry.r*256+entry.g)/65535.0*4.0;
            if(encodedZ>0.0) sz=encodedZ;
        }
        if(world && (slot==-1 || (flags.b>=1 && slot>=1 && (entry.b&1)!=0)))
            result.lift=vec3(0.0,0.5,0.0);
        result.transform=rotation*mat3(vec3(sy,0,0),vec3(0,sx,0),vec3(0,0,sz))
                         *result.transform;
    }
#else
    result.gui=0;
    result.visible=(header6.r&16)!=0;
#endif
    return result;
}

vec3 oc_item_affine_apply(OcItemAffine pose, vec3 canonicalPosition) {
    return pose.anchor+pose.transform*(canonicalPosition+pose.lift);
}
#endif
