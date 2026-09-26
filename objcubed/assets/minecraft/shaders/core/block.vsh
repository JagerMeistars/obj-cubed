#version 450
#extension GL_KHR_shader_subgroup_basic : require
#extension GL_KHR_shader_subgroup_ballot : require

#include <minecraft:fog.glsl>
#include <minecraft:globals.glsl>
#include <minecraft:projection.glsl>
#include <minecraft:sample_lightmap.glsl>
#include <minecraft:dynamictransforms.glsl>

layout(location = 0) in vec3 Position;
layout(location = 1) in vec4 Color;
layout(location = 2) in vec2 UV0;
layout(location = 3) in ivec2 UV2;

uniform sampler2D Sampler0;
#if !defined(EMISSIVE) && !defined(OIT_ALPHA_ONLY)
uniform sampler2D Sampler2;
#endif

layout(location = 0) out float sphericalVertexDistance;
layout(location = 1) out float cylindricalVertexDistance;
layout(location = 2) out vec4 vertexColor;
layout(location = 3) out vec4 lightColor;
layout(location = 4) out vec2 texCoord;
layout(location = 5) out vec2 texCoord2;
layout(location = 6) out vec3 Pos;
layout(location = 7) out float transition;
layout(location = 8) flat out int isCustom;
layout(location = 9) flat out int noshadow;

#include <minecraft:objmc_tools.glsl>

void main() {
    Pos = Position + ModelOffset;
    texCoord = UV0;
    texCoord2 = UV0;
    transition = 0.0;
    isCustom = 0;
    noshadow = 0;
    lightColor = vec4(1.0);
    vertexColor = Color;
#if !defined(EMISSIVE) && !defined(OIT_ALPHA_ONLY)
    lightColor = sample_lightmap(Sampler2, UV2);
#endif

    #define BLOCK
    #include <minecraft:objmc_main.glsl>

    gl_Position = ProjMat * ModelViewMat * vec4(Pos, 1.0);
    sphericalVertexDistance = fog_spherical_distance(Pos);
    cylindricalVertexDistance = fog_cylindrical_distance(Pos);
}
