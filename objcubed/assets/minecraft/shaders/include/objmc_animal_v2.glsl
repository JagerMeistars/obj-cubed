// Marker 252, version 2: six explicit native carrier descriptors.
// Included inside entity.vsh main() after the exact marker/version matched.
// t14 RG: appended descriptor row, B: six slots; t15: [79,67,50,1].
// Each slot contains 16 RGBA little-endian float32 scalars: normalized UV
// rectangle, native q0/q1/q3 positions, and local outward normal. q0 is
// UV right/top, q1 left/top, q3 right/bottom. Final three scalars are the
// artist pivot (native +Y down). Source OBJ coordinates remain item-compatible.
ivec4 ocAnimalDescriptorHeader = getmeta(ivec2(0), 14);
ivec4 ocAnimalSignature = getmeta(ivec2(0), 15);
int ocAnimalDescriptorRow = ocAnimalDescriptorHeader.r * 256 + ocAnimalDescriptorHeader.g;
if (ocAnimalKind.a == 0 && ocAnimalDescriptorHeader.b == 6 && ocAnimalDescriptorHeader.a == 0
    && all(equal(ocAnimalSignature, ivec4(79,67,50,1)))
    && ocAnimalDescriptorRow >= 2 && ocAnimalDescriptorRow < ocAnimalAtlas.y
    && (ocAnimalAtlas.y - ocAnimalDescriptorRow) * ocAnimalAtlas.x >= 99) {
    // Byte assembly in oc_animal_scalar preserves the exact stored float bits.
#define OC_ANIMAL_FLOAT(I) oc_animal_scalar(ivec2((I) % ocAnimalAtlas.x, ocAnimalDescriptorRow + (I) / ocAnimalAtlas.x))
    vec3 ocAnimalPos[4]; vec2 ocAnimalUV[4];
    oc_read_carrier(Position, UV0, ocAnimalPos, ocAnimalUV);
    vec2 ocAnimalMin = vec2(1e20), ocAnimalMax = vec2(-1e20);
    for (int i = 0; i < 4; ++i) {
        ocAnimalMin = min(ocAnimalMin, ocAnimalUV[i]);
        ocAnimalMax = max(ocAnimalMax, ocAnimalUV[i]);
    }
    int ocAnimalFace = -1;
    for (int slot = 0; slot < 6; ++slot) {
        int offset = slot * 16;
        vec4 rect = vec4(OC_ANIMAL_FLOAT(offset), OC_ANIMAL_FLOAT(offset + 1),
            OC_ANIMAL_FLOAT(offset + 2), OC_ANIMAL_FLOAT(offset + 3));
        if (!any(isnan(rect)) && !any(isinf(rect))
            && all(greaterThan(rect.zw - rect.xy, vec2(1e-7)))
            && all(lessThan(abs(vec4(ocAnimalMin, ocAnimalMax) - rect), vec4(1e-5)))) {
            ocAnimalFace = slot;
            break; // Each carrier descriptor has six distinct UV rectangles.
        }
    }
    // UV-disjoint body/head/limb carriers match before OBJ geometry decoding.
    // Identical native carriers intentionally repeat a shared attachment.
    if (ocAnimalFace >= 0) {
        ivec4 ocAnimalEntry = getmeta(ivec2(0), 8 + ocAnimalFace);
        int ocAnimalIndex = ocAnimalEntry.r * 256 + ocAnimalEntry.g;
        if (ocAnimalIndex != 65535) {
            int offset = ocAnimalFace * 16;
            vec3 q0 = vec3(OC_ANIMAL_FLOAT(offset + 4), OC_ANIMAL_FLOAT(offset + 5), OC_ANIMAL_FLOAT(offset + 6));
            vec3 q1 = vec3(OC_ANIMAL_FLOAT(offset + 7), OC_ANIMAL_FLOAT(offset + 8), OC_ANIMAL_FLOAT(offset + 9));
            vec3 q3 = vec3(OC_ANIMAL_FLOAT(offset + 10), OC_ANIMAL_FLOAT(offset + 11), OC_ANIMAL_FLOAT(offset + 12));
            vec3 localNormal = vec3(OC_ANIMAL_FLOAT(offset + 13), OC_ANIMAL_FLOAT(offset + 14), OC_ANIMAL_FLOAT(offset + 15));
            vec3 ocAnimalPivot = vec3(OC_ANIMAL_FLOAT(96), OC_ANIMAL_FLOAT(97), OC_ANIMAL_FLOAT(98));
            bool finiteDescriptor = !any(isnan(q0)) && !any(isinf(q0))
                && !any(isnan(q1)) && !any(isinf(q1)) && !any(isnan(q3)) && !any(isinf(q3))
                && !any(isnan(localNormal)) && !any(isinf(localNormal))
                && !any(isnan(ocAnimalPivot)) && !any(isinf(ocAnimalPivot));
            vec3 localU = q0 - q1, localV = q0 - q3;
            float localULength = length(localU), localVLength = length(localV);
            if (finiteDescriptor && localULength > 1e-7 && localVLength > 1e-7 && length(localNormal) > 1e-7) {
                vec2 ocAnimalMid = (ocAnimalMin + ocAnimalMax) * 0.5;
                vec3 ordered[4];
                for (int i = 0; i < 4; ++i) ordered[i] = vec3(0.0);
                int cornerMask = 0;
                for (int i = 0; i < 4; ++i) {
                    bool right = ocAnimalUV[i].x > ocAnimalMid.x;
                    bool top = ocAnimalUV[i].y < ocAnimalMid.y;
                    int corner = top ? (right ? 0 : 1) : (right ? 3 : 2);
                    ordered[corner] = ocAnimalPos[i];
                    cornerMask |= 1 << corner;
                }
                bool ownRight = UV0.x > ocAnimalMid.x, ownTop = UV0.y < ocAnimalMid.y;
                int ocAnimalCorner = ownTop ? (ownRight ? 0 : 1) : (ownRight ? 3 : 2);
                vec3 actualU = ordered[0] - ordered[1], actualV = ordered[0] - ordered[3];
                float actualULength = length(actualU), actualVLength = length(actualV);
                mat3 localFrame = mat3(localU / localULength, localV / localVLength, normalize(localNormal));
                if (cornerMask == 15 && actualULength > 1e-7 && actualVLength > 1e-7
                    && abs(determinant(localFrame)) > 1e-5 && length(cross(actualU, actualV)) > 1e-7) {
                    float scale = (actualULength / localULength + actualVLength / localVLength) * 0.5;
                    vec3 actualNormal = normalize(cross(actualU, actualV));
                    if (dot(actualNormal, Normal) < 0.0) actualNormal = -actualNormal;
                    mat3 ocAnimalBasis = mat3(actualU / localULength, actualV / localVLength, actualNormal * scale) * inverse(localFrame);
                    vec3 ocAnimalOrigin = ordered[0] - ocAnimalBasis * q0;
                    ivec4 ocAnimalMeta[8];
                    for (int i = 1; i < 8; ++i) ocAnimalMeta[i] = getmeta(ivec2(0), i);
                    ivec2 ocAnimalSize = ivec2(ocAnimalMeta[1].r * 256 + ocAnimalMeta[1].g,
                        ocAnimalMeta[1].b * 256 + ocAnimalMeta[7].r);
                    int ocAnimalVertices = ocAnimalMeta[2].r * 16777216 + ocAnimalMeta[2].g * 65536
                        + ocAnimalMeta[2].b * 256 + ocAnimalMeta[7].g;
                    // Descriptors must be appended after all original payload
                    // rows, including every animation frame. Use float arithmetic
                    // for capacity checks so a corrupt large count cannot overflow.
                    float payloadFrames = max(float(ocAnimalMeta[3].r * 65536 + ocAnimalMeta[3].g * 256 + ocAnimalMeta[3].b), 1.0);
                    float payloadEnd = 2.0 + ceil(float(ocAnimalVertices) * 0.25 / float(max(ocAnimalSize.x, 1)))
                        + float(ocAnimalSize.y) * float(max(ocAnimalMeta[3].a, 1))
                        + float(ocAnimalMeta[5].r * 256 + ocAnimalMeta[5].g)
                        + float(ocAnimalMeta[5].b * 256 + ocAnimalMeta[7].b)
                        + ceil(float(ocAnimalVertices) * payloadFrames * 2.0 / float(max(ocAnimalSize.x, 1)));
                    if (ocAnimalSize.x > 0 && ocAnimalSize.x == ocAnimalAtlas.x && ocAnimalSize.y > 0
                        && ocAnimalVertices > 0 && ocAnimalIndex < ocAnimalVertices / 4
                        && payloadEnd <= float(ocAnimalDescriptorRow)) {
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
                            vec3 previous = getpos(ivec2(0), ocAnimalSize.x, ocAnimalGeometryRow,
                                getvert(ivec2(0), ocAnimalSize.x, ocAnimalVertexRow,
                                    ocAnimalBaseVertex + ((ocAnimalFrame + ocAnimalFrames - 1) % ocAnimalFrames) * ocAnimalVertices).x);
                            ocAnimalDecoded = bezier(previous, ocAnimalDecoded, next, next2, blend);
                        } else {
                            ocAnimalDecoded = mix(ocAnimalDecoded, next, ease(ocAnimalEasing, blend));
                        }
                    }
                    // Preserve shared item coordinates; artist pivot applies only here.
                    // Undo the shared item encoder's vertical re-anchor first;
                    // BB +Y is up, native ModelPart +Y is down.
                    ocAnimalDecoded.y += 0.5;
                    ocAnimalDecoded.y = -ocAnimalDecoded.y;
                    Pos = ocAnimalOrigin + ocAnimalBasis * (ocAnimalDecoded - ocAnimalPivot);

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
                        // Animal exports have at most four atlas strips, fitting
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
        }
    }
#undef OC_ANIMAL_FLOAT
}
