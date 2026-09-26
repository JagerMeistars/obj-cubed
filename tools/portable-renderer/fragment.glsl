vec3 oc_surface_normal;
vec2 oc_uv_dx,oc_uv_dy,oc_uv2_dx,oc_uv2_dy;
#ifdef GLINT
vec2 oc_glint_dx,oc_glint_dy;
vec4 oc_sample_glint(vec2 uv) {
    return isCustom==0?texture(GlintSampler,uv):textureGrad(GlintSampler,uv,oc_glint_dx,oc_glint_dy);
}
#endif
vec4 oc_sample_model(vec2 uv,bool second) {
    if(isCustom==0) return texture(Sampler0,uv);
    return second?textureGrad(Sampler0,uv,oc_uv2_dx,oc_uv2_dy):textureGrad(Sampler0,uv,oc_uv_dx,oc_uv_dy);
}
vec3 oc_triangle_weights(vec2 point,vec4 a,vec4 b,vec4 c) {
    vec3 x=vec3(a.xy-point*a.w,1.0),y=vec3(b.xy-point*b.w,1.0),z=vec3(c.xy-point*c.w,1.0);
    float determinant=dot(x,cross(y,z));
    return vec3(cross(y,z).z,cross(z,x).z,cross(x,y).z)/determinant;
}

// Solve barycentrics in homogeneous clip space. This also handles triangles
// crossing the near plane; no projected division by a negative vertex W.
bool oc_triangle_hit(vec2 point, vec4 a, vec4 b, vec4 c, out vec3 weight, out float depth) {
    vec3 x=vec3(a.xy-point*a.w,1.0);
    vec3 y=vec3(b.xy-point*b.w,1.0);
    vec3 z=vec3(c.xy-point*c.w,1.0);
    vec3 yz=cross(y,z);
    float determinant=dot(x,yz);
    if (abs(determinant)<1e-14) return false;
    weight=vec3(yz.z,cross(z,x).z,cross(x,y).z)/determinant;
    if (any(lessThan(weight,vec3(-0.000001)))) return false;
    vec4 clip=a*weight.x+b*weight.y+c*weight.z;
    if (clip.w<=0.0) return false;
    return oc_project_fragment_depth(clip,depth);
}

vec4 oc_unpack_rgba(uint p) {
    return vec4(p&255u,(p>>8u)&255u,(p>>16u)&255u,(p>>24u)&255u)/255.0;
}
void oc_portable_fragment() {
    int mode=int(oc_parameters.w+.5);
    transition=0.0;
    isCustom=0;
    noshadow=0;
    Pos=vec3(0.0);
#ifdef ENTITY
    isGUI=0;
    isHand=0;
#endif
    if(mode==0) {
        float w=1.0/oc_uv23.w;
        texCoord=oc_p0.xy*w;
        texCoord2=texCoord;
        sphericalVertexDistance=oc_uv23.x*w;
        cylindricalVertexDistance=oc_uv23.y*w;
#ifdef GLINT
        texCoordGlint=oc_p0.zw*w;
#endif
#ifdef PER_FACE_LIGHTING
        vertexPerFaceColorFront=oc_p1*w;
        vertexPerFaceColorBack=oc_p2*w;
#else
        vertexColor=oc_p1*w;
#endif
        lightColor=oc_p3*w;
#ifdef ENTITY
        overlayColor=oc_uv01*w;
#endif
#ifdef OC_TERRAIN
        chunkVisibility=oc_uv23.z*w;
#endif
        return;
    }
    if(mode==2 && !oc_armor_carrier_used(vec4(oc_p0.w,oc_p1.w,oc_p2.w,oc_p3.w),oc_uv01,oc_uv23)) discard;
    // The mode is flat for each primitive, so all helper lanes execute these
    // derivatives together before any per-pixel hit/visibility rejection.
    bool carrierValid;
#ifdef ENTITY
    if(mode==4 || mode==5) {
        carrierValid=oc_decode_armor_as1_carrier(oc_carrier_positions);
        oc_armor_as1_carrier_uvs(int(oc_parameters.z+.5));
    } else
#endif
    carrierValid=oc_portable_decode(oc_p0,oc_p1,oc_p2,oc_p3,oc_uv01,oc_uv23,oc_high01,oc_high12,oc_high23,oc_carrier_positions,oc_carrier_uvs);
    vec2 screenPoint=vec2(oc_p1.w+oc_p2.w,oc_p2.w+oc_p3.w)*2.0-1.0;
    if(mode==4 || mode==5) {
        int target=int(oc_parameters.z+.5)&7;
        if(target==3||target==5||target==7) screenPoint.x=-screenPoint.x;
    }
    vec2 screenDx=dFdx(screenPoint),screenDy=dFdy(screenPoint);
    if(!carrierValid) discard;
    lightColor=oc_unpack_rgba(oc_packed.y);
    oc_control_color=oc_unpack_rgba(oc_packed.x);
    oc_source_normal=oc_unpack_rgba(oc_packed.w).xyz*2.0-1.0;
#ifdef OC_TERRAIN
    chunkVisibility=uintBitsToFloat(oc_packed.z);
#endif
    vec2 atlas=vec2(textureSize(Sampler0,0));
    uint pixelWord=oc_packed.w;
    ivec2 markerPixel=ivec2(pixelWord&65535u,pixelWord>>16u);
    for(int i=0;i<4;i++) {
        if(mode!=4 && mode!=5) oc_carrier_uvs[i]=mode!=2?(oc_carrier_uvs[i]+vec2(markerPixel))/atlas:round(oc_carrier_uvs[i])/vec2(64.0,32.0);
        oc_source_uvs[i]=oc_carrier_uvs[i];
    }
    // Shared vertex arenas may start a quad at any vertexID modulo four.
    // The exporter uses vanilla NORTH UV roles, so restore semantic corner
    // order from UV quadrants rather than inheriting the arena's offset.
    if(mode!=2 && mode!=4 && mode!=5) {
        vec3 positions[4]; vec2 uvs[4];
        if(!oc_item_order_carrier(oc_carrier_positions,oc_carrier_uvs,positions,uvs)) discard;
        for(int i=0;i<4;i++) { oc_carrier_positions[i]=positions[i]; oc_carrier_uvs[i]=uvs[i]; }
    }
    float carrierLift=0.0;
    OcDecodedVertex vertex[4];
    if(mode!=2 && mode!=4 && mode!=5) {
        int flags=int(oc_parameters.z+.5);
        OcItemAffine pose=oc_item_affine_init(oc_carrier_positions,oc_carrier_uvs,markerPixel,(flags&1)!=0);
        if(!pose.visible) discard;
        carrierLift=pose.lift.y;
        if(mode==3) {
            int face=oc_bvh_trace(pose,markerPixel,screenPoint);
            if(face<0) discard;
            ivec4 offset=ivec4(texelFetch(Sampler0,markerPixel,0)*255.0+.5);
            ivec2 top=markerPixel-ivec2(offset.r*256+offset.g,offset.b*256+offset.a);
            ivec4 size=getmeta(top,1);
            int width=size.r*256+size.g;
            vec2 sourceUV=(vec2(top+ivec2(face%width,2+face/width))+vec2(.5))/atlas;
#ifdef ENTITY
            oc_control_color=oc_unpack_rgba(oc_packed.z);
#endif
            vec2 markerShift=(vec2(top+ivec2(face%width,2+face/width))-vec2(markerPixel))/atlas;
            for(int i=0;i<4;i++) { oc_source_uvs[i]=sourceUV;oc_carrier_uvs[i]+=markerShift; }
            for(int i=0;i<4;i++) vertex[i]=oc_decode_vertex(i);
        } else {
        vec3 localPos[4]=vec3[4](oc_decoded0.xyz,vec3(oc_decoded0.w,oc_decoded1.xy),vec3(oc_decoded1.zw,oc_decoded2.x),oc_decoded2.yzw);
        vec2 uv[4]=vec2[4](oc_decoded_uv01.xy,oc_decoded_uv01.zw,oc_decoded_uv23.xy,oc_decoded_uv23.zw);
        for(int i=0;i<4;i++) {
            vertex[i].position=oc_item_affine_apply(pose,localPos[i]);
            vertex[i].uv=uv[i];
            vertex[i].uv2=uv[i]+vec2(0.0,oc_parameters.x);
            vertex[i].blend=oc_parameters.y;
            vertex[i].custom=(flags&4)!=0?2:1;
            vertex[i].gui=pose.gui;
            vertex[i].hand=pose.hand;
            vertex[i].shadow=(flags>>1)&1;
            vertex[i].overlay=oc_control_color;
        }
        }
    } else if(mode==4 || mode==5) {
#ifdef ENTITY
        if(mode==5) {
            int face=oc_armor_bvh_trace(screenPoint);
            if(face<0) discard;
            if(!oc_decode_armor_bvh(face,vertex)) discard;
        } else {
            vec3 localPos[4]=vec3[4](oc_decoded0.xyz,vec3(oc_decoded0.w,oc_decoded1.xy),vec3(oc_decoded1.zw,oc_decoded2.x),oc_decoded2.yzw);
            vec2 uv[4]=vec2[4](oc_decoded_uv01.xy,oc_decoded_uv01.zw,oc_decoded_uv23.xy,oc_decoded_uv23.zw);
            if(!oc_apply_armor_as1(int(oc_parameters.z+.5),localPos,uv,vertex)) discard;
        }
#else
        discard;
#endif
    } else {
        oc_decode_armor(vertex);
    }
    vec4 projected[4];
    for(int i=0;i<4;i++) projected[i]=ProjMat*ModelViewMat*vec4(vertex[i].position,1.0);
    vec3 w0,w1;
    float z0,z1;
    bool hit0=oc_triangle_hit(screenPoint,projected[0],projected[1],projected[2],w0,z0);
    bool hit1=oc_triangle_hit(screenPoint,projected[2],projected[3],projected[0],w1,z1);
    if (!hit0 && !hit1) discard;
    // Minecraft 26.3 uses reversed depth. A folded quad keeps its nearest
    // intersection; separate original faces still participate independently.
    bool second=hit1 && (!hit0 || z1>z0);
    ivec3 ids=second?ivec3(2,3,0):ivec3(0,1,2);
    vec3 weight=second?w1:w0;
    oc_set_fragment_depth(second?z1:z0);
    OcDecodedVertex a=vertex[ids.x], b=vertex[ids.y], c=vertex[ids.z];
    vec3 wx=oc_triangle_weights(screenPoint+screenDx,projected[ids.x],projected[ids.y],projected[ids.z]);
    vec3 wy=oc_triangle_weights(screenPoint+screenDy,projected[ids.x],projected[ids.y],projected[ids.z]);
    vec3 dwx=wx-weight,dwy=wy-weight;
    oc_uv_dx=a.uv*dwx.x+b.uv*dwx.y+c.uv*dwx.z;
    oc_uv_dy=a.uv*dwy.x+b.uv*dwy.y+c.uv*dwy.z;
    oc_uv2_dx=a.uv2*dwx.x+b.uv2*dwx.y+c.uv2*dwx.z;
    oc_uv2_dy=a.uv2*dwy.x+b.uv2*dwy.y+c.uv2*dwy.z;
    vec4 ca=projected[ids.x],cb=projected[ids.y],cc=projected[ids.z];
    float orientation=dot(vec3(ca.xy,ca.w),cross(vec3(cb.xy,cb.w),vec3(cc.xy,cc.w)));
    float windowOrientation=screenDx.x*screenDy.y-screenDx.y*screenDy.x;
    // Analytic face normal avoids taking derivatives across different BVH
    // hits, which would create seams between otherwise flat adjacent faces.
    oc_surface_normal=normalize(cross(b.position-a.position,c.position-a.position))*sign(orientation*windowOrientation);

    Pos=a.position*weight.x+b.position*weight.y+c.position*weight.z;
    texCoord=a.uv*weight.x+b.uv*weight.y+c.uv*weight.z;
    texCoord2=a.uv2*weight.x+b.uv2*weight.y+c.uv2*weight.z;
    transition=a.blend*weight.x+b.blend*weight.y+c.blend*weight.z;
    isCustom=a.custom;
    noshadow=a.shadow;
    sphericalVertexDistance=fog_spherical_distance(a.position)*weight.x+fog_spherical_distance(b.position)*weight.y+fog_spherical_distance(c.position)*weight.z;
    cylindricalVertexDistance=fog_cylindrical_distance(a.position)*weight.x+fog_cylindrical_distance(b.position)*weight.y+fog_cylindrical_distance(c.position)*weight.z;
#ifdef ENTITY
    isGUI=a.gui;
    isHand=a.hand;
    overlayColor=a.overlay*weight.x+b.overlay*weight.y+c.overlay*weight.z;
#endif
#ifdef GLINT
#ifdef GLINT_SPECIAL
    vec2 glintUV=oc_item_special_glint_uv(ids,weight,isGUI,isHand,carrierLift);
#else
    vec2 glintUV=oc_carrier_uvs[ids.x]*weight.x+oc_carrier_uvs[ids.y]*weight.y+oc_carrier_uvs[ids.z]*weight.z;
#endif
    texCoordGlint=(TextureMat*vec4(glintUV,0.0,1.0)).xy;
#ifdef GLINT_SPECIAL
    vec2 glintX=oc_item_special_glint_uv(ids,dwx,isGUI,isHand,carrierLift);
    vec2 glintY=oc_item_special_glint_uv(ids,dwy,isGUI,isHand,carrierLift);
#else
    vec2 glintX=oc_carrier_uvs[ids.x]*dwx.x+oc_carrier_uvs[ids.y]*dwx.y+oc_carrier_uvs[ids.z]*dwx.z;
    vec2 glintY=oc_carrier_uvs[ids.x]*dwy.x+oc_carrier_uvs[ids.y]*dwy.y+oc_carrier_uvs[ids.z]*dwy.z;
#endif
    oc_glint_dx=(TextureMat*vec4(glintX,0.0,0.0)).xy;
    oc_glint_dy=(TextureMat*vec4(glintY,0.0,0.0)).xy;
#endif
}
