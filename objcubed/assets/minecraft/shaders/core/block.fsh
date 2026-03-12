#version 150

#moj_import <minecraft:fog.glsl>
#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:light.glsl>

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

out vec4 fragColor;

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
    fragColor = apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart, FogRenderDistanceEnd, FogColor);
}
