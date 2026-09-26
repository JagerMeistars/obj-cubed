vec3 oc_carrier_positions[4];
vec2 oc_carrier_uvs[4];
int oc_virtual_id;
bool oc_basis_mode=false;
int oc_animation_frame,oc_animation_easing,oc_animation_frames;
float oc_animation_mix;
vec2 oc_source_uvs[4];
vec4 oc_control_color;
vec3 oc_source_normal;
#include <minecraft:objmc_tools.glsl>

struct OcDecodedVertex {
    vec3 position;
    vec2 uv;
    vec2 uv2;
    float blend;
    vec4 overlay;
    int custom;
    int gui;
    int hand;
    int shadow;
};
OcDecodedVertex oc_decode_vertex(int vertexID) {
    oc_virtual_id=vertexID;
    Pos=oc_carrier_positions[vertexID];
    vec2 UV0=oc_source_uvs[vertexID];
    vec4 Color=oc_control_color;
    vec3 Normal=oc_source_normal;
    texCoord=UV0;
    texCoord2=UV0;
    transition=0.0;
    isCustom=0;
    noshadow=0;
#ifdef ENTITY
    isGUI=0;
    isHand=0;
    overlayColor=vec4(1.0);
#endif
    #include <minecraft:objmc_main.glsl>
    OcDecodedVertex result;
    result.position=Pos;
    result.uv=texCoord;
    result.uv2=texCoord2;
    result.blend=transition;
    result.custom=isCustom;
    result.shadow=noshadow;
    result.gui=0;
    result.hand=0;
    result.overlay=vec4(1.0);
#ifdef ENTITY
    result.gui=isGUI;
    result.hand=isHand;
    result.overlay=overlayColor;
#endif
    return result;
}
