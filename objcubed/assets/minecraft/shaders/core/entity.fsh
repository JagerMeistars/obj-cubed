#version 330

#moj_import <minecraft:fog.glsl>
// Guarded like entity.vsh: NO_CARDINAL_LIGHTING pipelines don't provide
// the Lighting UBO that light.glsl declares. objmc_light.glsl guards its
// minecraft_mix_light use with the same condition.
#if defined(PER_FACE_LIGHTING) || !defined(NO_CARDINAL_LIGHTING)
#moj_import <minecraft:light.glsl>
#endif
#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:oit.glsl>

uniform sampler2D Sampler0;

in float sphericalVertexDistance;
in float cylindricalVertexDistance;
#ifdef PER_FACE_LIGHTING
in vec4 vertexPerFaceColorBack;
in vec4 vertexPerFaceColorFront;
#else
in vec4 vertexColor;
#endif

in vec4 lightColor;
in vec4 overlayColor;
in vec2 texCoord;
in vec2 texCoord2;   // next animated-texture frame (armor/entity cross-fade)
in vec3 Pos;
in float transition;

flat in int isCustom;
flat in int isGUI;
flat in int isHand;
flat in int noshadow;

#ifndef OIT_ALPHA_ONLY
out vec4 fragColor;
#endif

// objmc applies its own lighting/overlay inline before this; only OIT
// accumulation (in that phase) + fog remain — mirrors vanilla 26.3.
vec4 calculateFinalColor(vec4 color) {
    #ifdef OIT_ACCUMULATE
    color = sampleColorForAccumulation(color);
    vec4 fogColor = vec4(FogColor.rgb * color.a, FogColor.a);
    #else
    vec4 fogColor = FogColor;
    #endif
    return apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart, FogRenderDistanceEnd, fogColor);
}

void main() {
    // objmc debug bypass (isCustom == 2 flag set in vertex shader)
    if (isCustom == 2) {
#ifdef OIT_ALPHA_ONLY
        executeAlphaOnlyPhase(gl_FragCoord.z, 1.0);
#else
        fragColor = vec4(overlayColor.rgb, 1.0);
#endif
        return;
    }

    // Animated-texture cross-fade (issue: armor frames hard-stepped). transition>0 only
    // when the armor path set texCoord2 + texFade; 0 otherwise -> plain sample (no-op).
    vec4 color = transition > 0.0
        ? mix(texture(Sampler0, texCoord), texture(Sampler0, texCoord2), transition)
        : texture(Sampler0, texCoord);

    //custom lighting
    #define ENTITY
    #moj_import<objmc_light.glsl>

#ifdef ALPHA_CUTOUT
    if (color.a < ALPHA_CUTOUT) discard;
#endif
#ifndef NO_OVERLAY
    color.rgb = mix(overlayColor.rgb, color.rgb, overlayColor.a);
#endif

#ifdef OIT_ALPHA_ONLY
    executeAlphaOnlyPhase(gl_FragCoord.z, color.a);
#else
    fragColor = calculateFinalColor(color);
#endif
}
