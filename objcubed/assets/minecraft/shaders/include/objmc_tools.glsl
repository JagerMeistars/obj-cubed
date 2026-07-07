//objmc
//https://github.com/Godlander/objmc

#define PI 3.1415926535897932

ivec4 getmeta(ivec2 topleft, int offset) {
    return ivec4(texelFetch(Sampler0, topleft + ivec2(offset,0), 0) * 255.0 + 0.5);
}
vec3 getpos(ivec2 topleft, int w, int h, int index) {
    int i = index*3;
    vec4 x = texelFetch(Sampler0, topleft + ivec2((i  )%w,h+((i  )/w)), 0);
    vec4 y = texelFetch(Sampler0, topleft + ivec2((i+1)%w,h+((i+1)/w)), 0);
    vec4 z = texelFetch(Sampler0, topleft + ivec2((i+2)%w,h+((i+2)/w)), 0);
    return vec3(
        (x.r*256)+(x.g)+(x.b/256),
        (y.r*256)+(y.g)+(y.b/256),
        (z.r*256)+(z.g)+(z.b/256)
    )*(255./256.) - vec3(128);
}
vec2 getuv(ivec2 topleft, int w, int h, int index) {
    int i = index*2;
    vec4 x = texelFetch(Sampler0, topleft + ivec2((i  )%w,h+((i  )/w)), 0);
    vec4 y = texelFetch(Sampler0, topleft + ivec2((i+1)%w,h+((i+1)/w)), 0);
    return vec2(
        ((x.g*65280)+(x.b*255))/65535,
        ((y.g*65280)+(y.b*255))/65535
    );
}
ivec2 getvert(ivec2 topleft, int w, int h, int index) {
    int i = index*2;
    ivec4 a = ivec4(texelFetch(Sampler0, topleft + ivec2((i  )%w,h+((i  )/w)), 0)*255.0+0.5);
    ivec4 b = ivec4(texelFetch(Sampler0, topleft + ivec2((i+1)%w,h+((i+1)/w)), 0)*255.0+0.5);
    return ivec2(
        ((a.r*65536)+(a.g*256)+a.b),
        ((b.r*65536)+(b.g*256)+b.b)
    );
}

bool getb(int i, int b) {
    return bool((i>>b)&1);
}
int getb(int i, int b, int s) {
    return (i>>b)&((1<<s)-1);
}

//gui item model detection from Onnowhere
bool isgui(mat4 ProjMat) {
    return ProjMat[2][3] == 0.0;
}
//first person hand item model detection (Bálint nonsense)
bool ishand(mat4 ProjMat) {
    return abs(ProjMat[3][2] + 0.10005) < 0.00001;
}

//hue to rgb
vec3 hrgb(float h) {
    vec3 K = vec3(1.0, 2.0 / 3.0, 1.0 / 3.0);
    vec3 p = abs(fract(K.xyz + h) * 6.0 - 3.0);
    return clamp(p - K.xxx, 0.0, 1.0);
}

//4 point bezier formula from Dominexis
vec3 bezb(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
    float t2 = t * t;
    float t3 = t2 * t;
    return (d-3*c+3*b-a)*t3 + (3*c-6*b+3*a)*t2 + (3*b-3*a)*t + a;
}
vec3 bezier(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
    return bezb(b,b+(c-a)/6,c-(d-b)/6,c,t);
}

// ── Armor UV decode (MC 26.2+) ──────────────────────────────────────────────
// On 26.2 entity geometry lives in shared vertex arenas with per-frame base
// offsets, so gl_VertexID-derived indices are garbage. The humanoid armor
// layer UV LAYOUT (64x32 grid, fixed since alpha) identifies everything
// instead: which box a face belongs to, and which face of the box it is.
// Returns ivec2(partKind, f6):
//   partKind: 0 head, 1 body, 2 arm, 3 leg, -1 not recognized
//   f6 (matches the vertexID-order decode): 0 down, 1 up, 2 west, 3 north,
//   4 east, 5 south. Left limbs share the right limb's rects (legacy layout);
//   the SIDE is recovered separately from the quad winding.
// m = face UV midpoint in layout units (UV0 * vec2(64, 32)).
ivec2 oc_armor_uvface(vec2 m) {
    // box uv origins + dims (w, h, d): head(0,0,8,8,8) body(16,16,8,12,4)
    // arm(40,16,4,12,4) leg(0,16,4,12,4)
    for (int i = 0; i < 4; i++) {
        vec2 o  = (i == 0) ? vec2( 0.0,  0.0) : (i == 1) ? vec2(16.0, 16.0)
                : (i == 2) ? vec2(40.0, 16.0) : vec2( 0.0, 16.0);
        vec3 wh = (i == 0) ? vec3(8.0, 8.0, 8.0) : (i == 1) ? vec3(8.0, 12.0, 4.0)
                : vec3(4.0, 12.0, 4.0);
        float w = wh.x, h = wh.y, d = wh.z;
        vec2 r = m - o;
        if (r.x < 0.0 || r.y < 0.0 || r.x >= 2.0*(w + d) || r.y >= d + h) continue;
        int f6;
        if (r.y < d) {
            // top strip: up/down caps (culled by the armor path anyway)
            if (r.x < d || r.x >= d + 2.0*w) continue;
            f6 = (r.x < d + w) ? 1 : 0;
        } else {
            // side strip: west | north | east | south (calibration order)
            f6 = (r.x < d) ? 2 : (r.x < d + w) ? 3 : (r.x < d + w + d) ? 4 : 5;
        }
        return ivec2(i, f6);
    }
    return ivec2(-1, -1);
}
