#ifndef MINECRAFT_OIT_DEPTH_SAMPLE_GLSL
#define MINECRAFT_OIT_DEPTH_SAMPLE_GLSL

#include <minecraft:objmc_skin_config.glsl>

uniform sampler2D DepthBoundsSampler;

const float OIT_HIGH_PRECISION_DEPTH_THRESHOLD = 10.0;
const int OIT_LOW_PRECISION_DEPTH_BINS = 2;

float normalizeDepth(float fragmentDeviceDepth) {
    vec4 depthBoundsSample = texelFetch(DepthBoundsSampler, ivec2(gl_FragCoord.xy), 0);
#if OC_PLAYER_SKINS
    // Donor pixels share depth-bound storage, but ordinary translucent geometry
    // at those pixels still uses the real furthest depth (G), with a conservative
    // zero near bound. Both transmittance and accumulation use this same range.
    if(depthBoundsSample.r>=1.0 && depthBoundsSample.b>=2.0 && depthBoundsSample.a>=2.0)
        depthBoundsSample=vec4(0.0,depthBoundsSample.g,0.0,0.0);
#endif
    float closestBoundLinearDepthNegated = depthBoundsSample.r;
    float closestBoundLinearDepth = -closestBoundLinearDepthNegated;
    float furthestBoundLinearDepth = depthBoundsSample.g;

    float fragmentLinearDepth = deviceToLinearDepth(fragmentDeviceDepth);
    float range = max(furthestBoundLinearDepth - closestBoundLinearDepth, 0.0001);
    float depthWithinBounds = clamp(fragmentLinearDepth - closestBoundLinearDepth, 0.0, range);

    const float depthFractionWithHighPrecision = float(OIT_NUMBER_OF_DEPTH_BINS - OIT_LOW_PRECISION_DEPTH_BINS) / float(OIT_NUMBER_OF_DEPTH_BINS);
    float depthWithHighPrecision = depthFractionWithHighPrecision * range;

    if (depthWithHighPrecision <= OIT_HIGH_PRECISION_DEPTH_THRESHOLD) {
        return depthWithinBounds / range;
    } else if (depthWithinBounds <= OIT_HIGH_PRECISION_DEPTH_THRESHOLD) {
        return (depthWithinBounds / OIT_HIGH_PRECISION_DEPTH_THRESHOLD) * depthFractionWithHighPrecision;
    } else {
        return depthFractionWithHighPrecision + ((depthWithinBounds - OIT_HIGH_PRECISION_DEPTH_THRESHOLD) / (range - OIT_HIGH_PRECISION_DEPTH_THRESHOLD)) * (1.0 - depthFractionWithHighPrecision);
    }
}

#endif
