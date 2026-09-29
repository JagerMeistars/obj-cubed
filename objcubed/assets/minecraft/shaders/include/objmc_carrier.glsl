// Carrier access for Minecraft 26.3's Vulkan -> SPIRV-Cross -> OpenGL path.
// Quad/shuffle instructions are not translated by the bundled SPIRV-Cross.
// Ballot broadcasts are translated to ARB_shader_ballot (or vendor equivalents).
// This still needs vertex-stage subgroup support and retains the legacy
// assumption that four consecutive lanes contain one complete carrier face.
#ifndef OBJMC_CARRIER_GLSL
#define OBJMC_CARRIER_GLSL

void oc_read_carrier(vec3 position, vec2 uv, out vec3 positions[4], out vec2 uvs[4]) {
    for (int i = 0; i < 4; ++i) { positions[i] = position; uvs[i] = uv; }
    uint ownBase = gl_SubgroupInvocationID & ~3u;
    // All broadcasts must execute BEFORE the per-quad selection. Source lanes
    // are compile-time constants: ARB readInvocation requires a uniform index,
    // and dynamic Vulkan broadcast IDs require an extra optional device feature.
#define OC_READ_GROUP(B) \
    if (gl_SubgroupSize >= (B) + 4u) { \
        vec3 p0 = subgroupBroadcast(position, (B) + 0u); \
        vec3 p1 = subgroupBroadcast(position, (B) + 1u); \
        vec3 p2 = subgroupBroadcast(position, (B) + 2u); \
        vec3 p3 = subgroupBroadcast(position, (B) + 3u); \
        vec2 t0 = subgroupBroadcast(uv, (B) + 0u); \
        vec2 t1 = subgroupBroadcast(uv, (B) + 1u); \
        vec2 t2 = subgroupBroadcast(uv, (B) + 2u); \
        vec2 t3 = subgroupBroadcast(uv, (B) + 3u); \
        if (ownBase == (B)) { \
            positions[0] = p0; positions[1] = p1; positions[2] = p2; positions[3] = p3; \
            uvs[0] = t0; uvs[1] = t1; uvs[2] = t2; uvs[3] = t3; \
        } \
    }
    OC_READ_GROUP(0u)
    OC_READ_GROUP(4u)
    OC_READ_GROUP(8u)
    OC_READ_GROUP(12u)
    OC_READ_GROUP(16u)
    OC_READ_GROUP(20u)
    OC_READ_GROUP(24u)
    OC_READ_GROUP(28u)
    OC_READ_GROUP(32u)
    OC_READ_GROUP(36u)
    OC_READ_GROUP(40u)
    OC_READ_GROUP(44u)
    OC_READ_GROUP(48u)
    OC_READ_GROUP(52u)
    OC_READ_GROUP(56u)
    OC_READ_GROUP(60u)
    OC_READ_GROUP(64u)
    OC_READ_GROUP(68u)
    OC_READ_GROUP(72u)
    OC_READ_GROUP(76u)
    OC_READ_GROUP(80u)
    OC_READ_GROUP(84u)
    OC_READ_GROUP(88u)
    OC_READ_GROUP(92u)
    OC_READ_GROUP(96u)
    OC_READ_GROUP(100u)
    OC_READ_GROUP(104u)
    OC_READ_GROUP(108u)
    OC_READ_GROUP(112u)
    OC_READ_GROUP(116u)
    OC_READ_GROUP(120u)
    OC_READ_GROUP(124u)
#undef OC_READ_GROUP
}
#endif
