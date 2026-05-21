//objmc
//https://github.com/Godlander/objmc

isCustom = 0;
transition = 0;
int corner = gl_VertexID % 4;
ivec2 atlasSize = textureSize(Sampler0, 0);
vec2 onepixel = 1./atlasSize;
ivec2 uv = ivec2((UV0 * atlasSize));
vec3 posoffset = vec3(0);
float scale = 1;
vec3 rotation = vec3(0);
int headerheight = 0;
bool compression = false;
ivec4 t[8];
//read uv offset
t[0] = ivec4(texelFetch(Sampler0, uv, 0) * 255.0 + 0.5);
ivec2 uvoffset = ivec2(t[0].r*256 + t[0].g, t[0].b*256 + t[0].a);
//find and read topleft pixel
ivec2 topleft = uv - uvoffset;
//if topleft marker is correct
ivec4 marker = ivec4(texelFetch(Sampler0, topleft, 0)*255.0+0.5);
if (marker == ivec4(12,34,56,78)) {
    compression = marker.a == 79;
    isCustom = 1;
    // header
    //| 2^32   | 2^16x2   | 2^32      | 2^24 + 2^8   | 2^24    + \1 2^1  + 2^2   + 2^2 \2| 2^16x2       | 2^1     + 2^2       + 2^3      \1 2^9        \16|
    //| marker | tex size | nvertices | nobjs, ntexs | duration, autoplay, easing, interp| data heights | noshadow, autorotate, visibility, colorbehavior |

    // header
    //| 2^32   | 2^16x2   | 2^32      | 2^32 | 2^32 | 2^16 + 2^16     | 2^12         + 2^2     + 2^2   + 2^2       + 2^1     + 2^3    \10 |
    //| marker | tex size | nvertices | npos | nuvs | nobjs, duration | colorbehavior, autoplay, easing, autorotate, noshadow, visibility |

    //colorbehavior
    // 0: direct color
    // 1: time
    // 2: scale
    // 3: hue/tint (overlay)
    // 4: hurt

    for (int i = 1; i < 8; i++) {
        t[i] = getmeta(topleft, i);
    }
    //1: texsize
    ivec2 size = ivec2(t[1].r*256 + t[1].g, t[1].b*256 + t[7].r);
    //2: nvertices
    int nvertices = t[2].r*16777216 + t[2].g*65536 + t[2].b*256 + t[7].g;
    //3: nobjs, ntexs
    int nframes = max(t[3].r*65536 + t[3].g*256 + t[3].b, 1);
    int ntextures = max(t[3].a, 1);
    //4: duration, autoplay, easing
    float duration = max(t[4].r*65536 + t[4].g*256 + t[4].b, 1);
    bool autoplay = getb(t[4].a, 6);
    ivec2 easing = ivec2(getb(t[4].a, 4, 2), getb(t[4].a, 2, 2));
    //5: data heights
    int vph = t[5].r*256 + t[5].g;
    int vth = t[5].b*256 + t[7].b;
    //6: noshadow, autorotate, visibility, colorbehavior
    noshadow = getb(t[6].r, 7, 1);
    vec2 autorotate = vec2(getb(t[6].r, 6, 1), getb(t[6].r, 5, 1));
    bvec3 visibility = bvec3(getb(t[6].r, 4), getb(t[6].r, 3), getb(t[6].r, 2));
    int colorbehavior = getb(t[6].r, 0, 1)*256 + t[6].g;

    //time in ticks
    float time = GameTime * 24000;
    int tcolor = 0;

#ifdef BLOCK
    if (!visibility.x) { //world
        Pos = vec3(0); posoffset = vec3(0);
    } else {
#endif
#ifdef ENTITY
    isGUI = int(isgui(ProjMat));
    isHand = int(ishand(ProjMat));
    if (((isGUI + isHand == 0) && visibility.x) || (bool(isHand) && visibility.y) || (bool(isGUI) && visibility.z)) {
        //colorbehavior
        overlayColor = vec4(1);
        vec3 directColor = vec3(1);
        bool hasDirectColor = false;
        if (colorbehavior == 73) { //all three channels = time, animation frames 0-8388607
            tcolor = (int(Color.r*255.0+0.5)*65536)%32768 + int(Color.g*255.0+0.5)*256 + int(Color.b*255.0+0.5);
            //interpolation disabled past 8388608, suso's idea to define starting tick with color
            autoplay = (Color.r <= 0.5);
        } else {
            //bits from colorbehavior
            vec2 tscale = vec2(0, 255./256.);
            vec2 thue = vec2(0, 255./256.);
            switch ((colorbehavior>>6)&7) { //first 3 bits, r
                //direct color
                case 0: directColor.r = Color.r; hasDirectColor = true; break;
                //time
                case 1: tcolor = tcolor*256 + int(Color.r*255); break;
                //scale
                case 2: tscale.x = Color.r*255; tscale.y *= 256; break;
                //hue
                case 3: thue.x = Color.r*255; thue.y *= 256; break;
                //hurt tint
                case 4: if (Color.r != 0) overlayColor = vec4(1,0.7,0.7,1); break;
            }
            switch ((colorbehavior>>3)&7) { //second 3 bits, g
                //direct color
                case 0: directColor.g = Color.g; hasDirectColor = true; break;
                //time
                case 1: tcolor = tcolor*256 + int(Color.g*255); break;
                //scale
                case 2: tscale.x = tscale.x*256 + Color.g*255; tscale.y *= 256; break;
                //hue
                case 3: thue.x = thue.x*256 + Color.g*255; thue.y *= 256; break;
                //hurt tint
                case 4: if (Color.g != 0) overlayColor = vec4(1,0.7,0.7,1); break;
            }
            switch (colorbehavior&7) { //third 3 bits, b
                //direct color
                case 0: directColor.b = Color.b; hasDirectColor = true; break;
                //time
                case 1: tcolor = tcolor*256 + int(Color.b*255); break;
                //scale
                case 2: tscale.x = tscale.x*256 + Color.b*255; tscale.y *= 256; break;
                //hue
                case 3: thue.x = thue.x*256 + Color.b*255; thue.y *= 256; break;
                //hurt tint
                case 4: if (Color.b != 0) overlayColor = vec4(1,0.7,0.7,1); break;
            }
            if (tscale.x > 0) scale = tscale.x/tscale.y;
            if (thue.x > 0) overlayColor = vec4(hrgb(thue.x/thue.y),1);
            //apply direct color: tint the model via overlayColor
            if (hasDirectColor) overlayColor = vec4(directColor, 1.0);
        }
#endif
        int frame;
        if (autoplay && tcolor >= 32768) {
            // play_once: tcolor bit 15 = flag, lower 15 bits = start gametime % 24000
            int start = tcolor - 32768;
            int elapsed = (int(time) % 24000 - start + 24000) % 24000;
            frame = min(elapsed, nframes - 1);
            // keep interpolation during animation, disable when frozen at last frame
            time = (elapsed >= nframes - 1) ? float(frame) : float(elapsed) + fract(time);
        } else {
            time = autoplay ? time + duration - mod(tcolor, duration) : tcolor;
            frame = int(time * nframes / duration) % nframes;
        }
        //relative vertex id from unique face uv
        int id = (((uvoffset.y-1) * size.x) + uvoffset.x) * 4 + corner;
        id += frame * nvertices;
        //calculate height offsets
        headerheight = 1 + int(ceil(nvertices*0.25/size.x));
        int height = headerheight + (size.y * ntextures);
        //read data
        ivec2 index = getvert(topleft, size.x, height+vph+vth, id, compression);
        posoffset = getpos(topleft, size.x, height, index.x);
        if (nframes > 1) {
            int nids = (nframes * nvertices);
            //next frame
            id = (id+nvertices) % nids;
            index = getvert(topleft, size.x, height+vph+vth, id, compression);
            vec3 posoffset2 = getpos(topleft, size.x, height, index.x);
            //interpolate
            transition = fract(time * nframes / duration);
            switch (easing.x) { //easing
                case 1: //linear
                    posoffset = mix(posoffset, posoffset2, transition);
                    break;
                case 2: //in-out cubic
                    transition = transition < 0.5 ? 4 * transition * transition * transition : 1 - pow(-2 * transition + 2, 3) * 0.5;
                    posoffset = mix(posoffset, posoffset2, transition);
                    break;
                case 3: //4-point bezier
                    //third point
                    id = (id+nvertices) % nids;
                    index = getvert(topleft, size.x, height+vph+vth, id, compression);
                    vec3 posoffset3 = getpos(topleft, size.x, height, index.x);
                    //fourth point
                    id = (id+nvertices) % nids;
                    index = getvert(topleft, size.x, height+vph+vth, id, compression);
                    vec3 posoffset4 = getpos(topleft, size.x, height, index.x);
                    //bezier
                    posoffset = bezier(posoffset, posoffset2, posoffset3, posoffset4, transition);
                    break;
            }
        }
        transition = 0;
        texCoord = getuv(topleft, size.x, height+vph, index.y);
//custom entity rotation
#ifdef ENTITY
        posoffset *= scale;
        if (isGUI == 1) {
            posoffset *= 24;
            posoffset.y += 4;
            posoffset.zy *= -1;
            posoffset = rotate(rotation + vec3(0,1,0)) * posoffset;
        }
        if (isHand == 1) {
            posoffset.zx *= -1;
            posoffset = (vec4(posoffset,0) * ModelViewMat).xyz;
        }
        if (isHand + isGUI == 0) {
            if (any(greaterThan(autorotate,vec2(0)))) {
                //normal estimated rotation calculation from The Der Discohund
                vec3 vPos0 = subgroupQuadBroadcast(Pos, 0);
                vec3 vPos1 = subgroupQuadBroadcast(Pos, 1);
                vec3 vPos2 = subgroupQuadBroadcast(Pos, 3);
                float scale = distance(vPos0, vPos1);
                vPos1 = normalize(vPos0 - vPos1);
                vPos2 = normalize(vPos0 - vPos2);
                mat3 fullRotation = mat3(vPos2, vPos1, cross(vPos2, vPos1));
                posoffset = scale * fullRotation * posoffset;
            }
        }
    }
#endif
#ifdef BLOCK
    }
#endif
    //final pos and uv
    Pos = subgroupQuadBroadcast(Pos, 2) + posoffset;
    texCoord = (vec2(topleft.x,topleft.y+headerheight) + texCoord*size)/atlasSize
                //make sure that faces with same uv beginning/ending renders
                + vec2(onepixel.x*0.0001*corner,onepixel.y*0.0001*((corner+1)%4));

    // ===========================================================
    // DEBUG MODE (ENTITY only — block/terrain shaders don't define
    // overlayColor/isGUI/isHand so we can't visualize there).
    // Uncomment one of the blocks below to visualize a shader value
    // as pixel color. Take screenshots, read RGB values, decode back
    // via tools/decode_pixel.js.
    // ===========================================================
    //
    // Encoding scheme: each channel maps a range [-X, +X] → [0, 255]
    // via:   byte = ((value + X) / (2*X)) * 255
    // Decode: value = (byte/255) * 2*X - X
    //
    // RANGE_HINT below sets X for each preset.
#ifdef ENTITY
    // Debug uses both vertexColor AND overlayColor to maximize the chance
    // the pipeline picks one of them up. lightColor.rgb is forced to 1 to
    // remove shadow modulation, while .a is left intact (zeroing it makes
    // the model invisible in some pipelines). Best results with a uniformly
    // white test texture, but RGB ratios are readable with any texture.
    #ifdef PER_FACE_LIGHTING
        #define OC_DBG_COLOR(c) \
            vertexPerFaceColorBack = (c); \
            vertexPerFaceColorFront = (c); \
            overlayColor = vec4((c).rgb, 1.0); \
            lightColor = vec4(1.0, 1.0, 1.0, lightColor.a)
    #else
        #define OC_DBG_COLOR(c) \
            vertexColor = (c); \
            overlayColor = vec4((c).rgb, 1.0); \
            lightColor = vec4(1.0, 1.0, 1.0, lightColor.a)
    #endif

    // ---- A1: Pos before ModelViewMat (object space) ----
    // RANGE_HINT = 32. Decode each channel: (byte/255)*64 - 32.
    // OC_DBG_COLOR(vec4(
    //     clamp((Pos.x + 32.0) / 64.0, 0.0, 1.0),
    //     clamp((Pos.y + 32.0) / 64.0, 0.0, 1.0),
    //     clamp((Pos.z + 32.0) / 64.0, 0.0, 1.0),
    //     1.0
    // ));

    // ---- A2: posoffset alone (encoded vertex offset from anchor) ----
    // RANGE_HINT = 16. Decode: (byte/255)*32 - 16.
    // OC_DBG_COLOR(vec4(
    //     clamp((posoffset.x + 16.0) / 32.0, 0.0, 1.0),
    //     clamp((posoffset.y + 16.0) / 32.0, 0.0, 1.0),
    //     clamp((posoffset.z + 16.0) / 32.0, 0.0, 1.0),
    //     1.0
    // ));

    // ---- A3: anchor (subgroupQuadBroadcast Pos[2]) only ----
    // RANGE_HINT = 32. Decode: (byte/255)*64 - 32.
    // vec3 dbg_anchor = subgroupQuadBroadcast(Pos - posoffset, 2);
    // OC_DBG_COLOR(vec4(
    //     clamp((dbg_anchor.x + 32.0) / 64.0, 0.0, 1.0),
    //     clamp((dbg_anchor.y + 32.0) / 64.0, 0.0, 1.0),
    //     clamp((dbg_anchor.z + 32.0) / 64.0, 0.0, 1.0),
    //     1.0
    // ));

    // ---- A4: slot detection (which render path is active) ----
    // R=1 → isGUI, G=1 → isHand, B=1 → neither (third-person / equipment / ground)
    // OC_DBG_COLOR(vec4(float(isGUI), float(isHand), float(1 - isGUI - isHand), 1.0));
#endif
}
//debug
//else {
//    posoffset = vec3(gl_VertexID % 4 - 2, gl_VertexID % 4 / 2 * 2, -(gl_VertexID % 4) + 2 * 2);
//    Pos += posoffset;
//    vertexColor = vec4(1.0,0.0,0.0,1.0);
//}