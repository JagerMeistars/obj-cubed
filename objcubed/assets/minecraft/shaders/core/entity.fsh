#version 150

#moj_import <minecraft:fog.glsl>
// Guarded like entity.vsh: NO_CARDINAL_LIGHTING pipelines (26.2) don't provide
// the Lighting UBO that light.glsl declares. objmc_light.glsl guards its
// minecraft_mix_light use with the same condition.
#if defined(PER_FACE_LIGHTING) || !defined(NO_CARDINAL_LIGHTING)
#moj_import <minecraft:light.glsl>
#endif
#moj_import <minecraft:dynamictransforms.glsl>

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

out vec4 fragColor;

void main() {
    // objmc debug bypass (isCustom == 2 flag set in vertex shader)
    if (isCustom == 2) {
        fragColor = vec4(overlayColor.rgb, 1.0);
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
    fragColor = apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart, FogRenderDistanceEnd, FogColor);
}
