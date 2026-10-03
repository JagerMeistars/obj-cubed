// Candidate for repeated, identical flat item carriers only. Armor and terrain
// retain their own decoder. Membership comes from the model's vertex-buffer
// base, sprite origin and instance, never from consecutive subgroup lanes.
#define OBJMC_CARRIER_EXPLICIT_CORNER
int oc_carrier_corner;

bool oc_read_mesh_carrier(vec3 position, vec2 uv, ivec2 origin, ivec2 offset,
                         int width, out vec3 points[4], out vec2 texels[4]) {
    int face = (offset.y - 2) * width + offset.x;
    vec2 atlas = vec2(textureSize(Sampler0, 0));
    // Arena bases need not be divisible by four. UV margins identify the
    // actual corner: left U <= .58, right U >= .70 for slot markers 0..8.
    vec2 margin = fract(uv * atlas);
    int corner = margin.x > 0.64 ? (margin.y > 0.5 ? 2 : 3)
                               : (margin.y > 0.5 ? 1 : 0);
    oc_carrier_corner = corner;
    ivec4 key = ivec4(OBJMC_VERTEX_ID - corner - face * 4, origin, OBJMC_INSTANCE_ID);
    uvec4 mask = subgroupBallot(true);
    uint found = 0u;
    for (int i = 0; i < 4; ++i) { points[i] = position; texels[i] = uv; }
    // Broadcast sources stay compile-time constants for 26.3's SPIRV-Cross.
    // Inactive sources may return undefined values; never consume those reads.
#define OC_MESH_READ(I) \
    if (gl_SubgroupSize > (I)) { \
        vec3 p = subgroupBroadcast(position, (I)); \
        vec2 t = subgroupBroadcast(uv, (I)); \
        ivec4 k = subgroupBroadcast(key, (I)); \
        int c = subgroupBroadcast(corner, (I)); \
        if ((mask[(I)/32u] & (1u << ((I)%32u))) != 0u && all(equal(k,key))) { \
            uint bit = 1u << uint(c); \
            if ((found & bit) == 0u) { \
                points[c] = p; \
                texels[c] = (vec2(origin + offset) + fract(t * atlas)) / atlas; \
                found |= bit; \
            } \
        } \
    }
#define OC_MESH_GROUP(B) OC_MESH_READ(B) OC_MESH_READ((B)+1u) OC_MESH_READ((B)+2u) OC_MESH_READ((B)+3u)
    OC_MESH_GROUP(0u)
    OC_MESH_GROUP(4u)
    OC_MESH_GROUP(8u)
    OC_MESH_GROUP(12u)
    OC_MESH_GROUP(16u)
    OC_MESH_GROUP(20u)
    OC_MESH_GROUP(24u)
    OC_MESH_GROUP(28u)
    OC_MESH_GROUP(32u)
    OC_MESH_GROUP(36u)
    OC_MESH_GROUP(40u)
    OC_MESH_GROUP(44u)
    OC_MESH_GROUP(48u)
    OC_MESH_GROUP(52u)
    OC_MESH_GROUP(56u)
    OC_MESH_GROUP(60u)
    OC_MESH_GROUP(64u)
    OC_MESH_GROUP(68u)
    OC_MESH_GROUP(72u)
    OC_MESH_GROUP(76u)
    OC_MESH_GROUP(80u)
    OC_MESH_GROUP(84u)
    OC_MESH_GROUP(88u)
    OC_MESH_GROUP(92u)
    OC_MESH_GROUP(96u)
    OC_MESH_GROUP(100u)
    OC_MESH_GROUP(104u)
    OC_MESH_GROUP(108u)
    OC_MESH_GROUP(112u)
    OC_MESH_GROUP(116u)
    OC_MESH_GROUP(120u)
    OC_MESH_GROUP(124u)
#undef OC_MESH_GROUP
#undef OC_MESH_READ
    // Three corners determine the fourth of an affine carrier rectangle.
    // ponytail: fewer than three distinct corners cannot recover its transform;
    // return failure instead of inventing coordinates. Full subgroup removal
    // requires a different carrier/export format.
    if (found == 7u || found == 11u || found == 13u || found == 14u) {
        int m = found == 7u ? 3 : found == 11u ? 2 : found == 13u ? 1 : 0;
        points[m] = points[(m+1)%4] + points[(m+3)%4] - points[(m+2)%4];
        texels[m] = texels[(m+1)%4] + texels[(m+3)%4] - texels[(m+2)%4];
        found = 15u;
    }
    return found == 15u;
}
