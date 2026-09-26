// Optional Minecraft 26.3 OPENGL-ONLY carrier. Do not use with Vulkan.
// Uses legacy SPV_KHR_shader_ballot so bundled SPIRV-Cross emits correct ARB
// extension names. Vanilla's Vulkan device does NOT enable its required features.
#ifndef OBJMC_CARRIER_GLSL
#define OBJMC_CARRIER_GLSL

void oc_read_carrier(vec3 position, vec2 uv, out vec3 positions[4], out vec2 uvs[4]) {
    positions[0] = position; positions[1] = position;
    positions[2] = position; positions[3] = position;
    uvs[0] = uv; uvs[1] = uv; uvs[2] = uv; uvs[3] = uv;
    uint64_t activeMask = ballotARB(true);
    uint ownLane = 0u;
    // Recover the invocation lane without subgroup built-ins: their SPIRV-Cross
    // emulation has the same incorrect extension guard as the modern ballot path.
    // Compare actual vertex IDs; dividing a vertex ID by four is incorrect when
    // the arena starts at an unaligned base vertex. Source indices stay constant
    // and every active invocation executes the same reads before selecting data.
#define OC_FIND_LANE(I) \
    if ((activeMask & (uint64_t(1) << (I))) != uint64_t(0)) { \
        int candidate = readInvocationARB(OBJMC_VERTEX_ID, (I)); \
        if (candidate == OBJMC_VERTEX_ID) ownLane = (I); \
    }
    OC_FIND_LANE(0u)
    OC_FIND_LANE(1u)
    OC_FIND_LANE(2u)
    OC_FIND_LANE(3u)
    OC_FIND_LANE(4u)
    OC_FIND_LANE(5u)
    OC_FIND_LANE(6u)
    OC_FIND_LANE(7u)
    OC_FIND_LANE(8u)
    OC_FIND_LANE(9u)
    OC_FIND_LANE(10u)
    OC_FIND_LANE(11u)
    OC_FIND_LANE(12u)
    OC_FIND_LANE(13u)
    OC_FIND_LANE(14u)
    OC_FIND_LANE(15u)
    OC_FIND_LANE(16u)
    OC_FIND_LANE(17u)
    OC_FIND_LANE(18u)
    OC_FIND_LANE(19u)
    OC_FIND_LANE(20u)
    OC_FIND_LANE(21u)
    OC_FIND_LANE(22u)
    OC_FIND_LANE(23u)
    OC_FIND_LANE(24u)
    OC_FIND_LANE(25u)
    OC_FIND_LANE(26u)
    OC_FIND_LANE(27u)
    OC_FIND_LANE(28u)
    OC_FIND_LANE(29u)
    OC_FIND_LANE(30u)
    OC_FIND_LANE(31u)
    OC_FIND_LANE(32u)
    OC_FIND_LANE(33u)
    OC_FIND_LANE(34u)
    OC_FIND_LANE(35u)
    OC_FIND_LANE(36u)
    OC_FIND_LANE(37u)
    OC_FIND_LANE(38u)
    OC_FIND_LANE(39u)
    OC_FIND_LANE(40u)
    OC_FIND_LANE(41u)
    OC_FIND_LANE(42u)
    OC_FIND_LANE(43u)
    OC_FIND_LANE(44u)
    OC_FIND_LANE(45u)
    OC_FIND_LANE(46u)
    OC_FIND_LANE(47u)
    OC_FIND_LANE(48u)
    OC_FIND_LANE(49u)
    OC_FIND_LANE(50u)
    OC_FIND_LANE(51u)
    OC_FIND_LANE(52u)
    OC_FIND_LANE(53u)
    OC_FIND_LANE(54u)
    OC_FIND_LANE(55u)
    OC_FIND_LANE(56u)
    OC_FIND_LANE(57u)
    OC_FIND_LANE(58u)
    OC_FIND_LANE(59u)
    OC_FIND_LANE(60u)
    OC_FIND_LANE(61u)
    OC_FIND_LANE(62u)
    OC_FIND_LANE(63u)
#undef OC_FIND_LANE
    uint ownBase = ownLane & ~3u;
#define OC_READ_LANE(I) \
    if ((activeMask & (uint64_t(1) << (I))) != uint64_t(0)) { \
        vec3 p = readInvocationARB(position, (I)); \
        vec2 t = readInvocationARB(uv, (I)); \
        if (((I) & ~3u) == ownBase) { \
            positions[(I) & 3u] = p; uvs[(I) & 3u] = t; \
        } \
    }
    OC_READ_LANE(0u)
    OC_READ_LANE(1u)
    OC_READ_LANE(2u)
    OC_READ_LANE(3u)
    OC_READ_LANE(4u)
    OC_READ_LANE(5u)
    OC_READ_LANE(6u)
    OC_READ_LANE(7u)
    OC_READ_LANE(8u)
    OC_READ_LANE(9u)
    OC_READ_LANE(10u)
    OC_READ_LANE(11u)
    OC_READ_LANE(12u)
    OC_READ_LANE(13u)
    OC_READ_LANE(14u)
    OC_READ_LANE(15u)
    OC_READ_LANE(16u)
    OC_READ_LANE(17u)
    OC_READ_LANE(18u)
    OC_READ_LANE(19u)
    OC_READ_LANE(20u)
    OC_READ_LANE(21u)
    OC_READ_LANE(22u)
    OC_READ_LANE(23u)
    OC_READ_LANE(24u)
    OC_READ_LANE(25u)
    OC_READ_LANE(26u)
    OC_READ_LANE(27u)
    OC_READ_LANE(28u)
    OC_READ_LANE(29u)
    OC_READ_LANE(30u)
    OC_READ_LANE(31u)
    OC_READ_LANE(32u)
    OC_READ_LANE(33u)
    OC_READ_LANE(34u)
    OC_READ_LANE(35u)
    OC_READ_LANE(36u)
    OC_READ_LANE(37u)
    OC_READ_LANE(38u)
    OC_READ_LANE(39u)
    OC_READ_LANE(40u)
    OC_READ_LANE(41u)
    OC_READ_LANE(42u)
    OC_READ_LANE(43u)
    OC_READ_LANE(44u)
    OC_READ_LANE(45u)
    OC_READ_LANE(46u)
    OC_READ_LANE(47u)
    OC_READ_LANE(48u)
    OC_READ_LANE(49u)
    OC_READ_LANE(50u)
    OC_READ_LANE(51u)
    OC_READ_LANE(52u)
    OC_READ_LANE(53u)
    OC_READ_LANE(54u)
    OC_READ_LANE(55u)
    OC_READ_LANE(56u)
    OC_READ_LANE(57u)
    OC_READ_LANE(58u)
    OC_READ_LANE(59u)
    OC_READ_LANE(60u)
    OC_READ_LANE(61u)
    OC_READ_LANE(62u)
    OC_READ_LANE(63u)
#undef OC_READ_LANE
}
#endif
