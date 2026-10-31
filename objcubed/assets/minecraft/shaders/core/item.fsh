#version 330
#extension GL_ARB_separate_shader_objects : require

#include <minecraft:objmc_skin_config.glsl>
#include <minecraft:fog.glsl>
#include <minecraft:light.glsl>
#include <minecraft:dynamictransforms.glsl>
#include <minecraft:globals.glsl>
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

layout(location = 16) flat in int ocSkin;
void main() {
#if OC_PLAYER_SKINS && !defined(OIT_DEPTH_BOUNDS) && !defined(OIT_TRANSMITTANCE) && !defined(OIT_ACCUMULATE)
    if(ocSkin==1 && (gl_FragCoord.y<ceil(16384.0/ScreenSize.x) || gl_FragCoord.y>=ScreenSize.y-ceil(16384.0/ScreenSize.x))) discard;
#endif
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


#if OC_PLAYER_SKINS
    int profileSlot=(int(round(color.b*255.0))+3)&255;
    if(isCustom==1 && ocSkin==1 && profileSlot<8 && color.r<64.0/255.0 && color.g<64.0/255.0) {
#if defined(OIT_TRANSMITTANCE) || defined(OIT_ACCUMULATE)
        ivec2 size=textureSize(DepthBoundsSampler,0);
        ivec2 skinUV=ivec2(round(color.rg*255.0));
        int index=(profileSlot%4)*4096+skinUV.y*64+skinUV.x;
        int origin=profileSlot<4?0:size.y-(16384+size.x-1)/size.x;
        vec4 packet=texelFetch(DepthBoundsSampler,ivec2(index%size.x,origin+index/size.x),0);
        if(packet.r<1.0 || packet.b<2.0 || packet.a<2.0) discard;
        uint rgb=uint(round(packet.r))-1u;
        color=vec4(float(rgb&255u),float((rgb>>8u)&255u),float((rgb>>16u)&255u),round(packet.b)-2.0)/255.0;
        if(color.a<0.01) discard;
#elif defined(OIT_DEPTH_BOUNDS)
        color=vec4(1.0,1.0,1.0,0.5);
#else
        // The vanilla first-person pass has no DepthBoundsSampler. Keep its
        // original UV transport; this fallback remains opaque and unlit.
        fragColor=vec4(color.rg,float(240+profileSlot)/255.0,1.0);
        return;
#endif
    }
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
