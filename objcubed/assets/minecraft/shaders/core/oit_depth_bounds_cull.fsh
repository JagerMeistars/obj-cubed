#version 330
#extension GL_ARB_separate_shader_objects : require

#include <minecraft:objmc_skin_config.glsl>
#include <minecraft:oit_common.glsl>

uniform sampler2D DepthBoundsSampler;

layout(location = 0) in vec2 texCoord;

layout(location = 0) out vec4 fragColor;

void main() {
    ivec2 pixelCoords = ivec2(gl_FragCoord.xy);
    vec4 depthBounds = texelFetch(DepthBoundsSampler, pixelCoords, 0);

#if OC_PLAYER_SKINS
    if(depthBounds.r>=1.0 && depthBounds.b>=2.0 && depthBounds.a>=2.0){
        fragColor=depthBounds;gl_FragDepth=0.0;return;
    }
#endif
    float closestBoundLinearDepthNegated = depthBounds.r;
    float furthestBoundLinearDepth = depthBounds.g;
    float closestBoundDeviceDepth = depthBounds.b;
    float opaqueOitDeviceDepth = depthBounds.a;

    float opaqueOitLinearDepth = deviceToLinearDepth(opaqueOitDeviceDepth);

    fragColor = vec4(closestBoundLinearDepthNegated, min(furthestBoundLinearDepth, opaqueOitLinearDepth), closestBoundDeviceDepth, opaqueOitDeviceDepth);
    gl_FragDepth = opaqueOitDeviceDepth;
}
