// Research prototype only: transfer a vanilla affine quad to a fragment shader
// without subgroup/ballot/shuffle extensions. See README.md for tested precision,
// cost, and the substantial renderer work this helper does NOT implement.
// All 48 payload components MUST be noperspective in both stages.
#ifndef OBJCUBED_CARRIER_GLSL
#define OBJCUBED_CARRIER_GLSL

// Consecutive source vertices remain cyclically ordered for every base-vertex
// offset. The decoder returns these virtual corner slots; callers must recover
// semantic item/armor corner roles from UVs rather than assume an arena offset.
vec2 oc_carrier_screen_corner(int vertexID) {
    int corner = vertexID & 3;
    return vec2((corner == 1 || corner == 2) ? 1.0 : 0.0,
                corner >= 2 ? 1.0 : 0.0);
}

#ifdef OC_CARRIER_VERTEX
// Pass UVs relative to the marker texel for items, or in the fixed armor layout
// for armor. Absolute atlas UVs lose the precision needed for narrow markers.
// Each source corner owns sparse interpolation channels; other corners write 0.
// Float bits are split 12/10/10: critical exponent/sign/high-mantissa words stay
// small, so interpolation rounding affects at most low mantissa bits in tested
// cases. Plain float or two 16-bit payloads failed the AMD numerical tests.
void oc_carrier_encode(int vertexID, vec3 position, vec2 uv,
                       out vec4 p0, out vec4 p1, out vec4 p2, out vec4 p3,
                       out vec3 h0, out vec3 h1, out vec3 h2, out vec3 h3,
                       out vec3 m0, out vec3 m1, out vec3 m2, out vec3 m3,
                       out vec4 uv01, out vec4 uv23) {
    int corner = vertexID & 3;
    uvec3 bits = floatBitsToUint(position);
    vec4 p = vec4(vec3(bits & 4095u), 1.0);
    vec3 h = vec3(bits >> 22u);
    vec3 m = vec3((bits >> 12u) & 1023u);
    p0 = corner == 0 ? p : vec4(0.0);
    p1 = corner == 1 ? p : vec4(0.0);
    p2 = corner == 2 ? p : vec4(0.0);
    p3 = corner == 3 ? p : vec4(0.0);
    h0 = corner == 0 ? h : vec3(0.0);
    h1 = corner == 1 ? h : vec3(0.0);
    h2 = corner == 2 ? h : vec3(0.0);
    h3 = corner == 3 ? h : vec3(0.0);
    m0 = corner == 0 ? m : vec3(0.0);
    m1 = corner == 1 ? m : vec3(0.0);
    m2 = corner == 2 ? m : vec3(0.0);
    m3 = corner == 3 ? m : vec3(0.0);
    uv01 = vec4(corner == 0 ? uv : vec2(0.0), corner == 1 ? uv : vec2(0.0));
    uv23 = vec4(corner == 2 ? uv : vec2(0.0), corner == 3 ? uv : vec2(0.0));
}
#else
struct OcCarrier {
    vec3 position[4];
    vec2 uv[4];
};

// Call before discard and before divergent per-fragment control flow.
// A zero weight on the triangle diagonal still has nonzero derivatives. Use
// those to reconstruct that corner; only the absent fourth channel is zero
// throughout the primitive. Fragment helper invocations supply edge derivatives.
OcCarrier oc_carrier_decode(vec4 p0, vec4 p1, vec4 p2, vec4 p3,
                            vec3 h0, vec3 h1, vec3 h2, vec3 h3,
                            vec3 m0, vec3 m1, vec3 m2, vec3 m3,
                            vec4 uv01, vec4 uv23) {
    vec4 p[4] = vec4[4](p0, p1, p2, p3);
    vec3 h[4] = vec3[4](h0, h1, h2, h3);
    vec3 m[4] = vec3[4](m0, m1, m2, m3);
    vec2 uv[4] = vec2[4](uv01.xy, uv01.zw, uv23.xy, uv23.zw);
    OcCarrier carrier;
    int missing = -1;
    for (int i = 0; i < 4; ++i) {
        vec4 dx = dFdx(p[i]);
        vec4 dy = dFdy(p[i]);
        vec3 hx = dFdx(h[i]);
        vec3 hy = dFdy(h[i]);
        vec3 mx = dFdx(m[i]);
        vec3 my = dFdy(m[i]);
        vec2 tx = dFdx(uv[i]);
        vec2 ty = dFdy(uv[i]);
        vec3 low = vec3(0.0), high = vec3(0.0), mid = vec3(0.0);
        if (abs(p[i].w) + abs(dx.w) + abs(dy.w) == 0.0) {
            missing = i;
            carrier.position[i] = vec3(0.0);
            carrier.uv[i] = vec2(0.0);
        } else {
            if (abs(p[i].w) > 0.00390625) {
                low = p[i].xyz / p[i].w;
                high = h[i] / p[i].w;
                mid = m[i] / p[i].w;
                carrier.uv[i] = uv[i] / p[i].w;
            } else if (abs(dx.w) > abs(dy.w)) {
                low = dx.xyz / dx.w;
                high = hx / dx.w;
                mid = mx / dx.w;
                carrier.uv[i] = tx / dx.w;
            } else {
                low = dy.xyz / dy.w;
                high = hy / dy.w;
                mid = my / dy.w;
                carrier.uv[i] = ty / dy.w;
            }
            // Addition propagates a rounded low-word carry into the next
            // mantissa bit; OR would incorrectly drop that carry.
            carrier.position[i] = uintBitsToFloat((uvec3(round(high)) << 22u)
                                               + (uvec3(round(mid)) << 12u)
                                               + uvec3(round(low)));
        }
    }
    // Vanilla rectangular item/block/armor carriers remain parallelograms under
    // an affine pose transform. Infer the fourth corner from the other three.
    // CPU float rounding means this may differ from the submitted fourth corner
    // by a few ULPs. This helper does not support non-affine, deformed carriers.
    if (missing >= 0) {
        int previous = (missing + 3) & 3;
        int next = (missing + 1) & 3;
        int opposite = (missing + 2) & 3;
        carrier.position[missing] = carrier.position[previous]
                                  + carrier.position[next] - carrier.position[opposite];
        carrier.uv[missing] = carrier.uv[previous]
                            + carrier.uv[next] - carrier.uv[opposite];
    }
    return carrier;
}
#endif
#endif
