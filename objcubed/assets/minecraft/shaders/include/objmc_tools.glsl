//objmc
//https://github.com/Godlander/objmc

// Minecraft 26.3 compiles every backend with Vulkan semantics before
// translating SPIR-V back to GLSL for OpenGL.
#ifdef VULKAN
#define OBJMC_VERTEX_ID gl_VertexIndex
#else
#define OBJMC_VERTEX_ID gl_VertexID
#endif

#include <minecraft:objmc_carrier.glsl>

#define PI 3.1415926535897932

ivec4 getmeta(ivec2 topleft, int offset) {
    return ivec4(texelFetch(Sampler0, topleft + ivec2(offset,0), 0) * 255.0 + 0.5);
}
int oc_model_flags(ivec2 origin) {
    int version = int(texelFetch(Sampler0, origin + ivec2(5,1), 0).b * 255.0 + 0.5);
    return version == 2 || version == 3 ? int(texelFetch(Sampler0, origin + ivec2(0,1), 0).b * 255.0 + 0.5) : 0;
}
int oc_lighting_mode(int flags, bool glow) {
    return glow ? 1 : ((flags & 32) != 0 ? 2 : 0);
}
int oc_loop_frame_count(int flags, int frames) {
    return frames > 1 && (flags & 4) != 0 ? frames - 1 : frames;
}
// A linked controller carries the texture override and geometry clock in one vanilla tint.
float oc_playback_tick(vec3 color, float time, float duration, out int held, out bool end) {
    ivec3 bytes = ivec3(color * 255.0 + 0.5);
    held = bytes.r - 1;
    end = false;
    if (all(equal(bytes, ivec3(255)))) { held = -1; return 0.0; }
    int word = bytes.g * 256 + bytes.b;
    if (word < 24000) return mod(time + duration - float(word), duration);
    float tick = word < 48000 ? mod(time - float(word - 24000), 24000.0) : float(word - 48000);
    end = tick >= duration - 1.0;
    return min(tick, duration - 1.0);
}
vec3 getpos(ivec2 topleft, int w, int h, int index) {
    int i = index*3;
    ivec3 x = ivec3(texelFetch(Sampler0, topleft + ivec2((i  )%w,h+((i  )/w)), 0).rgb * 255.0 + 0.5);
    ivec3 y = ivec3(texelFetch(Sampler0, topleft + ivec2((i+1)%w,h+((i+1)/w)), 0).rgb * 255.0 + 0.5);
    ivec3 z = ivec3(texelFetch(Sampler0, topleft + ivec2((i+2)%w,h+((i+2)/w)), 0).rgb * 255.0 + 0.5);
    // Restore integer bytes before decoding the coordinate's 16 fractional bits.
    // Every RGB24 value is exactly representable by a float; division by
    // 65536 is exact and avoids accumulating normalized-channel rounding.
    return vec3(
        x.r*65536 + x.g*256 + x.b - 8388608,
        y.r*65536 + y.g*256 + y.b - 8388608,
        z.r*65536 + z.g*256 + z.b - 8388608
    ) / 65536.0;
}
vec2 oc_read_uv(ivec2 topleft, int w, int h, int index, out vec2 normalBytes) {
    int i = index*2;
    vec4 x = texelFetch(Sampler0, topleft + ivec2((i  )%w,h+((i  )/w)), 0);
    vec4 y = texelFetch(Sampler0, topleft + ivec2((i+1)%w,h+((i+1)/w)), 0);
    normalBytes = round(vec2(x.r, y.r) * 255.0);
    return vec2(
        ((x.g*65280)+(x.b*255))/65535,
        ((y.g*65280)+(y.b*255))/65535
    );
}
vec2 getuv(ivec2 topleft, int w, int h, int index) {
    vec2 unused;
    return oc_read_uv(topleft, w, h, index, unused);
}
vec3 oc_unpack_normal(vec2 bytes) {
    int x = int(bytes.x) >> 1;
    if (x == 0) return vec3(0.0);
    vec2 xy = vec2(float(x - 1) / 126.0, bytes.y / 254.0) * 2.0 - 1.0;
    vec3 n = vec3(xy, 1.0 - abs(xy.x) - abs(xy.y));
    if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * mix(vec2(-1.0), vec2(1.0), greaterThanEqual(xy, vec2(0.0)));
    return normalize(n);
}
vec3 oc_normal_transform(mat3 basis, vec3 n) {
    if (all(equal(n, vec3(0.0)))) return n;
    // The cofactor matrix is the inverse transpose up to a signed scalar.
    mat3 cofactor = mat3(cross(basis[1],basis[2]), cross(basis[2],basis[0]), cross(basis[0],basis[1]));
    float det = dot(basis[0], cofactor[0]);
    if (!(abs(det) > 1e-24)) return vec3(0.0);
    return normalize((cofactor * n) * sign(det));
}
vec3 oc_scale_normal(vec3 n, vec3 s) {
    if (all(equal(n,vec3(0.0))) || any(equal(s,vec3(0.0)))) return vec3(0.0);
    return normalize(n / s);
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

// All four vertices already reference the same encoded face. Read its opposite
// UV corners from the texture rather than exchanging decoded per-vertex UVs.
float oc_face_v_mid(ivec2 origin, int width, int vertexRows, int uvRows, int vertexID) {
    int first = vertexID - vertexID % 4;
    int uv0 = getvert(origin, width, vertexRows, first).y;
    int uv2 = getvert(origin, width, vertexRows, first + 2).y;
    return (getuv(origin, width, uvRows, uv0).y + getuv(origin, width, uvRows, uv2).y) * 0.5;
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

// easing t'=ease(mode,t), per-animation index from header t[4].a.
// 0 step/hold, 1 linear, 2 ease-in-out-cubic, 3 catmull-rom (4pt, handled by
// the caller), 4 ease-in-quad, 5 ease-out-quad. Unknown -> hold.
float ease(int m, float t) {
    if (m == 1) return t;
    if (m == 2) return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0)*0.5;
    if (m == 4) return t*t;
    if (m == 5) return 1.0 - (1.0-t)*(1.0-t);
    return 0.0;
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
vec2 oc_surface_uv(ivec2 origin, int flags, int width, int row, int index, int nextIndex, int easing,
                   float blend, out vec3 normal) {
    vec2 bytes;
    vec2 uv = oc_read_uv(origin, width, row, index, bytes);
    normal = vec3(0.0);
    if (bytes.x < 2.0 || (flags & 8) == 0) return uv;
    normal = oc_unpack_normal(bytes);
    if (nextIndex >= 0 && nextIndex != index && easing != 0) {
        oc_read_uv(origin, width, row, nextIndex, bytes);
        vec3 next = oc_unpack_normal(bytes);
        if (any(notEqual(next,vec3(0.0)))) {
            vec3 n = mix(normal, next, easing == 3 ? blend : ease(easing, blend));
            if (dot(n,n) > 1e-10) normal = normalize(n);
        }
    }
    return uv;
}
