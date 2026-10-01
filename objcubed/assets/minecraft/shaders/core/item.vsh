#version 450
#extension GL_KHR_shader_subgroup_basic : require
#extension GL_KHR_shader_subgroup_ballot : require

#include <minecraft:light.glsl>
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
#ifdef GLINT_SPECIAL
layout(location = 5) in vec2 UV3;
#endif
layout(location = 6) in vec3 Normal;

uniform sampler2D Sampler0;
#if !defined(NO_OVERLAY) && !defined(OIT_ALPHA_ONLY)
uniform sampler2D Sampler1;
#endif
#if !defined(EMISSIVE) && !defined(OIT_ALPHA_ONLY)
uniform sampler2D Sampler2;
#endif

layout(location = 0) out float sphericalVertexDistance;
layout(location = 1) out float cylindricalVertexDistance;
layout(location = 2) out vec4 vertexColor;
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
#ifdef GLINT
layout(location = 14) out vec2 texCoordGlint;
#endif

#include <minecraft:objmc_tools.glsl>
#define OC_REPEATED_ITEM_CARRIER
#ifdef VULKAN
#define OBJMC_INSTANCE_ID gl_InstanceIndex
#else
#define OBJMC_INSTANCE_ID gl_InstanceID
#endif
#include <minecraft:objmc_mesh_carrier.glsl>

layout(location = 15) out float ocCarrierFailure;

void main() {
    ocCarrierFailure = 0.0;
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
    vertexColor = minecraft_mix_light(Light0_Direction, Light1_Direction, Normal, Color);
#if !defined(EMISSIVE) && !defined(OIT_ALPHA_ONLY)
    lightColor = sample_lightmap(Sampler2, UV2);
#endif
#ifdef GLINT
#ifdef GLINT_SPECIAL
    texCoordGlint = (TextureMat * vec4(UV3, 0.0, 1.0)).xy;
#else
    texCoordGlint = (TextureMat * vec4(UV0, 0.0, 1.0)).xy;
#endif
#endif

    #define ENTITY
    #include <minecraft:objmc_main.glsl>

    gl_Position = ProjMat * ModelViewMat * vec4(Pos, 1.0);
    sphericalVertexDistance = fog_spherical_distance(Pos);
    cylindricalVertexDistance = fog_cylindrical_distance(Pos);
}
