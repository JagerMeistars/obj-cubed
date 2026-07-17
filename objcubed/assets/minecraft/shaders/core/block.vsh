#version 450
#extension GL_KHR_shader_subgroup_quad: enable

#moj_import <minecraft:fog.glsl>
#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:projection.glsl>
#moj_import <minecraft:globals.glsl>
in vec3 Position;
in vec4 Color;
in vec2 UV0;
in ivec2 UV2;

uniform sampler2D Sampler0;
// OIT (26.3): the alpha-only phase provides no lightmap sampler.
#ifndef OIT_ALPHA_ONLY
uniform sampler2D Sampler2;
#endif

out float sphericalVertexDistance;
out float cylindricalVertexDistance;
out vec4 vertexColor;

out vec4 lightColor;
out vec2 texCoord;
out vec2 texCoord2;
out vec3 Pos;
out float transition;

flat out int isCustom;
flat out int noshadow;

#moj_import <objmc_tools.glsl>

void main() {
    Pos = Position + ModelOffset;
    texCoord = UV0;
    texCoord2 = UV0;
    transition = 0;
    isCustom = 0;
    noshadow = 0;
#ifndef OIT_ALPHA_ONLY
    lightColor = texture(Sampler2, clamp((UV2 / 256.0) + 0.5 / 16.0, vec2(0.5 / 16.0), vec2(15.5 / 16.0)));
#else
    lightColor = vec4(1.0);
#endif
    vertexColor = Color;

    //objmc
    #define BLOCK
    #moj_import <objmc_main.glsl>

    gl_Position = ProjMat * ModelViewMat * vec4(Pos, 1.0);

    sphericalVertexDistance = fog_spherical_distance(Pos);
    cylindricalVertexDistance = fog_cylindrical_distance(Pos);
}
