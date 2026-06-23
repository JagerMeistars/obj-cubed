#version 330 core
// Reference passthrough: a vanilla baked cube fed through the SAME camera the obj3
// shader uses (entity.vert.glsl:873 gl_Position = ProjMat * ModelViewMat * vec4(Pos,1)).
// Position is the display-baked reference vertex in block units.
layout(std140) uniform DynamicTransforms {
    mat4 ModelViewMat;
    vec4 ColorModulator;
    vec3 ModelOffset;
    mat4 TextureMat;
};
layout(std140) uniform Projection {
    mat4 ProjMat;
};
in vec3 Position;
void main() {
    gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);
}
