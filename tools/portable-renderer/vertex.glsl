uint oc_pack_rgba(vec4 c) {
    uvec4 b=uvec4(round(clamp(c,0.0,1.0)*255.0));
    return b.x|(b.y<<8u)|(b.z<<16u)|(b.w<<24u);
}
void oc_portable_vertex() {
    vec3 sourcePosition=Pos;
    vec4 sourceLight=lightColor;
    // Ordinary geometry retains native smooth interpolation. All custom proxy
    // vertices have W=1, making the same interface affine for carrier payloads.
    float iw=1.0;
    oc_p0=vec4(texCoord,0.0,0.0)*iw;
#ifdef GLINT
    oc_p0.zw=texCoordGlint*iw;
#endif
#ifdef PER_FACE_LIGHTING
    oc_p1=vertexPerFaceColorFront*iw;
    oc_p2=vertexPerFaceColorBack*iw;
#else
    oc_p1=vertexColor*iw;
    oc_p2=vertexColor*iw;
#endif
    oc_p3=lightColor*iw;
    oc_uv01=vec4(1.0)*iw;
#ifdef ENTITY
    oc_uv01=overlayColor*iw;
    oc_source_normal=Normal;
#else
    oc_source_normal=vec3(0.0);
#endif
    oc_uv23=vec4(sphericalVertexDistance,cylindricalVertexDistance,1.0,1.0)*iw;
#ifdef OC_TERRAIN
    oc_uv23.z=chunkVisibility*iw;
#endif
    oc_high01=vec4(0.0); oc_high12=vec4(0.0); oc_high23=vec4(0.0);
    oc_decoded0=vec4(0.0); oc_decoded1=vec4(0.0); oc_decoded2=vec4(0.0);
    oc_decoded_uv01=vec4(0.0); oc_decoded_uv23=vec4(0.0);
    oc_parameters=vec4(0.0); oc_packed=uvec4(0u);
    ivec2 atlas=textureSize(Sampler0,0);
    ivec2 pixel=ivec2(UV0*vec2(atlas));
    ivec4 offset=ivec4(texelFetch(Sampler0,pixel,0)*255.0+0.5);
    ivec2 origin=pixel-ivec2(offset.r*256+offset.g,offset.b*256+offset.a);
    bool inAtlas=all(greaterThanEqual(origin,ivec2(0)))&&all(lessThan(origin,atlas));
    int mode=0;
    if(inAtlas) {
        ivec4 marker=ivec4(texelFetch(Sampler0,origin,0)*255.0+.5);
        if(marker.rgb==ivec3(12,34,56)) {
            if(marker.a==255) mode=1;
            if(mode==1) {
                ivec2 dimensions=ivec2(texelFetch(Sampler0,origin+ivec2(1,0),0).rg*255.0+.5);
                if(dimensions.r*256+dimensions.g>=20 && ivec3(texelFetch(Sampler0,origin+ivec2(19,0),0).rgb*255.0+.5)==ivec3(66,86,72)) mode=3;
            }
        }
    }
#ifdef ENTITY
    if(mode==0 && ivec4(texelFetch(Sampler0,ivec2(0),0)*255.0+0.5)==ivec4(12,34,56,253)) mode=2;
    if(mode==2 && atlas.x>=28 && ivec3(texelFetch(Sampler0,ivec2(26,0),0).rgb*255.0+.5)==ivec3(65,83,49)) mode=4;
    if(mode==2 && atlas.x>=32 && ivec3(texelFetch(Sampler0,ivec2(26,0),0).rgb*255.0+.5)==ivec3(65,83,50)) mode=5;
#endif
    if(mode==0) return;
#ifdef VULKAN
    int vid=gl_VertexIndex;
#else
    int vid=gl_VertexID;
#endif
    oc_control_color=Color;
    oc_packed=uvec4(oc_pack_rgba(Color),oc_pack_rgba(sourceLight),0u,0u);
#ifdef ENTITY
    oc_packed.z=oc_pack_rgba(overlayColor);
    oc_packed.w=oc_pack_rgba(vec4(Normal*.5+.5,1.0));
#endif
    vec2 localUV=(mode!=2 && mode!=4 && mode!=5) ? UV0*vec2(atlas)-vec2(pixel) : UV0*vec2(64.0,32.0);
    vec2 as1Screen=vec2(0.0);
#ifdef ENTITY
    if(mode==4||mode==5) {
        ivec4 route=getmeta(ivec2(0),27);
        int target=route.r;
        bool left=target==3||target==5||target==7;
        vec4 rect=oc_armor_as1_rect(target|(route.g<<3));
        vec2 q=clamp((localUV-rect.xy)/(rect.zw-rect.xy),vec2(0.0),vec2(1.0));
        as1Screen=vec2(left?q.x:1.0-q.x,q.y)*2.0-1.0;
        // Every non-target UV rectangle collapses to a line or point. Its
        // outside vertices need no model reads; preserve the exact proxy.
        if(any(lessThan(localUV,rect.xy))||any(greaterThan(localUV,rect.zw))) {
            gl_Position=vec4(as1Screen,.5,1.0);
            return;
        }
        if(mode==5) {
            int frame,easing;float fraction;
            oc_armor_bvh_clock(frame,easing,fraction);
            oc_decoded_uv01=vec4(float(frame),float(easing),fraction,0.0);
            oc_parameters.z=float(target|(route.g<<3)|(route.b!=0?64:0));
        } else {
        OcDecodedVertex v[4];int flags;
        oc_decode_armor_as1(v,flags);
        oc_decoded0=vec4(v[0].position,v[1].position.x);
        oc_decoded1=vec4(v[1].position.yz,v[2].position.xy);
        oc_decoded2=vec4(v[2].position.z,v[3].position);
        oc_decoded_uv01=vec4(v[0].uv,v[1].uv);
        oc_decoded_uv23=vec4(v[2].uv,v[3].uv);
        oc_parameters.xyz=vec3(v[0].uv2.y-v[0].uv.y,v[0].blend,float(flags));
        }
        vid=q.y<.5?(q.x>.5?0:1):(q.x>.5?3:2);
    }
#endif
    oc_portable_encode(vid,sourcePosition,localUV,oc_p0,oc_p1,oc_p2,oc_p3,oc_uv01,oc_uv23,oc_high01,oc_high12,oc_high23);
    oc_parameters.w=float(mode);
    if(mode!=2 && mode!=4 && mode!=5) {
        oc_carrier_positions[0]=vec3(1.0,1.0,0.0);
        oc_carrier_positions[1]=vec3(1.0,0.0,0.0);
        oc_carrier_positions[2]=vec3(0.0,0.0,0.0);
        oc_carrier_positions[3]=vec3(0.0,1.0,0.0);
        for(int i=0;i<4;i++) {
            oc_carrier_uvs[i]=(vec2(pixel)+vec2(.5))/vec2(atlas);
            oc_source_uvs[i]=UV0;
        }
        oc_basis_mode=mode==3;
        OcDecodedVertex v[4];
        for(int i=0;i<4;i++) v[i]=oc_decode_vertex(i);
        oc_decoded0=vec4(v[0].position,v[1].position.x);
        oc_decoded1=vec4(v[1].position.yz,v[2].position.xy);
        oc_decoded2=vec4(v[2].position.z,v[3].position);
        oc_decoded_uv01=vec4(v[0].uv,v[1].uv);
        oc_decoded_uv23=vec4(v[2].uv,v[3].uv);
        oc_basis_mode=false;
        oc_parameters.xyz=vec3(v[0].uv2.y-v[0].uv.y,v[0].blend,float(v[0].gui+2*v[0].shadow+4*(v[0].custom==2?1:0)));
        oc_packed.x=oc_pack_rgba(v[0].overlay);
        oc_packed.w=uint(pixel.x)|(uint(pixel.y)<<16u);
        if(mode==3) {
            oc_decoded_uv01=vec4(float(oc_animation_frame),float(oc_animation_easing),oc_animation_mix,float(oc_animation_frames));
            oc_packed.z=oc_pack_rgba(Color);
        }
    }
#ifdef OC_TERRAIN
    // Terrain has no entity tint/control payload. Preserve the vanilla chunk
    // appearance fade through the shared flat channel, including BVH carriers.
    oc_packed.z=floatBitsToUint(chunkVisibility);
#endif
    vec2 screen=(mode==4||mode==5)?as1Screen:oc_portable_screen_corner(vid)*2.0-1.0;
    gl_Position=vec4(screen,.5,1.0);
    // Pixel NDC is reconstructed from sparse weights: each corner owns its
    // known proxy coordinate. No viewport-size assumption (GUI atlases work).
}
