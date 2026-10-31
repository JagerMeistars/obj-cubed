#version 330
#extension GL_ARB_separate_shader_objects : require

#include <minecraft:objmc_skin_config.glsl>
#include <minecraft:fog.glsl>
#if defined(PER_FACE_LIGHTING) || !defined(NO_CARDINAL_LIGHTING)
#include <minecraft:light.glsl>
#endif
#include <minecraft:dynamictransforms.glsl>
#include <minecraft:globals.glsl>
#include <minecraft:oit.glsl>

uniform sampler2D Sampler0;
#ifdef DISSOLVE
uniform sampler2D DissolveMaskSampler;
#endif
#ifdef GLINT
uniform sampler2D GlintSampler;
#endif

layout(location = 0) in float sphericalVertexDistance;
layout(location = 1) in float cylindricalVertexDistance;
#ifdef PER_FACE_LIGHTING
layout(location = 2) in vec4 vertexPerFaceColorBack;
layout(location = 3) in vec4 vertexPerFaceColorFront;
#else
layout(location = 2) in vec4 vertexColor;
#endif
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

layout(location = 16) flat in int skinDonor;
void main() {
#if OC_PLAYER_SKINS
    if(skinDonor >= 0) {
        int width=int(ScreenSize.x), bandRows=(16384+width-1)/width;
        int origin=skinDonor<4 ? 0 : int(ScreenSize.y)-bandRows;
        ivec2 p=ivec2(gl_FragCoord.xy)-ivec2(0,origin);
        int index=p.y*width+p.x-(skinDonor%4)*4096;
        if(index<0 || index>=4096) discard;
        vec4 skin=texelFetch(Sampler0,ivec2(index%64,index/64),0);
#ifdef OIT_DEPTH_BOUNDS
        // RGBA32F + MAX blending: positive packed RGB wins over normal
        // negative linear depths. B stores alpha above the device-depth range.
        // G is deliberately unused: ordinary far depths cannot corrupt RGB.
        uvec4 bytes=uvec4(round(skin*255.0));
        fragColor=vec4(float(bytes.r | (bytes.g<<8u) | (bytes.b<<16u))+1.0,
                       0.0,float(bytes.a)+2.0,2.0);
#elif !defined(OIT_TRANSMITTANCE) && !defined(OIT_ACCUMULATE)
        // First-person items bypass the native OIT stages. Preserve the
        // established screen transport for that path until a full replacement
        // can preserve both its background and material lighting.
        fragColor=vec4(skin.rgb,1.0);
#else
        discard;
#endif
        return;
    }
#endif

    // Evaluate before alpha discard and divergent branches: live helper lanes
    // are required for defined geometric derivatives on tiny triangles.
    vec3 objmcPosDx = dFdx(Pos);
    vec3 objmcPosDy = dFdy(Pos);
    // Debug probes still participate in all OIT passes.
    vec4 color = isCustom == 2 ? vec4(overlayColor.rgb, 1.0)
        : transition > 0.0 ? mix(texture(Sampler0, texCoord), texture(Sampler0, texCoord2), transition)
        : texture(Sampler0, texCoord);
    // Native profile geometry may use a translucent pipeline without a cutout
    // macro. Empty outer-layer pixels must not occlude the underlying skin.
    // Keep the same two-sided surface visibility as ordinary OBJ faces.
    if (skinDonor == -2 && color.a < 1.0 / 255.0) discard;
#ifdef OIT_ADDITIVE
    color.a = min(0.99, color.a);
#endif
#ifdef ALPHA_CUTOUT
    if (color.a < ALPHA_CUTOUT) discard;
#endif

    if (isCustom == 0) {
#ifdef PER_FACE_LIGHTING
        vec4 faceVertexColor = gl_FrontFacing ? vertexPerFaceColorFront : vertexPerFaceColorBack;
#else
        vec4 faceVertexColor = vertexColor;
#endif
#ifdef DISSOLVE
        if (faceVertexColor.a < texture(DissolveMaskSampler, texCoord).a) discard;
        faceVertexColor.a = 1.0;
#endif
        color *= faceVertexColor * ColorModulator;
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
