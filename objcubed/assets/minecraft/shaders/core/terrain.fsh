#version 330

#moj_import <minecraft:fog.glsl>
#moj_import <minecraft:globals.glsl>
#moj_import <minecraft:chunksection.glsl>
// (no minecraft:light.glsl: terrain pipelines don't provide the Lighting
// UBO it declares, and the BLOCK branch of objmc_light.glsl doesn't need it)
// 26.3 moved sampleNearest/sampleRGSS out of terrain.fsh into this include.
#moj_import <minecraft:texture_sampling.glsl>
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

// sampleNearest / sampleRGSS now come from <minecraft:texture_sampling.glsl>
// (26.3). Only the objmc-specific dispatcher stays local: the isCustom==1 path
// keeps the exact-texel fetch the encoder relies on.
vec4 sampleColor(vec2 uv) {
    if (isCustom == 1)
        return texelFetch(Sampler0, ivec2(uv * textureSize(Sampler0, 0)), 0);
    return UseRgss == 1 ? sampleRGSS(Sampler0, uv, 1.0f / TextureSize) : sampleNearest(Sampler0, uv, 1.0f / TextureSize);
}

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
    vec4 color = mix(sampleColor(texCoord), sampleColor(texCoord2), transition);

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
