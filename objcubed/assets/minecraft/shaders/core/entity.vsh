#version 450
#extension GL_KHR_shader_subgroup_basic : require
#extension GL_KHR_shader_subgroup_ballot : require

#if defined(PER_FACE_LIGHTING) || !defined(NO_CARDINAL_LIGHTING)
#include <minecraft:objmc_skin_config.glsl>
#include <minecraft:light.glsl>
#endif
#include <minecraft:fog.glsl>
#include <minecraft:globals.glsl>
#include <minecraft:projection.glsl>
#include <minecraft:sample_lightmap.glsl>
#include <minecraft:dynamictransforms.glsl>

layout(location = 0) in vec3 Position;
layout(location = 1) in vec4 Color;
layout(location = 2) in vec2 UV0;
layout(location = 3) in ivec2 UV1;
layout(location = 4) in ivec2 UV2;
layout(location = 5) in vec3 Normal;

uniform sampler2D Sampler0;
#if !defined(NO_OVERLAY) && !defined(OIT_ALPHA_ONLY)
uniform sampler2D Sampler1;
#endif
#if !defined(EMISSIVE) && !defined(OIT_ALPHA_ONLY)
uniform sampler2D Sampler2;
#endif

layout(location = 0) out float sphericalVertexDistance;
layout(location = 1) out float cylindricalVertexDistance;
#ifdef PER_FACE_LIGHTING
layout(location = 2) out vec4 vertexPerFaceColorBack;
layout(location = 3) out vec4 vertexPerFaceColorFront;
#else
layout(location = 2) out vec4 vertexColor;
#endif
layout(location = 4) out vec4 lightColor;
layout(location = 5) out vec4 overlayColor;
layout(location = 6) out vec2 texCoord;
layout(location = 7) out vec2 texCoord2;
layout(location = 8) out vec3 Pos;
layout(location = 9) out float transition;
layout(location = 10) flat out int isCustom;
layout(location = 11) flat out int isGUI;
layout(location = 12) flat out int isHand;
layout(location = 13) flat out int noshadow;
layout(location = 17) out vec3 ocSmoothNormal;
#ifdef GLINT
layout(location = 14) out vec2 texCoordGlint;
#endif

#include <minecraft:objmc_tools.glsl>

// Read appended equipment descriptors as IEEE-754 little-endian bytes.
// Integer assembly also works on GLSL 330 without shader packing extensions.
float oc_animal_scalar(ivec2 coordinate) {
    uvec4 bytes = uvec4(texelFetch(Sampler0, coordinate, 0) * 255.0 + 0.5);
    return uintBitsToFloat(bytes.r | (bytes.g << 8u) | (bytes.b << 16u) | (bytes.a << 24u));
}

#include <minecraft:objmc_profile.glsl>

layout(location = 16) flat out int skinDonor;
void main() {
    ocSmoothNormal = vec3(0.0);
    skinDonor = -1;
    Pos = Position;
    texCoord = UV0;
    texCoord2 = UV0;
    transition = 0.0;
    isCustom = 0;
    noshadow = 0;
    lightColor = vec4(1.0);
    isGUI = 0;
    isHand = 0;
    overlayColor = vec4(1.0);
#if !defined(NO_OVERLAY) && !defined(OIT_ALPHA_ONLY)
    overlayColor = texelFetch(Sampler1, UV1, 0);
#endif
#ifdef PER_FACE_LIGHTING
    vec2 light = minecraft_compute_light(Light0_Direction, Light1_Direction, Normal);
    vertexPerFaceColorBack = minecraft_mix_light_separate(-light, Color);
    vertexPerFaceColorFront = minecraft_mix_light_separate(light, Color);
#elif defined(NO_CARDINAL_LIGHTING)
    vertexColor = Color;
#else
    vertexColor = minecraft_mix_light(Light0_Direction, Light1_Direction, Normal, Color);
#endif
#if !defined(EMISSIVE) && !defined(OIT_ALPHA_ONLY)
    lightColor = sample_lightmap(Sampler2, UV2);
#endif
#ifdef APPLY_TEXTURE_MATRIX
    texCoord = (TextureMat * vec4(UV0, 0.0, 1.0)).xy;
    texCoord2 = texCoord;
#endif
#ifdef GLINT
    texCoordGlint = (TextureMat * vec4(UV0, 0.0, 1.0)).xy;
#endif

    vec3 profilePos;vec2 profileUV;int profileUnlit;
    if(oc_native_profile(profilePos,profileUV,profileUnlit)) {
        Pos=profilePos;texCoord=profileUV;texCoord2=profileUV;isCustom=1;skinDonor=-2;
        overlayColor=vec4(1.0);noshadow=profileUnlit;
        gl_Position=ProjMat*ModelViewMat*vec4(Pos,1.0);
        sphericalVertexDistance=fog_spherical_distance(Pos);
        cylindricalVertexDistance=fog_cylindrical_distance(Pos);return;
    }
    #define ENTITY
    // Animal equipment has its own native 64x64 carrier layout. Dispatch it
    // before the item-atlas/humanoid decoder; ordinary entity textures retain
    // the existing path unless the complete marker matches.
    ivec4 ocEquipmentMarker = ivec4(texelFetch(Sampler0, ivec2(0), 0) * 255.0 + 0.5);
    if (ocEquipmentMarker == ivec4(12, 34, 56, 252)) {
        #include <minecraft:objmc_animal.glsl>
    } else {
        #include <minecraft:objmc_main.glsl>
    }

    gl_Position = ProjMat * ModelViewMat * vec4(Pos, 1.0);
    sphericalVertexDistance = fog_spherical_distance(Pos);
    cylindricalVertexDistance = fog_cylindrical_distance(Pos);

#if OC_PLAYER_SKINS
    // Measure the native head's vertical edge after the instance transform.
    // This follows non-uniform scale and rotation; world/camera translation is
    // small relative to the marker spacing within the tested viewing range.
    float markerDistance=length(Position);
    if (textureSize(Sampler0,0).x == 64 && markerDistance > 128.0) {
        vec3 p[4];vec2 uv[4];oc_read_carrier(Position,UV0,p,uv);
        float headScale=0.0;
        for(int i=1;i<4;i++){
            vec2 d=uv[i]-uv[0];
            if(abs(d.x)<0.0001 && abs(d.y)>0.01) headScale=max(headScale,2.0*length(p[i]-p[0]));
        }
        float marker=headScale>0.00001?markerDistance/headScale/16384.0:0.0;
        skinDonor=int(round(marker))-1;
        if(skinDonor<0 || skinDonor>7 || abs(marker-round(marker))>0.25){skinDonor=-1;return;}
        vec2 face = (UV0 * vec2(textureSize(Sampler0,0)) - vec2(8.0)) / 8.0;
        // Four tightly packed skins per edge: no per-slot row padding.
        float width=ScreenSize.x;
        float bandRows=ceil(16384.0/width);
        float first=float(skinDonor%4)*4096.0;
        float rows=ceil((mod(first,width)+4096.0)/width);
        float origin=skinDonor<4 ? 0.0 : ScreenSize.y-bandRows;
        vec2 pixel=vec2(0.0,origin+floor(first/width))+face*vec2(width,rows);
        gl_Position = vec4(pixel / ScreenSize * 2.0 - 1.0, 1.0, 1.0);
    }
#endif

}
