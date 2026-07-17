#version 330

#moj_import <minecraft:fog.glsl>
#moj_import <minecraft:dynamictransforms.glsl>
// (no minecraft:light.glsl: block pipelines don't provide the Lighting
// UBO it declares, and the BLOCK branch of objmc_light.glsl doesn't need it)
#moj_import <minecraft:oit.glsl>

uniform sampler2D Sampler0;

in float sphericalVertexDistance;
in float cylindricalVertexDistance;
in vec4 vertexColor;

in vec4 lightColor;
in vec2 texCoord;
in vec2 texCoord2;
in vec3 Pos;
in float transition;

flat in int isCustom;
flat in int noshadow;

#ifndef OIT_ALPHA_ONLY
out vec4 fragColor;
#endif

// objmc does its own lighting inline (objmc_light.glsl) before this runs, so the
// final step is just OIT accumulation (when in that phase) + fog — mirrors the
// vanilla 26.3 block.fsh calculateFinalColor.
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
    vec4 color;
    if (isCustom == 1) {
        color = mix(texelFetch(Sampler0, ivec2(texCoord * textureSize(Sampler0, 0)), 0),
                    texelFetch(Sampler0, ivec2(texCoord2 * textureSize(Sampler0, 0)), 0), transition);
    } else {
        color = mix(texture(Sampler0, texCoord), texture(Sampler0, texCoord2), transition);
    }

    //custom lighting
    #define BLOCK
    #moj_import<objmc_light.glsl>

#ifdef ALPHA_CUTOUT
    if (color.a < ALPHA_CUTOUT) {
        discard;
    }
#endif

#ifdef OIT_ALPHA_ONLY
    executeAlphaOnlyPhase(gl_FragCoord.z, color.a);
#else
    fragColor = calculateFinalColor(color);
#endif
}
