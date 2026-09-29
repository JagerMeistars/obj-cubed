// Marker 252, version 1: rigid attachments to the native horse body pivot.
// Included inside entity.vsh main(), only after the exact marker matched.
// Row 0: t[1..7] are the ordinary OBJ3 geometry/animation header. t[8..13]
// map DOWN, UP, WEST, NORTH, EAST, SOUTH to (faceHi, faceLo, emission).
// t[8].a is the format version; t[9].a is 0=horse armor, 1=horse saddle.
// 65535 is an unused face. Both kinds use the BODY cube, not the saddle cube.
isCustom = 1;
isGUI = 0;
isHand = 0;
overlayColor = vec4(1.0);
Pos = vec3(9999.0); // Invalid headers, non-body quads and empty slots collapse.
ivec2 ocAnimalAtlas = textureSize(Sampler0, 0);
if (ocAnimalAtlas.x >= 14 && ocAnimalAtlas.y >= 2) {
    ivec4 ocAnimalVersion = getmeta(ivec2(0), 8);
    ivec4 ocAnimalKind = getmeta(ivec2(0), 9);
    if (ocAnimalVersion.a == 1 && ocAnimalKind.a <= 1) {
        vec3 ocAnimalPos[4]; vec2 ocAnimalUV[4];
        // Broadcast before divergent face selection; source data are native.
        oc_read_carrier(Position, UV0, ocAnimalPos, ocAnimalUV);
        vec2 ocAnimalMin = vec2(64.0), ocAnimalMax = vec2(0.0);
        for (int i = 0; i < 4; ++i) {
            ocAnimalMin = min(ocAnimalMin, ocAnimalUV[i] * 64.0);
            ocAnimalMax = max(ocAnimalMax, ocAnimalUV[i] * 64.0);
        }
        // Exact native 64x64 UV rectangles from 26.3 AbstractEquineModel.
        // Each full rectangle is unique among ALL parts of both native models.
        const vec4 ocAnimalRects[6] = vec4[6](
            vec4(22,32,32,54), vec4(32,32,42,54),
            vec4(0,54,22,64), vec4(22,54,32,64),
            vec4(32,54,54,64), vec4(54,54,64,64));
        int ocAnimalFace = -1;
        for (int i = 0; i < 6; ++i)
            if (all(lessThan(abs(vec4(ocAnimalMin, ocAnimalMax) - ocAnimalRects[i]), vec4(0.001))))
                ocAnimalFace = i;
        // Cull the other 11/18 native cubes BEFORE geometry/header decoding.
        if (ocAnimalFace >= 0) {
            ivec4 ocAnimalEntry = getmeta(ivec2(0), 8 + ocAnimalFace);
            int ocAnimalIndex = ocAnimalEntry.r * 256 + ocAnimalEntry.g;
            if (ocAnimalIndex != 65535) {
                ivec4 ocAnimalMeta[8];
                for (int i = 1; i < 8; ++i) ocAnimalMeta[i] = getmeta(ivec2(0), i);
                ivec2 ocAnimalSize = ivec2(ocAnimalMeta[1].r * 256 + ocAnimalMeta[1].g,
                    ocAnimalMeta[1].b * 256 + ocAnimalMeta[7].r);
                int ocAnimalVertices = ocAnimalMeta[2].r * 16777216 + ocAnimalMeta[2].g * 65536
                    + ocAnimalMeta[2].b * 256 + ocAnimalMeta[7].g;
                if (ocAnimalSize.x > 0 && ocAnimalSize.y > 0 && ocAnimalIndex < ocAnimalVertices / 4) {
                    vec2 ocAnimalMid = (ocAnimalMin + ocAnimalMax) * 0.5;
                    vec3 ocAnimalOrdered[4];
                    // Native Polygon corner order. UP reverses V; shared vertex
                    // arena offsets and the subgroup's lane order are irrelevant.
                    for (int i = 0; i < 4; ++i) {
                        vec2 p = ocAnimalUV[i] * 64.0;
                        bool right = p.x > ocAnimalMid.x;
                        bool top = ocAnimalFace == 1 ? p.y > ocAnimalMid.y : p.y < ocAnimalMid.y;
                        int c = top ? (right ? 0 : 1) : (right ? 3 : 2);
                        ocAnimalOrdered[c] = ocAnimalPos[i];
                    }
                    vec2 ocAnimalOwnUV = UV0 * 64.0;
                    bool ocAnimalRight = ocAnimalOwnUV.x > ocAnimalMid.x;
                    bool ocAnimalTop = ocAnimalFace == 1 ? ocAnimalOwnUV.y > ocAnimalMid.y : ocAnimalOwnUV.y < ocAnimalMid.y;
                    int ocAnimalCorner = ocAnimalTop ? (ocAnimalRight ? 0 : 1) : (ocAnimalRight ? 3 : 2);

                    // The actual body cube has its own fixed 0.05 inflation:
                    // X +/-5.05, Y -8.05..2.05, Z -17.05..5.05 native model px.
                    // Recover the complete body frame, including uniform scale
                    // and reflection, from its two measured edges and normal.
                    vec3 ocAnimalU = ocAnimalOrdered[0] - ocAnimalOrdered[1];
                    vec3 ocAnimalV = ocAnimalOrdered[0] - ocAnimalOrdered[3];
                    float ocAnimalULength = (ocAnimalFace == 2 || ocAnimalFace == 4) ? 22.1 / 16.0 : 10.1 / 16.0;
                    float ocAnimalVLength = ocAnimalFace < 2 ? 22.1 / 16.0 : 10.1 / 16.0;
                    float ocAnimalScale = (length(ocAnimalU) / ocAnimalULength + length(ocAnimalV) / ocAnimalVLength) * 0.5;
                    vec3 ocAnimalN = normalize(cross(ocAnimalU, ocAnimalV));
                    if (dot(ocAnimalN, Normal) < 0.0) ocAnimalN = -ocAnimalN;
                    ocAnimalN *= ocAnimalScale;
                    ocAnimalU /= ocAnimalULength;
                    ocAnimalV /= ocAnimalVLength;
                    mat3 ocAnimalBasis;
                    if      (ocAnimalFace == 0) ocAnimalBasis = mat3(ocAnimalU, -ocAnimalN, ocAnimalV);
                    else if (ocAnimalFace == 1) ocAnimalBasis = mat3(ocAnimalU, ocAnimalN, -ocAnimalV);
                    else if (ocAnimalFace == 2) ocAnimalBasis = mat3(-ocAnimalN, -ocAnimalV, -ocAnimalU);
                    else if (ocAnimalFace == 3) ocAnimalBasis = mat3(ocAnimalU, -ocAnimalV, -ocAnimalN);
                    else if (ocAnimalFace == 4) ocAnimalBasis = mat3(ocAnimalN, -ocAnimalV, ocAnimalU);
                    else                        ocAnimalBasis = mat3(-ocAnimalU, -ocAnimalV, ocAnimalN);
                    const vec3 ocAnimalQ0[6] = vec3[6](
                        vec3(5.05,-8.05,5.05), vec3(5.05,2.05,-17.05),
                        vec3(-5.05,-8.05,-17.05), vec3(5.05,-8.05,-17.05),
                        vec3(5.05,-8.05,5.05), vec3(-5.05,-8.05,5.05));
                    vec3 ocAnimalOrigin = ocAnimalOrdered[0] - ocAnimalBasis * (ocAnimalQ0[ocAnimalFace] / 16.0);

                    int ocAnimalFrames = max(ocAnimalMeta[3].r * 65536 + ocAnimalMeta[3].g * 256 + ocAnimalMeta[3].b, 1);
                    int ocAnimalTextures = max(ocAnimalMeta[3].a, 1);
                    float ocAnimalDuration = max(float(ocAnimalMeta[4].r * 65536 + ocAnimalMeta[4].g * 256 + ocAnimalMeta[4].b), 1.0);
                    int ocAnimalPosRows = ocAnimalMeta[5].r * 256 + ocAnimalMeta[5].g;
                    int ocAnimalUVRows = ocAnimalMeta[5].b * 256 + ocAnimalMeta[7].b;
                    noshadow = getb(ocAnimalMeta[6].r, 7, 1);
                    if (ocAnimalEntry.b > 0) noshadow = 1;
                    float ocAnimalTime = GameTime * 24000.0;
                    float ocAnimalClock = 0.0;
                    ivec3 ocAnimalDye = ivec3(Color.rgb * 255.0 + 0.5);
                    if (all(equal(ocAnimalDye, ivec3(255)))) {
                        if (getb(ocAnimalMeta[4].a, 6)) ocAnimalClock = ocAnimalTime * float(ocAnimalFrames) / ocAnimalDuration;
                    } else {
                        // Same dyed_color control word as humanoid equipment.
                        int control = (ocAnimalDye.r & 127) * 65536 + ocAnimalDye.g * 256 + ocAnimalDye.b;
                        if ((ocAnimalDye.r & 128) != 0) {
                            ocAnimalClock = clamp(float(control) * float(ocAnimalFrames) / ocAnimalDuration,
                                0.0, float(ocAnimalFrames - 1));
                        } else if (control >= 32768) {
                            int elapsed = (int(ocAnimalTime) % 24000 - (control - 32768) + 24000) % 24000;
                            ocAnimalClock = min(float(elapsed) + fract(ocAnimalTime), float(ocAnimalFrames - 1));
                        } else {
                            ocAnimalClock = (ocAnimalTime + ocAnimalDuration - mod(float(control), ocAnimalDuration))
                                * float(ocAnimalFrames) / ocAnimalDuration;
                        }
                    }
                    int ocAnimalFrame = int(ocAnimalClock) % ocAnimalFrames;
                    int ocAnimalHeaderRows = 2 + int(ceil(float(ocAnimalVertices) * 0.25 / float(ocAnimalSize.x)));
                    int ocAnimalGeometryRow = ocAnimalHeaderRows + ocAnimalSize.y * ocAnimalTextures;
                    int ocAnimalVertexRow = ocAnimalGeometryRow + ocAnimalPosRows + ocAnimalUVRows;
                    int ocAnimalBaseVertex = ocAnimalIndex * 4 + ocAnimalCorner;
                    int ocAnimalVertex = ocAnimalBaseVertex + ocAnimalFrame * ocAnimalVertices;
                    ivec2 ocAnimalIndices = getvert(ivec2(0), ocAnimalSize.x, ocAnimalVertexRow, ocAnimalVertex);
                    vec3 ocAnimalDecoded = getpos(ivec2(0), ocAnimalSize.x, ocAnimalGeometryRow, ocAnimalIndices.x);
                    int ocAnimalEasing = getb(ocAnimalMeta[4].a, 4, 2) | (getb(ocAnimalMeta[4].a, 0, 2) << 2);
                    if (ocAnimalFrames > 1 && ocAnimalEasing > 0) {
                        float blend = fract(ocAnimalClock);
                        vec3 next = getpos(ivec2(0), ocAnimalSize.x, ocAnimalGeometryRow,
                            getvert(ivec2(0), ocAnimalSize.x, ocAnimalVertexRow,
                                ocAnimalBaseVertex + ((ocAnimalFrame + 1) % ocAnimalFrames) * ocAnimalVertices).x);
                        if (ocAnimalEasing == 3) {
                            vec3 next2 = getpos(ivec2(0), ocAnimalSize.x, ocAnimalGeometryRow,
                                getvert(ivec2(0), ocAnimalSize.x, ocAnimalVertexRow,
                                    ocAnimalBaseVertex + ((ocAnimalFrame + 2) % ocAnimalFrames) * ocAnimalVertices).x);
                            vec3 next3 = getpos(ivec2(0), ocAnimalSize.x, ocAnimalGeometryRow,
                                getvert(ivec2(0), ocAnimalSize.x, ocAnimalVertexRow,
                                    ocAnimalBaseVertex + ((ocAnimalFrame + 3) % ocAnimalFrames) * ocAnimalVertices).x);
                            ocAnimalDecoded = bezier(ocAnimalDecoded, next, next2, next3, blend);
                        } else {
                            ocAnimalDecoded = mix(ocAnimalDecoded, next, ease(ocAnimalEasing, blend));
                        }
                    }
                    // Export coordinates are relative to BB origin, in blocks.
                    // Undo the shared item encoder's vertical re-anchor first;
                    // BB +Y is up, native ModelPart +Y is down.
                    ocAnimalDecoded.y += 0.5;
                    ocAnimalDecoded.y = -ocAnimalDecoded.y;
                    Pos = ocAnimalOrigin + ocAnimalBasis * ocAnimalDecoded;

                    vec2 ocAnimalTexUV = getuv(ivec2(0), ocAnimalSize.x, ocAnimalGeometryRow + ocAnimalPosRows, ocAnimalIndices.y);
                    int ocAnimalOpposite = ocAnimalVertex - ocAnimalCorner + (ocAnimalCorner + 2) % 4;
                    int ocAnimalOppositeUV = getvert(ivec2(0), ocAnimalSize.x, ocAnimalVertexRow, ocAnimalOpposite).y;
                    vec2 ocAnimalUVMid = (ocAnimalTexUV + getuv(ivec2(0), ocAnimalSize.x,
                        ocAnimalGeometryRow + ocAnimalPosRows, ocAnimalOppositeUV)) * 0.5;
                    // UVs are quantized to 16 bits. At a frame/band edge that
                    // rounding, or an outward jitter, can sample a neighboring
                    // material or metadata row. Inset by one encoded UV step
                    // toward the face interior, also for rotated/flipped UVs.
                    vec2 ocAnimalUVInward = ocAnimalUVMid - ocAnimalTexUV;
                    ocAnimalTexUV += sign(ocAnimalUVInward) * min(abs(ocAnimalUVInward), vec2(1.0 / 65535.0));
                    texCoord = (vec2(0, ocAnimalHeaderRows) + ocAnimalTexUV * vec2(ocAnimalSize)) / vec2(ocAnimalAtlas);
                    texCoord2 = texCoord;
                    transition = 0.0;
                    ivec4 ocAnimalTexClock = ivec4(texelFetch(Sampler0, ivec2(4,1), 0) * 255.0 + 0.5);
                    ivec4 ocAnimalTexFlags = ivec4(texelFetch(Sampler0, ivec2(5,1), 0) * 255.0 + 0.5);
                    float ocAnimalTexDuration = max(float(ocAnimalTexClock.r * 65536 + ocAnimalTexClock.g * 256 + ocAnimalTexClock.b), 1.0);
                    if (ocAnimalTextures > 1) {
                        int frame = int(ocAnimalTime / ocAnimalTexDuration) % ocAnimalTextures;
                        int next = (frame + 1) % ocAnimalTextures;
                        texCoord = (vec2(0, ocAnimalHeaderRows + frame * ocAnimalSize.y) + ocAnimalTexUV * vec2(ocAnimalSize)) / vec2(ocAnimalAtlas);
                        texCoord2 = (vec2(0, ocAnimalHeaderRows + next * ocAnimalSize.y) + ocAnimalTexUV * vec2(ocAnimalSize)) / vec2(ocAnimalAtlas);
                        if ((ocAnimalTexFlags.r & 1) != 0) transition = fract(ocAnimalTime / ocAnimalTexDuration);
                    } else if (ocAnimalTexFlags.g > 0) {
                        float midpoint = ocAnimalUVMid.y * float(ocAnimalSize.y);
                        // Version 1 exports at most four atlas strips, fitting
                        // row-1 texels 6..13 even at the minimum header width.
                        for (int b = 0; b < min(ocAnimalTexFlags.g, 4); ++b) {
                            ivec4 band0 = ivec4(texelFetch(Sampler0, ivec2(6 + b * 2, 1), 0) * 255.0 + 0.5);
                            ivec4 band1 = ivec4(texelFetch(Sampler0, ivec2(7 + b * 2, 1), 0) * 255.0 + 0.5);
                            int y0 = band0.r * 256 + band0.g;
                            int height = band0.b * 256 + band1.r;
                            int frames = max(band1.g, 1);
                            if (midpoint > float(y0) && midpoint < float(y0 + height)) {
                                int frame = int(ocAnimalTime / ocAnimalTexDuration) % frames;
                                texCoord.y -= float(frame * height) / float(ocAnimalAtlas.y);
                                texCoord2.y -= float(((frame + 1) % frames) * height) / float(ocAnimalAtlas.y);
                                if ((ocAnimalTexFlags.r & 1) != 0) transition = fract(ocAnimalTime / ocAnimalTexDuration);
                                break;
                            }
                        }
                    }
                }
            }
        }
    } else if (ocAnimalVersion.a == 2 && ocAnimalAtlas.x >= 16) {
        #include <minecraft:objmc_animal_v2.glsl>
    }
}
