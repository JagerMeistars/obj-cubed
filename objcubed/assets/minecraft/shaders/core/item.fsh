#version 330
#extension GL_ARB_separate_shader_objects : require

#include <minecraft:fog.glsl>
#include <minecraft:light.glsl>
#include <minecraft:dynamictransforms.glsl>
#ifdef GLINT
#include <minecraft:globals.glsl>
#endif
#include <minecraft:oit.glsl>

uniform sampler2D Sampler0;
#ifdef GLINT
uniform sampler2D GlintSampler;
#endif

layout(location = 0) in float sphericalVertexDistance;
layout(location = 1) in float cylindricalVertexDistance;
layout(location = 2) in vec4 vertexColor;
layout(location = 4) in vec4 lightColor;
layout(location = 5) in vec4 overlayColor;
layout(location = 6) in vec2 texCoord;
layout(location = 7) in vec2 texCoord2;
layout(location = 8) in vec3 Pos;
layout(location = 9) in float transition;
layout(location = 10) flat in int isCustom;
layout(location = 11) flat in int isGUI;
layout(location = 12) flat in int isHand;
layout(location = 13) flat in int noshadow;
layout(location = 15) in float ocCarrierFailure;
#ifdef GLINT
layout(location = 14) in vec2 texCoordGlint;
#endif

#ifndef OIT_ALPHA_ONLY
layout(location = 0) out vec4 fragColor;
#endif

#ifndef OIT_ALPHA_ONLY
vec4 calculateFinalColor(vec4 color) {
#ifdef GLINT
    vec4 glintColor = GlintAlpha * texture(GlintSampler, texCoordGlint);
    color.rgb += glintColor.rgb * glintColor.rgb;
#endif
#ifdef OIT_ACCUMULATE
    color = sampleColorForAccumulation(color);
    vec4 fogColor = vec4(FogColor.rgb * color.a, FogColor.a);
#else
    vec4 fogColor = FogColor;
#endif
    return apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart, FogRenderDistanceEnd, fogColor);
}
#endif

void main() {
    // Evaluate before alpha discard and divergent branches: live helper lanes
    // are required for defined geometric derivatives on tiny triangles.
    vec3 objmcPosDx = dFdx(Pos);
    vec3 objmcPosDy = dFdy(Pos);
    // Reject a failed corner even when it is not the provoking vertex. The
    // derivatives cover edges where its interpolated weight rounds to zero.
    float ocFailureDx = dFdx(ocCarrierFailure);
    float ocFailureDy = dFdy(ocCarrierFailure);
    if (ocCarrierFailure != 0.0 || ocFailureDx != 0.0 || ocFailureDy != 0.0 || isCustom == 4) discard;
    // Debug probes still participate in all OIT passes.
    vec4 color = isCustom == 2 ? vec4(overlayColor.rgb, 1.0)
        : transition > 0.0 ? mix(texture(Sampler0, texCoord), texture(Sampler0, texCoord2), transition)
        : texture(Sampler0, texCoord);
#ifdef ALPHA_CUTOUT
    if (color.a < ALPHA_CUTOUT) discard;
#endif

    if (isCustom == 0) {
        color *= vertexColor * ColorModulator;
#if !defined(NO_OVERLAY) && !defined(OIT_ALPHA_ONLY)
        color.rgb = mix(overlayColor.rgb, color.rgb, overlayColor.a);
#endif
#if !defined(EMISSIVE) && !defined(OIT_ALPHA_ONLY)
        color *= lightColor;
#endif
    } else if (isCustom == 1) {
        // The decoder supplies the tint and the deformed surface normal.
        #define ENTITY
        #include <minecraft:objmc_light.glsl>
    }
#ifdef GLINT
    color.a = max(color.a, GlintAlpha);
#endif

#ifdef OIT_ALPHA_ONLY
    executeAlphaOnlyPhase(gl_FragCoord.z, color.a);
#else
    fragColor = calculateFinalColor(color);
#endif
}
