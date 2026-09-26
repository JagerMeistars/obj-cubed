#ifndef OBJMC_FRAGMENT_DEPTH_GLSL
#define OBJMC_FRAGMENT_DEPTH_GLSL

// Private variables have one independent value per fragment invocation.
bool oc_has_fragment_depth = false;
float oc_hit_fragment_depth = 0.0;

float oc_resolve_fragment_device_depth(float originalDepth) {
    return oc_has_fragment_depth ? oc_hit_fragment_depth : originalDepth;
}

float oc_fragment_device_depth() {
    return oc_resolve_fragment_device_depth(gl_FragCoord.z);
}

// Call first in main, including the vanilla path. A shader which statically
// writes gl_FragDepth must define it on every non-discarded execution path.
void oc_init_fragment_depth() {
    oc_has_fragment_depth = false;
    gl_FragDepth = gl_FragCoord.z;
}

// The caller has already rejected clipped/missing intersections. Keep the
// reconstructed surface depth through every OIT phase and invariance write.
void oc_set_fragment_depth(float deviceDepth) {
    oc_hit_fragment_depth = deviceDepth;
    oc_has_fragment_depth = true;
    gl_FragDepth = deviceDepth;
}

// Feed the actual surface's clip position, never the full-screen proxy's.
// Both conventions use reversed Z; the viewport conversion is still identical.
bool oc_project_fragment_depth(vec4 clipPosition, out float deviceDepth) {
    if (clipPosition.w <= 0.0 || any(isnan(clipPosition)) || any(isinf(clipPosition))) {
        deviceDepth = 0.0;
        return false;
    }
    deviceDepth = clipPosition.z / clipPosition.w;
#ifndef RENDERPEARL_DEPTH_IS_ZERO_TO_ONE
    deviceDepth = deviceDepth * 0.5 + 0.5;
#endif
    return !isnan(deviceDepth) && !isinf(deviceDepth)
        && deviceDepth >= 0.0 && deviceDepth <= 1.0;
}

#endif
