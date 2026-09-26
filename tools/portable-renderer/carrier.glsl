// Approximate subgroup-free carrier transfer. GLSL 330; six vec4 varyings,
// or nine with OC_PORTABLE_PRECISE. All payloads MUST be noperspective.
// The caller declares matching input/output payloads in BOTH shader stages.
// See carrier-test.c / README.md for measured errors and affine restrictions.
#ifndef OBJCUBED_PORTABLE_CARRIER_GLSL
#define OBJCUBED_PORTABLE_CARRIER_GLSL

#ifndef OC_PORTABLE_CELL_SIZE
#define OC_PORTABLE_CELL_SIZE 8.0
#endif

vec2 oc_portable_screen_corner(int vertexID) {
    int corner = vertexID & 3;
    return vec2((corner == 1 || corner == 2) ? 1.0 : 0.0,
                corner >= 2 ? 1.0 : 0.0);
}

#ifdef OC_PORTABLE_VERTEX
// Item UVs should be marker-local fractions; pass their integer atlas origin
// separately as a flat input. Armor UVs may use fixed-layout texel units.
void oc_portable_encode(int vertexID, vec3 position, vec2 localUV,
                        out vec4 p[4], out vec4 uv[2]) {
    int corner = vertexID & 3;
    for (int i = 0; i < 4; ++i)
        p[i] = i == corner ? vec4(position, 1.0) : vec4(0.0);
    uv[0] = vec4(corner == 0 ? localUV : vec2(0.0),
                 corner == 1 ? localUV : vec2(0.0));
    uv[1] = vec4(corner == 2 ? localUV : vec2(0.0),
                 corner == 3 ? localUV : vec2(0.0));
}

// Ordinary geometry can share the interface without becoming a carrier.
void oc_portable_clear(out vec4 p[4], out vec4 uv[2]) {
    for (int i = 0; i < 4; ++i) p[i] = vec4(0.0);
    uv[0] = vec4(0.0);
    uv[1] = vec4(0.0);
}

// Scalar-varying convenience overload for the generated Minecraft shaders.
void oc_portable_encode(int vertexID, vec3 position, vec2 localUV,
                        out vec4 p0, out vec4 p1, out vec4 p2, out vec4 p3,
                        out vec4 uv01, out vec4 uv23) {
    vec4 p[4], uv[2];
    oc_portable_encode(vertexID, position, localUV, p, uv);
    p0=p[0]; p1=p[1]; p2=p[2]; p3=p[3]; uv01=uv[0]; uv23=uv[1];
}

#ifdef OC_PORTABLE_PRECISE
// Optional 36-component payload: integer cell plus a small float residual.
// The four coarse vec3 values are tightly packed into three vec4 locations.
void oc_portable_encode(int vertexID, vec3 position, vec2 localUV,
                        out vec4 p0, out vec4 p1, out vec4 p2, out vec4 p3,
                        out vec4 uv01, out vec4 uv23,
                        out vec4 high01, out vec4 high12, out vec4 high23) {
    vec3 cell = floor(position / OC_PORTABLE_CELL_SIZE);
    vec3 residual = position - cell * OC_PORTABLE_CELL_SIZE;
    oc_portable_encode(vertexID,residual,localUV,p0,p1,p2,p3,uv01,uv23);
    int corner = vertexID & 3;
    vec3 h0=corner==0?cell:vec3(0.0), h1=corner==1?cell:vec3(0.0);
    vec3 h2=corner==2?cell:vec3(0.0), h3=corner==3?cell:vec3(0.0);
    high01=vec4(h0,h1.x);
    high12=vec4(h1.yz,h2.xy);
    high23=vec4(h2.z,h3);
}
#endif
#else
// Derivatives MUST execute before discard or divergent per-fragment branches.
// Returns false for ordinary all-zero payloads or invalid/degenerate transfer.
// A source quad must have consecutive cyclic IDs and be an affine rectangle.
// Its absent fourth corner follows from a parallelogram, not cross-vertex reads.
bool oc_portable_decode(vec4 p[4], vec4 uv[2],
                        out vec3 positions[4], out vec2 uvs[4]) {
    vec2 t[4] = vec2[4](uv[0].xy, uv[0].zw, uv[1].xy, uv[1].zw);
    vec4 dx[4], dy[4];
    vec2 tx[4], ty[4];
    // Uniform loop: no derivatives below a data-dependent branch.
    for (int i = 0; i < 4; ++i) {
        dx[i] = dFdx(p[i]);
        dy[i] = dFdy(p[i]);
        tx[i] = dFdx(t[i]);
        ty[i] = dFdy(t[i]);
    }
    int absent = -1, absentCount = 0;
    bool finite = true;
    for (int i = 0; i < 4; ++i) {
        if (abs(p[i].w) + abs(dx[i].w) + abs(dy[i].w) == 0.0) {
            absent = i;
            absentCount++;
            positions[i] = vec3(0.0);
            uvs[i] = vec2(0.0);
        } else {
            // Avoid dividing small interpolation weights near the triangle
            // diagonal. Derivative ratios supply the same constant payload.
            if (abs(p[i].w) > 0.00390625) {
                positions[i] = p[i].xyz / p[i].w;
                uvs[i] = t[i] / p[i].w;
            } else if (abs(dx[i].w) > abs(dy[i].w)) {
                positions[i] = dx[i].xyz / dx[i].w;
                uvs[i] = tx[i] / dx[i].w;
            } else {
                positions[i] = dy[i].xyz / dy[i].w;
                uvs[i] = ty[i] / dy[i].w;
            }
            finite = finite && !any(isnan(positions[i])) && !any(isinf(positions[i]))
                            && !any(isnan(uvs[i])) && !any(isinf(uvs[i]));
        }
    }
    if (absentCount != 1 || !finite) return false;
    int previous = (absent + 3) & 3;
    int next = (absent + 1) & 3;
    int opposite = (absent + 2) & 3;
    positions[absent] = positions[previous] + positions[next] - positions[opposite];
    uvs[absent] = uvs[previous] + uvs[next] - uvs[opposite];
    return !any(isnan(positions[absent])) && !any(isinf(positions[absent]))
        && !any(isnan(uvs[absent])) && !any(isinf(uvs[absent]));
}

bool oc_portable_decode(vec4 p0, vec4 p1, vec4 p2, vec4 p3,
                        vec4 uv01, vec4 uv23,
                        out vec3 positions[4], out vec2 uvs[4]) {
    vec4 p[4]=vec4[4](p0,p1,p2,p3), uv[2]=vec4[2](uv01,uv23);
    return oc_portable_decode(p,uv,positions,uvs);
}

#ifdef OC_PORTABLE_PRECISE
bool oc_portable_decode(vec4 p0, vec4 p1, vec4 p2, vec4 p3,
                        vec4 uv01, vec4 uv23,
                        vec4 high01, vec4 high12, vec4 high23,
                        out vec3 positions[4], out vec2 uvs[4]) {
    vec4 p[4]=vec4[4](p0,p1,p2,p3), uv[2]=vec4[2](uv01,uv23);
    bool valid=oc_portable_decode(p,uv,positions,uvs);
    vec3 h[4]=vec3[4](high01.xyz,vec3(high01.w,high12.xy),
                      vec3(high12.zw,high23.x),high23.yzw);
    vec3 hx[4],hy[4];
    vec2 wd[4];
    for(int i=0;i<4;++i) {
        hx[i]=dFdx(h[i]); hy[i]=dFdy(h[i]);
        wd[i]=vec2(dFdx(p[i].w),dFdy(p[i].w));
    }
    if(!valid) return false;
    int absent=-1;
    for(int i=0;i<4;++i) {
        if(abs(p[i].w)+abs(wd[i].x)+abs(wd[i].y)==0.0) {
            absent=i;
        } else {
            vec3 cell;
            if(abs(p[i].w)>0.00390625) cell=h[i]/p[i].w;
            else if(abs(wd[i].x)>abs(wd[i].y)) cell=hx[i]/wd[i].x;
            else cell=hy[i]/wd[i].y;
            if(any(isnan(cell))||any(isinf(cell))) return false;
            positions[i]+=round(cell)*OC_PORTABLE_CELL_SIZE;
        }
    }
    // Cell/residual partitions are not affine across a cell boundary. Infer
    // the absent FULL position only after combining the other three corners.
    int previous=(absent+3)&3, next=(absent+1)&3, opposite=(absent+2)&3;
    positions[absent]=positions[previous]+positions[next]-positions[opposite];
    return !any(isnan(positions[absent]))&&!any(isinf(positions[absent]));
}
#endif
#endif
#endif
