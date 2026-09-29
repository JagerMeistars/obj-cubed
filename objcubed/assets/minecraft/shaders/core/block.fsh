#version 330
#extension GL_ARB_separate_shader_objects : require

#include <minecraft:fog.glsl>
#include <minecraft:dynamictransforms.glsl>
#include <minecraft:oit.glsl>

uniform sampler2D Sampler0;

layout(location = 0) in float sphericalVertexDistance;
layout(location = 1) in float cylindricalVertexDistance;
layout(location = 2) in vec4 vertexColor;
layout(location = 3) in vec4 lightColor;
layout(location = 4) in vec2 texCoord;
layout(location = 5) in vec2 texCoord2;
layout(location = 6) in vec3 Pos;
layout(location = 7) in float transition;
layout(location = 8) flat in int isCustom;
layout(location = 9) flat in int noshadow;

#ifndef OIT_ALPHA_ONLY
layout(location = 0) out vec4 fragColor;
#endif

#ifndef OIT_ALPHA_ONLY
vec4 calculateFinalColor(vec4 color) {
#ifdef OIT_ACCUMULATE
    color = sampleColorForAccumulation(color);
    vec4 fogColor = vec4(FogColor.rgb * color.a, FogColor.a);
#else
    vec4 fogColor = FogColor;
#endif
    return apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart, FogRenderDistanceEnd, fogColor);
}
#endif

vec4 sampleColor(vec2 uv) {
    if (isCustom == 1) {
        return texelFetch(Sampler0, ivec2(uv * textureSize(Sampler0, 0)), 0);
    }
    return texture(Sampler0, uv);
}

void main() {
    // Evaluate before alpha discard and divergent branches: live helper lanes
    // are required for defined geometric derivatives on tiny triangles.
    vec3 objmcPosDx = dFdx(Pos);
    vec3 objmcPosDy = dFdy(Pos);
    vec4 color = transition > 0.0 ? mix(sampleColor(texCoord), sampleColor(texCoord2), transition) : sampleColor(texCoord);
#ifdef ALPHA_CUTOUT
    if (color.a < ALPHA_CUTOUT) discard;
#endif

    if (isCustom == 0) {
        color *= vertexColor * ColorModulator;
#if !defined(EMISSIVE) && !defined(OIT_ALPHA_ONLY)
        color *= lightColor;
#endif
    } else if (isCustom == 1) {
        // The decoder supplies the tint and the deformed surface normal.
        #define BLOCK
        #include <minecraft:objmc_light.glsl>
    }

#ifdef OIT_ALPHA_ONLY
    executeAlphaOnlyPhase(gl_FragCoord.z, color.a);
#else
    fragColor = calculateFinalColor(color);
#endif
}
