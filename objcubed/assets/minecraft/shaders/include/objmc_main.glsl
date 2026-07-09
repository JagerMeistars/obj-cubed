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
ivec4 t[16];
//read uv offset
t[0] = ivec4(texelFetch(Sampler0, uv, 0) * 255.0 + 0.5);
ivec2 uvoffset = ivec2(t[0].r*256 + t[0].g, t[0].b*256 + t[0].a);
//find and read topleft pixel
ivec2 topleft = uv - uvoffset;
//if topleft marker is correct
ivec4 marker = ivec4(texelFetch(Sampler0, topleft, 0)*255.0+0.5);
if (marker == ivec4(12,34,56,255)) {
    isCustom = 1;
    // Row 0: t[0..15]
    for (int i = 1; i < 16; i++) {
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
    //6: noshadow, autorotate, visibility, hasStaticDisplay, colorbehavior
    noshadow = getb(t[6].r, 7, 1);
    vec2 autorotate = vec2(getb(t[6].r, 6, 1), getb(t[6].r, 5, 1));
    bvec3 visibility = bvec3(getb(t[6].r, 4), getb(t[6].r, 3), getb(t[6].r, 2));
    bool hasStaticDisplay = getb(t[6].r, 1); //bit 1: any non-identity world display slot
    int colorbehavior = getb(t[6].r, 0, 1)*256 + t[6].g;

    //time in ticks
    float time = GameTime * 24000;
    //independent texture-animation clock (issue #9): not coupled to the
    //geometry-frame time, which gets reassigned below by tcolor/autoplay.
    float texTime = GameTime * 24000;
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
            int cR = int(Color.r*255.0+0.5);
            int cG = int(Color.g*255.0+0.5);
            int cB = int(Color.b*255.0+0.5);
            if (cR == 255 && cG == 255 && cB == 255) {
                tcolor = 0;
                autoplay = false;
            } else {
                // (cR%128) strips only the 0x800000 manual-mode flag bit, keeping
                // frame bits 16-22. The old decode multiplied cR by 65536 then took
                // it mod 32768 — identically 0, so frames >= 65536 wrapped mod 2^16.
                tcolor = (cR%128)*65536 + cG*256 + cB;
                autoplay = (Color.r <= 0.5);
            }
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
#ifdef ENTITY
        // GUI icons are baked ONCE into MC's gui item atlas at an arbitrary
        // GameTime, so an animated model's icon froze at whatever frame was
        // current on each resource reload. Pin the icon to frame 0 (time 0
        // also zeroes the interpolation mix below; texTime 0 likewise pins the
        // TEXTURE-animation clock to its first frame).
        if (isGUI == 1) { frame = 0; time = 0.0; texTime = 0.0; }
#endif
        //relative vertex id from unique face uv
        int id = (((uvoffset.y-2) * size.x) + uvoffset.x) * 4 + corner;
        id += frame * nvertices;
        //calculate height offsets
        headerheight = 2 + int(ceil(nvertices*0.25/size.x));
        int height = headerheight + (size.y * ntextures);
        //read data
        ivec2 index = getvert(topleft, size.x, height+vph+vth, id);
        posoffset = getpos(topleft, size.x, height, index.x);
        if (nframes > 1) {
            int nids = (nframes * nvertices);
            //next frame
            id = (id+nvertices) % nids;
            index = getvert(topleft, size.x, height+vph+vth, id);
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
                    index = getvert(topleft, size.x, height+vph+vth, id);
                    vec3 posoffset3 = getpos(topleft, size.x, height, index.x);
                    //fourth point
                    id = (id+nvertices) % nids;
                    index = getvert(topleft, size.x, height+vph+vth, id);
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
        // display-1:1 step B: GUI slot reproduces vanilla T*R*S at q16. Header
        // version lives in t[6].b (2 = q16 GUI layout); a stale PNG (old encoder
        // wrote 255 here) fails the gate and the GUI transform is skipped so it
        // cannot desync from this decode. q16 layout (2 bytes/axis, high,low):
        //   t[8]=(sxH,sxL,syH) t[9]=(syL,szH,szL)  scale  0..4
        //   t[10]=(txH,txL,tyH) t[11]=(tyL,tzH,tzL) trans -128..128 (1/16-block)
        //   t[12]=(rxH,rxL,ryH) t[13]=(ryL,rzH,rzL) rot   0..360 deg
        //   t[14]=(pxH,pxL,pyH) t[15]=(pyL,pzH,pzL) pivot -128..128 (model origin)
        if (isGUI == 1 && t[6].b == 2) {
            vec3 guiScale = vec3(
                float(t[8].r *256 + t[8].g) / 65535.0 * 4.0,
                float(t[8].b *256 + t[9].r) / 65535.0 * 4.0,
                float(t[9].g *256 + t[9].b) / 65535.0 * 4.0
            );
            vec3 guiTrans = vec3(
                float(t[10].r*256 + t[10].g) / 65535.0 * 256.0 - 128.0,
                float(t[10].b*256 + t[11].r) / 65535.0 * 256.0 - 128.0,
                float(t[11].g*256 + t[11].b) / 65535.0 * 256.0 - 128.0
            );
            vec3 guiRot = vec3(
                float(t[12].r*256 + t[12].g) / 65535.0 * 360.0,
                float(t[12].b*256 + t[13].r) / 65535.0 * 360.0,
                float(t[13].g*256 + t[13].b) / 65535.0 * 360.0
            );
            vec3 guiPivot = vec3(
                float(t[14].r*256 + t[14].g) / 65535.0 * 256.0 - 128.0,
                float(t[14].b*256 + t[15].r) / 65535.0 * 256.0 - 128.0,
                float(t[15].g*256 + t[15].b) / 65535.0 * 256.0 - 128.0
            );
            // Canonical vanilla rotation R = Rx(rx)*Ry(ry)*Rz(rz) (intrinsic XYZ),
            // identical r00..r22 to buildItemTransformMatrix — no per-axis sign
            // negation, no GUI-camera flip (see below).
            vec3 r = radians(guiRot);
            float cx = cos(r.x), sx = sin(r.x);
            float cy = cos(r.y), sy = sin(r.y);
            float cz = cos(r.z), sz = sin(r.z);
            float r00 =  cy*cz,            r01 = -cy*sz,            r02 =  sy;
            float r10 =  sx*sy*cz + cx*sz, r11 = -sx*sy*sz + cx*cz, r12 = -sx*cy;
            float r20 = -cx*sy*cz + sx*sz, r21 =  cx*sy*sz + sx*cz, r22 =  cx*cy;
            // mat3(c0,c1,c2): GLSL columns. Rv as columns.
            mat3 guiRotMat = mat3(
                vec3(r00, r10, r20),
                vec3(r01, r11, r21),
                vec3(r02, r12, r22)
            );
            // sz = slotTextureSize = baked 1-block placeholder edge (corners 0->1).
            float slotSize = distance(subgroupQuadBroadcast(Pos, 0),
                                      subgroupQuadBroadcast(Pos, 1));
            // Rotate the GUI display about guiPivot, supplied by the export dialog
            // (GUI Pivot X/Y/Z, BB units -> blocks in the decoded frame). This lets
            // the user dial the exact pivot to match BB's model-centre rotation
            // (the encoder defaults it to the model bbox centre when unset).
            vec3 m = (posoffset - guiPivot) * guiScale; // S about the chosen pivot
            m = guiRotMat * m;                          // R about the chosen pivot (vanilla XYZ)
            m += guiPivot + guiTrans / 16.0;            // restore + display T (1/16-block)
            // No constant Y term here (the old +0.5*slotSize "carrier compensation"
            // left the icon half a block LOW vs the same vanilla model — in-game
            // verified). The decoded frame is block-centre relative, so with
            // guiPivot defaulting to the origin this path is vanilla's
            // Sg*(R*S*v + T) with no leftover constants.
            // ---- GUI atlas framing (MC 26.1.2 GuiItemAtlas.drawToSlot) ----
            // Per slot MC bakes, INTO the vertex positions (ModelViewMat ~ identity
            // for the atlas pass):
            //   translate(slotCenter) * scale(sz,-sz,sz) * display.gui * translate(-0.5)
            // with sz = slotTextureSize = 16*guiScale. The subgroup anchor (corner 2,
            // read at line `Pos = subgroupQuadBroadcast(Pos,2)+posoffset`) is the baked
            // placeholder corner 2, so it ALREADY carries translate(slotCenter) and
            // scale(sz,-sz,sz). We only owe the per-vertex offset from that anchor.
            //
            // Derivation: anchor + posoffset must equal MC's baked vertex
            //   Tc*Sg*D*Tm*v. Since Tc is a pure translation it cancels in the
            //   difference, and Sg = scale(sz,-sz,sz) is linear, so
            //   posoffset = Sg * ( D*Tm*v  -  Tm*vph2 ) = Sg * (modelOffset_block).
            //   `m` above is exactly D*Tm*v in block units (S,R,T already applied,
            //   matching the verified world/hand path where raw block-unit posoffset
            //   is added to this same anchor and renders correctly). So in block
            //   units the offset is `m`; multiply componentwise by (sz,-sz,sz).
            //
            // (slotSize computed above.) Uniform *slotSize on ALL THREE axes keeps posoffset.z in the SAME
            // atlas-pixel/ortho(-1000..1000) units the baked anchor.z lives in, so
            // co-located faces get distinct gl_Position.z and LEQUAL+depthWrite
            // resolve them -> fixes the see-through (the old ad-hoc *64 on z, correct
            // only at guiScale 4, crushed the per-face z deltas).
            // The -slotSize on Y is MC's bake reflection scale(S,-S,S) that the old
            // code never applied (m*64 had +Y, then a flat y+=-64 that only shifts,
            // cannot un-mirror). Restoring this single Y reflection fixes upside-down
            // AND the X/Z rotation desync (a single reflection is what makes the
            // vanilla XYZ rotation compose correctly with the slot frame) AND matches
            // the fragment-shader GUI normal flip (objmc_light.glsl: isGUI -> z*=-1).
            // No y+=-64: the slot-center translate is already inside the anchor.
            // (The old +0.5*slotSize "carrier compensation" term here dated from the
            // era of the model.json -8 lifts; after the centre re-anchor moved into
            // the guiPivot/q16 math it left the icon half a block LOW vs vanilla.)
            posoffset = m * vec3(slotSize, -slotSize, slotSize);
            // guiRotMat stays plain vanilla Rv (no F flip, no zx axis flip).
        }
        if (isHand == 1) {
            // MC 26.1.2 bakes display into the carrier vertices (ModelViewMat ~ identity),
            // so the old `posoffset * ModelViewMat` became a no-op and hands ignored
            // display rotation+scale. Rebuild rotation+scale from the baked carrier edges
            // (same as the world path): the 1-block placeholder edge is 1.0 in block units
            // at scale 1, so each baked edge length IS display.scale on that axis. Apply
            // scale in model space then the orthonormal rotation. Translation still rides
            // the baked anchor (corner 2); the hand pose still rides gl_Position's ModelView.
            vec3 hp0 = subgroupQuadBroadcast(Pos, 0);
            vec3 hex = hp0 - subgroupQuadBroadcast(Pos, 1);
            vec3 hey = hp0 - subgroupQuadBroadcast(Pos, 3);
            float hsx = length(hex), hsy = length(hey);
            vec3 hux = normalize(hex);
            vec3 huy = normalize(hey - dot(hey, hux) * hux);
            mat3 hrot = mat3(huy, hux, cross(huy, hux));
            // UNIFORM scale (see world path): the flat placeholder only exposes 2 in-plane
            // edges, so per-axis scale can't be recovered post-bake; average them.
            // Per-axis scale: ex=+Y edge (len hsx=Sy), ey=+X edge (len hsy=Sx). The matrix
            // maps posoffset.x->X dir, .y->Y dir, so scale .x by Sx=hsy, .y by Sy=hsx. Z is
            // perpendicular to the flat placeholder (unmeasurable) -> min(Sx,Sy), which is
            // exact for uniform and single-axis (X- or Y-only) stretches. A DISTINCT
            // depth (Z) scale can't be measured from the flat carrier — it rides the
            // v2 slot marker instead (see the world path): the carrier UV's U midpoint
            // encodes a slot id, and dynamic ids 1..4 carry the exact q16 Z scale in
            // row-1 pixels 0..3. Neutral/legacy falls back to min(Sx, Sy).
            //
            // NO constant re-anchor here: the decoded model is already BLOCK-CENTRE
            // relative (in-game verified: with model.json lifts at 0 and no offset,
            // firstperson matches the same vanilla model exactly, rotations included;
            // an extra -0.5 fold sat every hand slot half a block low).
            ivec4 hflags = ivec4(texelFetch(Sampler0, topleft + ivec2(5,1), 0) * 255.0 + 0.5);
            float humid = (subgroupQuadBroadcast(UV0.x, 0) + subgroupQuadBroadcast(UV0.x, 2))
                          * 0.5 * float(atlasSize.x);
            float handsz = min(hsx, hsy);
            if (hflags.b == 1) {
                int hslot = clamp(int(round((fract(humid) - 0.5) / 0.035)), 0, 8);
                if (hslot >= 1) {
                    int hdynx = (hslot <= 4) ? (hslot - 1) : (6 + 2*hflags.g + (hslot - 5));
                    ivec4 hdyn = ivec4(texelFetch(Sampler0, topleft + ivec2(hdynx, 1), 0) * 255.0 + 0.5);
                    float hszq = float(hdyn.r*256 + hdyn.g) / 65535.0 * 4.0;
                    if (hszq > 0.0) handsz = hszq;
                }
            }
            posoffset = hrot * (posoffset * vec3(hsy, hsx, handsz));
        }
        if (isHand + isGUI == 0) {
            // World path: rebuild the model's orientation from the baked carrier
            // basis so it follows its render transform — item-frame mounting
            // (wall/floor/ceiling) + RMB, entity rotation, display R*S, etc.
            //
            // UNCONDITIONAL now (was gated on autorotate): the baked carrier edges
            // are the ONLY place the model.json display rotation/scale exists, so
            // without this a static thirdperson/head/fixed display rotation never
            // reached the model at all — and the centre re-anchor below must
            // rotate/scale with the display to match vanilla.
            //normal estimated rotation calculation from The Der Discohund
            vec3 vPos0 = subgroupQuadBroadcast(Pos, 0);
            vec3 vPos1 = subgroupQuadBroadcast(Pos, 1);
            vec3 vPos2 = subgroupQuadBroadcast(Pos, 3);
            // Baked carrier edges carry display ROTATION *and* SCALE (MC 26.1.2 bakes
            // display into the vertices). The 1-block placeholder edge is 1.0 in block
            // units at scale 1, so each baked edge length IS display.scale on that axis.
            vec3 ex = vPos0 - vPos1, ey = vPos0 - vPos2;
            float sx = length(ex), sy = length(ey);
            vPos1 = normalize(ex);
            vPos2 = normalize(ey - dot(ey, vPos1) * vPos1); // Gram-Schmidt
            mat3 fullRotation = mat3(vPos2, vPos1, cross(vPos2, vPos1));
            // Per-axis scale (see hand path): X,Y from the measured edges, Z (perpendicular,
            // unmeasurable) -> min(Sx,Sy) — exact for uniform + single-axis stretch.
            //
            // NO constant re-anchor (see hand path): the decoded model is already
            // block-centre relative — in-game verified with lifts 0: thirdperson and
            // item frames match the same vanilla model exactly.
            //
            // SLOT MARKER (v2): the carrier UV's U MIDPOINT encodes a slot id
            // (px + 0.5 + id*0.035; midpoints survive MC's anti-bleed UV shrink,
            // which contracts UVs symmetrically toward the quad centre). Id 0 =
            // neutral; ids 1..8 = dynamic per-slot entries carrying a q16 Z
            // display scale (0 = no override — the flat carrier only exposes
            // X/Y edges, so a distinct Z scale must ride the header) + the
            // +0.5-block dropped/shelf lift flag (their pipeline rides half a
            // block higher, and MC clamps ground display translation Y). Entry
            // pixels: ids 1..4 at row-1 x=0..3, ids 5..8 AFTER the atlas bands.
            // Legacy exports (no v2 flag at x=5.b) keep the old 0.65-mid rule.
            ivec4 vflags = ivec4(texelFetch(Sampler0, topleft + ivec2(5,1), 0) * 255.0 + 0.5);
            float umid = (subgroupQuadBroadcast(UV0.x, 0) + subgroupQuadBroadcast(UV0.x, 2))
                         * 0.5 * float(atlasSize.x);
            float mfrac = fract(umid);
            int slotid = (vflags.b == 1)
                ? clamp(int(round((mfrac - 0.5) / 0.035)), 0, 8)
                : ((mfrac > 0.575) ? -1 : 0);
            vec3 slotlift = (slotid == -1) ? vec3(0.0, 0.5, 0.0) : vec3(0.0); // legacy ground rule
            float slotsz = min(sx, sy);
            if (vflags.b == 1 && slotid >= 1) {
                int dynx = (slotid <= 4) ? (slotid - 1) : (6 + 2*vflags.g + (slotid - 5));
                ivec4 dyn = ivec4(texelFetch(Sampler0, topleft + ivec2(dynx, 1), 0) * 255.0 + 0.5);
                float szq = float(dyn.r*256 + dyn.g) / 65535.0 * 4.0;
                if (szq > 0.0) slotsz = szq;
                if ((dyn.b & 1) == 1) slotlift = vec3(0.0, 0.5, 0.0);
            }
            posoffset = fullRotation * ((posoffset + slotlift) * vec3(sy, sx, slotsz));
        }
    }
#endif
#ifdef BLOCK
    }
#endif
    //final pos and uv
    Pos = subgroupQuadBroadcast(Pos, 2) + posoffset;
    //per-corner jitter so faces with identical uv begin/end still render
    vec2 uvjit = vec2(onepixel.x*0.0001*corner, onepixel.y*0.0001*((corner+1)%4));
    //texCoord*size is the per-frame uv (in pixels) inside one frame region.
    vec2 texuvpx = texCoord*size;
    if (ntextures > 1) {
        //independent texture clock (issue #9): step the sampled frame region by
        //texframe*size.y. fade flag (row 1, x=5.r) cross-fades on item/GUI.
        ivec4 texmeta  = ivec4(texelFetch(Sampler0, topleft + ivec2(4,1), 0) * 255.0 + 0.5);
        ivec4 texflags = ivec4(texelFetch(Sampler0, topleft + ivec2(5,1), 0) * 255.0 + 0.5);
        float texFrametime = max(float(texmeta.r*65536 + texmeta.g*256 + texmeta.b), 1.0);
        // x=5.r packs fade in BIT 0 (bits 1..4 = dynamic-marker count) -- bool()
        // of the whole byte turned cross-fade on for any model with dynamic slots.
        bool  texFade = (texflags.r & 1) == 1;
        int   texframe = int(texTime / texFrametime) % ntextures;
        int   texnext  = (texframe + 1) % ntextures;
        vec2 base  = vec2(topleft.x, topleft.y + headerheight + texframe*size.y);
        vec2 base2 = vec2(topleft.x, topleft.y + headerheight + texnext *size.y);
        texCoord  = (base  + texuvpx)/atlasSize + uvjit;
        texCoord2 = (base2 + texuvpx)/atlasSize + uvjit;
        transition = texFade ? fract(texTime / texFrametime) : 0.0;
    } else {
        // Atlas texture animation (animated strips inside a stitched atlas).
        // Row-1 x=5.g holds the band COUNT (0..4); only faces whose sampled
        // atlas ROW falls inside one of the bands [y0, y0+frameH) cycle — the
        // rest of the atlas stays static.
        ivec4 aaf = ivec4(texelFetch(Sampler0, topleft + ivec2(5,1), 0) * 255.0 + 0.5);
        int nbands = min(aaf.g, 15);
        if (nbands > 0) {
            ivec4 m4 = ivec4(texelFetch(Sampler0, topleft + ivec2(4,1), 0) * 255.0 + 0.5);
            float ft = max(float(m4.r*65536 + m4.g*256 + m4.b), 1.0);
            // Band test on the QUAD'S V MIDPOINT (subgroup corners 0+2), not the
            // per-vertex row: a face mapped exactly onto one frame has corners ON
            // both band edges, and a per-vertex test tears the quad (some corners
            // step to the next frame, others stay) — smeared UVs on animated faces.
            float vmid = (subgroupQuadBroadcast(texCoord.y, 0) + subgroupQuadBroadcast(texCoord.y, 2))
                         * 0.5 * float(size.y);
            float dy = 0.0, dy2 = 0.0;
            bool inBand = false;
            for (int b = 0; b < nbands; b++) {
                ivec4 m6 = ivec4(texelFetch(Sampler0, topleft + ivec2(6 + 2*b, 1), 0) * 255.0 + 0.5);
                ivec4 m7 = ivec4(texelFetch(Sampler0, topleft + ivec2(7 + 2*b, 1), 0) * 255.0 + 0.5);
                int y0 = m6.r*256 + m6.g;                // STORED frame-0 band start
                int fH = m6.b*256 + m7.r;
                int fc = max(m7.g, 1);
                if (vmid > float(y0) && vmid < float(y0 + fH)) {
                    int tf = int(texTime / ft) % fc;
                    int tn = (tf + 1) % fc;
                    // The atlas stores each texture V-FLIPPED (whole region), so
                    // image frame 0 (the TOP frame the model is UV-mapped to)
                    // lives at the BOTTOM of the strip region and later frames
                    // sit ABOVE it: step UP (negative row offset) per frame.
                    dy  = float(-tf * fH);
                    dy2 = float(-tn * fH);
                    inBand = true;
                    break;
                }
            }
            texCoord  = (vec2(topleft.x, topleft.y+headerheight) + texuvpx + vec2(0.0, dy ))/atlasSize + uvjit;
            texCoord2 = (vec2(topleft.x, topleft.y+headerheight) + texuvpx + vec2(0.0, dy2))/atlasSize + uvjit;
            transition = (inBand && ((aaf.r & 1) == 1)) ? fract(texTime / ft) : 0.0;
        } else {
            texCoord = (vec2(topleft.x,topleft.y+headerheight) + texuvpx)/atlasSize + uvjit;
        }
    }

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
    // Debug bypasses ALL lighting/texture/shadow paths by setting
    // isCustom = 2. The entity/item fragment shaders check for this
    // flag at the top of main() and emit overlayColor.rgb directly
    // — no texture sampling, no light/shadow mix, no fog. Result:
    // pixel RGB == debug value, no distortion. Works with or without
    // "Без тени" set on the model.
    #define OC_DBG_COLOR(c) isCustom = 2; overlayColor = vec4((c).rgb, 1.0)

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

    // ---- A5: raw Position from VBO (before any objmc modification) ----
    // Shows what coord system Minecraft submits Position in per slot.
    // RANGE_HINT = 32. Decode: (byte/255)*64 - 32.
    // OC_DBG_COLOR(vec4(
    //     clamp((Position.x + 32.0) / 64.0, 0.0, 1.0),
    //     clamp((Position.y + 32.0) / 64.0, 0.0, 1.0),
    //     clamp((Position.z + 32.0) / 64.0, 0.0, 1.0),
    //     1.0
    // ));
#endif
}
#ifdef ENTITY
if (isCustom == 0) {
    ivec4 am = ivec4(texelFetch(Sampler0, ivec2(0,0), 0)*255.0+0.5);
    // 253 = box-packed armor (part id in t[8].b, nboxes in t[8].a). Legacy
    // marker-254 (chest-only) PNGs never wrote nboxes — decoding them here read
    // the GUI header alpha (255) as the box count and indexed far past t[16].
    // Legacy support removed: re-export old armor with the current plugin.
    if (am.rgb == ivec3(12,34,56) && am.a == 253) {
        isCustom = 1;
        // The dye tint on driven armor is the datapack CONTROL WORD (a small
        // frame/phase int ≈ black), not a color — it's decoded below, but the
        // wrapping vsh already baked Color into the vertex color, rendering the
        // whole piece black. Rebuild the vertex color with WHITE instead.
        #ifdef PER_FACE_LIGHTING
        vec2 ocwl = minecraft_compute_light(Light0_Direction, Light1_Direction, Normal);
        vertexPerFaceColorBack  = minecraft_mix_light_separate(-ocwl, vec4(1.0));
        vertexPerFaceColorFront = minecraft_mix_light_separate( ocwl, vec4(1.0));
        #elif defined(NO_CARDINAL_LIGHTING)
        vertexColor = vec4(1.0);
        #else
        vertexColor = minecraft_mix_light(Light0_Direction, Light1_Direction, Normal, vec4(1.0));
        #endif
        ivec2 ao = ivec2(0);
        for (int i = 1; i < 14; i++) t[i] = getmeta(ao, i); // t[8..10] north+part, t[11..13] south
        ivec2 as = ivec2(t[1].r*256+t[1].g, t[1].b*256+t[7].r);
        int anv = t[2].r*16777216+t[2].g*65536+t[2].b*256+t[7].g;
        int anf = max(t[3].r*65536+t[3].g*256+t[3].b, 1);
        int ant = max(t[3].a, 1);
        float adur = max(float(t[4].r*65536+t[4].g*256+t[4].b), 1.0);
        bool aap = getb(t[4].a, 6);
        int avph = t[5].r*256+t[5].g;
        int avth = t[5].b*256+t[7].b;
        noshadow = getb(t[6].r, 7, 1);
        float at = GameTime * 24000.0;
        // Datapack playback control rides the DYE tint: equipment layers are
        // exported dyeable (undyed renders white = no override -> header
        // autoplay), the datapack stores the control word in minecraft:dyed_color.
        // Decode mirrors the item colorbehavior-73 path; Color is otherwise
        // unused for custom armor (the fragment tints by overlayColor).
        int acr = int(Color.r*255.0+0.5);
        int acg = int(Color.g*255.0+0.5);
        int acb = int(Color.b*255.0+0.5);
        int afr;
        if (acr == 255 && acg == 255 && acb == 255) {
            at = aap ? at + adur : 0.0;
            afr = int(at * float(anf) / adur) % anf;
        } else {
            int atc = (acr%128)*65536 + acg*256 + acb;
            if (Color.r > 0.5) {                        // manual: freeze at frame atc
                at = float(atc);
            } else if (atc >= 32768) {                  // play_once from tick atc-32768
                int ael = (int(at) % 24000 - (atc - 32768) + 24000) % 24000;
                at = (ael >= anf - 1) ? float(anf - 1) : float(ael) + fract(at);
            } else {                                    // autoplay with phase offset
                at = at + adur - mod(float(atc), adur);
            }
            afr = min(int(at * float(anf) / adur), anf - 1) % anf;
        }
        // Target body part: marker-253 exports put the part id in t[8].b.
        // Out-of-range clamps to chest (0).
        // BOX-PACKING: MC submits this slot's carrier as `nboxes` cube boxes (chest 3 =
        // body+arms, head/feet 2, legs 3). Each equipment LAYER packs TWO model faces per
        // box -- onto its NORTH and SOUTH carrier face -- so up to 2*nboxes faces ride a
        // single draw (was one draw per face). Per box abody: NORTH face index in
        // t[8+abody].r:g, body part in .b, SOUTH face index in t[11+abody].r:g.
        // t[8].a = nboxes. A missing face index is 65535 (that carrier face is culled).
        int nboxes = max(t[8].a, 1);
        int amod = nboxes * 24;                 // 6 faces * 4 corners per box
        // MC 26.2 moved entity geometry into shared vertex arenas with
        // per-frame base offsets — gl_VertexID-derived indices became garbage
        // (armor cubes scattered and jumped between frames). Everything is
        // derived from the humanoid UV LAYOUT instead on 26.2+, which is
        // version-gated in-shader: 26.2 also introduced the reversed depth
        // buffer, whose projection has ProjMat[2][2] >= 0 (classic is ~ -1).
        bool arev = ProjMat[2][2] > -0.5;
        int abody; int ac; int f6;
        float ascale = 1.0; bool areflect = false;
        vec3 a0; vec3 a1; vec3 a2; vec3 a3;
        if (!arev) {
            // 26.1.x: vertex order is submission order, 24 verts per box.
            int aid = gl_VertexID % amod;
            int aface = aid / 4;
            abody = aface / 6;
            ac = aid % 4;
            f6 = aface % 6;
            a0 = subgroupQuadBroadcast(Pos, 0);
            a1 = subgroupQuadBroadcast(Pos, 1);
            a2 = subgroupQuadBroadcast(Pos, 2);
            a3 = subgroupQuadBroadcast(Pos, 3);
        } else {
            // 26.2+: identify the face by its UV rect in the fixed humanoid
            // 64x32 layout; corner roles by UV-corner quadrant (emission-order
            // equivalents c0=TR c1=TL c2=BL c3=BR in uv space); side (left
            // limbs are X-mirrored -> reversed winding) via the Normal.
            vec3 P0 = subgroupQuadBroadcast(Pos, 0);
            vec3 P1 = subgroupQuadBroadcast(Pos, 1);
            vec3 P2 = subgroupQuadBroadcast(Pos, 2);
            vec3 P3 = subgroupQuadBroadcast(Pos, 3);
            vec2 T0 = subgroupQuadBroadcast(UV0, 0);
            vec2 T1 = subgroupQuadBroadcast(UV0, 1);
            vec2 T2 = subgroupQuadBroadcast(UV0, 2);
            vec2 T3 = subgroupQuadBroadcast(UV0, 3);
            vec2 qmid = (min(min(T0,T1),min(T2,T3)) + max(max(T0,T1),max(T2,T3))) * 0.5;
            ivec2 pf = oc_armor_uvface(qmid * vec2(64.0, 32.0));
            f6 = pf.y;
            a0 = ((T0.x>qmid.x)&&(T0.y<qmid.y))?P0:((T1.x>qmid.x)&&(T1.y<qmid.y))?P1:((T2.x>qmid.x)&&(T2.y<qmid.y))?P2:P3;
            a1 = ((T0.x<qmid.x)&&(T0.y<qmid.y))?P0:((T1.x<qmid.x)&&(T1.y<qmid.y))?P1:((T2.x<qmid.x)&&(T2.y<qmid.y))?P2:P3;
            a2 = ((T0.x<qmid.x)&&(T0.y>qmid.y))?P0:((T1.x<qmid.x)&&(T1.y>qmid.y))?P1:((T2.x<qmid.x)&&(T2.y>qmid.y))?P2:P3;
            a3 = ((T0.x>qmid.x)&&(T0.y>qmid.y))?P0:((T1.x>qmid.x)&&(T1.y>qmid.y))?P1:((T2.x>qmid.x)&&(T2.y>qmid.y))?P2:P3;
            ac = (UV0.x < qmid.x) ? ((UV0.y < qmid.y) ? 1 : 2) : ((UV0.y < qmid.y) ? 0 : 3);
            // Corner-role tables calibrated in-game (v7-v9 self-checks, 26.1.2):
            // unmirrored boxes: emission c0 = uv TOP-RIGHT quadrant, then CCW in
            // uv space (table above); mirrored (left-limb) boxes use the
            // point-reflected arrangement -> map roles 3-ac and swap positions
            // 0<->3, 1<->2. The winding sign below is for THIS ordering.
            bool amirror = dot(cross(a0 - a1, a0 - a3), Normal) < 0.0;
            // Wearer scale RELATIVE TO THE CALIBRATION WEARER: |a0-a3| is the box
            // HEIGHT edge (same for all 4 side faces); canonical = (8 head | 12
            // other + 2*inflation) * 0.9375 sixteenths. The 0.9375 is the player
            // model scale, baked into player carrier vertices (probed: player
            // chest 13.125, armor stand 14.0, both 26.1.x and 26.2) -- and AOFF
            // was calibrated raw on a player, so a 0.9375-player IS the unit
            // wearer: world players read ascale==1.0 exactly (the calibrated
            // look, untouched), the GUI preview reads ~80, stands 1.067.
            // Inner layer (leggings, CubeDeformation 0.5) iff the layer packs a leg;
            // pre-v0.7.0 exports zero empty boxes' part ids -> waist may read outer
            // (7% shrink); re-export fixes.
            float ainfl = 1.0;
            for (int b = 0; b < nboxes && b < 3; b++)
                if (t[8 + b].b == 4 || t[8 + b].b == 5) { ainfl = 0.5; break; }
            // 0.9235: theoretical 0.9375 (player bake) minus ~1.5% -- hand-calibrated
            // in-game 2026-07 (the probes saw the same ~1.5% on legs/feet; origin
            // unexplained, the knob absorbs it).
            ascale = length(a0 - a3) * 16.0 / (((pf.x == 0 ? 8.0 : 12.0) + 2.0 * ainfl) * 0.9235);
            // The inventory player preview (PiP) bakes a reflection (det<0,
            // vanilla scale(s,s,-s)) into Pos, but its Normals do NOT track the
            // pose (probed: body winding-vs-Normal flips with rotation), so the
            // winding test cannot detect the reflection. Infer it from scale
            // alone: the preview draws the player many-x scaled (~75 probed),
            // while world wearers cap at 15 (scale attr 16 * player 0.9375).
            // ponytail: ascale>20 heuristic -- a >20x-scaled world wearer on
            // 26.2 would decode inside-out.
            areflect = ascale > 20.0;
            // Head/body are NEVER mirrored by MC -- skip the winding test (it is
            // noise in the preview). Limb side-matching still needs it, and it
            // holds up there (probed: part ids land on the correct sides).
            bool amir = (pf.x < 2) ? false : (amirror != areflect);
            if (amir) {
                vec3 sw = a0; a0 = a3; a3 = sw;
                sw = a1; a1 = a2; a2 = sw;
                ac = 3 - ac;
            }
            // abody: the box in THIS layer whose part matches (kind, side).
            abody = -1;
            for (int b = 0; b < nboxes && b < 3; b++) {
                int pt = t[8 + b].b;
                int k2 = (pt == 1) ? 0 : (pt == 0) ? 1 : (pt <= 3) ? 2 : 3;
                bool lf = (pt == 3 || pt == 5 || pt == 7);
                if (k2 != pf.x || (k2 >= 2 && lf != amir)) continue;
                // Older exports zero the part id of boxes that pack no faces in
                // this layer (all 4 slots 65535) -- an empty box then reads as
                // "body" and shadows the real one. Skip fully-empty entries.
                if (t[8 + b].r * 256 + t[8 + b].g == 65535 && t[11 + b].r * 256 + t[11 + b].g == 65535) {
                    ivec4 mw = getmeta(ao, 14 + b);
                    ivec4 me = getmeta(ao, 17 + b);
                    if (mw.r * 256 + mw.g == 65535 && me.r * 256 + me.g == 65535) continue;
                }
                abody = b; break;
            }
        }
        // Pack rides 4 carrier faces per box: NORTH(3), SOUTH(5), WEST(2), EAST(4). Model-face
        // indices: t[8+abody] (north, .b = part), t[11+abody] (south), and -- read directly
        // since they overflow the t[16] array -- header texels 14+abody (west), 17+abody
        // (east). DOWN(0)/UP(1) are not packed (down is unrecoverable on square limb caps;
        // up/down anchors also depend on handedness, unlike the X/Z faces).
        int afk = 65535;
        int aemis = 0;                              // this carrier face's emissive level (0..15)
        if (abody >= 0 && abody < nboxes) {
            ivec4 em = getmeta(ao, 20 + abody);     // per-box emissive: r=N g=S b=W a=E
            if (f6 == 3) { afk = t[8 + abody].r * 256 + t[8 + abody].g; aemis = em.r; }
            else if (f6 == 5) { afk = t[11 + abody].r * 256 + t[11 + abody].g; aemis = em.g; }
            else if (f6 == 2) { ivec4 m = getmeta(ao, 14 + abody); afk = m.r * 256 + m.g; aemis = em.b; }
            else if (f6 == 4) { ivec4 m = getmeta(ao, 17 + abody); afk = m.r * 256 + m.g; aemis = em.a; }
        }
        int atarget = (abody >= 0 && abody < nboxes) ? t[8 + abody].b : 0;
        if (atarget < 0 || atarget > 7) atarget = 0;
        // MC renders left limbs (3/5/7) X-mirrored (CubeListBuilder.mirror); un-mirrored below.
        bool aleft = (atarget == 3 || atarget == 5 || atarget == 7);
        const vec3 AOFF[8] = vec3[8](
            // Per-part anchor offset, calibrated in-game (Y incl. the left-limb fudge).
            vec3(0.2925, -0.785,  -0.175),   // 0 chest
            vec3(0.2925, -0.045, -0.2925),  // 1 head
            vec3(0.2375,  -0.66,  -0.175),   // 2 right_arm
            vec3(0.2375,  0.16,   -0.175),   // 3 left_arm
            vec3(0.14,   -0.765,   -0.14),    // 4 right_leg
            vec3(0.14,   -0.015,   -0.14),    // 5 left_leg
            vec3(0.17,   -0.804, -0.17),    // 6 right_foot
            vec3(0.17,   0.004,  -0.17)     // 7 left_foot
        );
        // Perpendicular box dim as an inflation- & scale-robust linear combo of the carrier
        // quad's two measured edges |a0-a1|, |a0-a3|. Per part the coeffs are solved so
        // a+b=1 and a*inplane0 + b*inplane1 = perp (holds for any wearer scale AND any
        // armor-layer CubeDeformation grow). SOUTH needs depth (edges = W,H): body (2,-1),
        // square-section parts (1,0). EAST needs width (edges = depth,H): body (0.5,0.5),
        // square parts (1,0). NORTH/WEST need no perpendicular term.
        const float ADWs[8] = float[8]( 2.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0 );
        const float ADHs[8] = float[8]( -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 );
        const float ADWe[8] = float[8]( 0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0 );
        const float ADHe[8] = float[8]( 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 );
        // A6 debug: OC_DBG_COLOR(vec4(float(abody)/3.0, float(f6)/5.0, 0.0, 1.0));
        // Keep NORTH(3)/SOUTH(5)/WEST(2)/EAST(4) of each packed box; cull DOWN(0)/UP(1)+empty.
        if (f6 < 2 || abody < 0 || abody >= nboxes || afk == 65535) {
            Pos = vec3(9999.0);
        } else {
            // Per-face emissive: a face marked light_emission in BB renders fullbright.
            // noshadow==1 makes objmc_light skip all shading/lightmap for this face (it is
            // flat + per-face, so the 4 corners agree). Whole-piece "No Shadow" already set it.
            if (aemis > 0) noshadow = 1;
            int avid = (afk * 4 + ac) % anv;
            avid += afr * anv;
            int ahh = 2 + int(ceil(float(anv)*0.25/float(as.x)));
            int ah = ahh + (as.y * ant);
            ivec2 ai = getvert(ao, as.x, ah+avph+avth, avid);
            posoffset = getpos(ao, as.x, ah, ai.x);
            // Frame interpolation (geometry morph): blend toward the next frame with the
            // same easing as the item path (objmc_main.glsl ~149-178). Armor used to hard-
            // step (only the integer afr) -> no smooth animation AND no easing (easing lives
            // inside this mix). No-op for static armor (anf==1) / easing.x==0.
            ivec2 aeasing = ivec2(getb(t[4].a, 4, 2), getb(t[4].a, 2, 2));
            if (anf > 1 && aeasing.x > 0) {
                int avbase = (afk * 4 + ac) % anv;
                float atr = fract(at * float(anf) / adur);
                vec3 po2 = getpos(ao, as.x, ah, getvert(ao, as.x, ah+avph+avth, avbase + ((afr + 1) % anf) * anv).x);
                if (aeasing.x == 3) {
                    vec3 po3 = getpos(ao, as.x, ah, getvert(ao, as.x, ah+avph+avth, avbase + ((afr + 2) % anf) * anv).x);
                    vec3 po4 = getpos(ao, as.x, ah, getvert(ao, as.x, ah+avph+avth, avbase + ((afr + 3) % anf) * anv).x);
                    posoffset = bezier(posoffset, po2, po3, po4, atr);
                } else {
                    if (aeasing.x == 2) atr = atr < 0.5 ? 4.0 * atr * atr * atr : 1.0 - pow(-2.0 * atr + 2.0, 3.0) * 0.5;
                    posoffset = mix(posoffset, po2, atr);
                }
            }
            // Undo the encoder's -0.5 Y vertical-origin re-anchor IN THE DECODED
            // MODEL FRAME (the same frame the encoder subtracted it in), BEFORE
            // the left un-mirror / AOFF / carrier-basis rotation below. Armor
            // positions are part-relative + the -0.5; adding it back restores the
            // exact pre-convention part-relative bytes, so armor on entities is
            // unchanged while the ITEM view of the same PNG sits correctly.
            posoffset.y += 0.5;
            vec2 auv = getuv(ao, as.x, ah+avph, ai.y);          // per-vertex uv within one frame
            vec2 ajit = vec2(onepixel.x*0.0001*float(ac), onepixel.y*0.0001*float((ac+1)%4));
            texCoord = (vec2(0, ahh) + auv*vec2(as))/vec2(atlasSize) + ajit;
            // Animated TEXTURE (ant>1): step the sampled frame region + cross-fade on texFade,
            // mirroring the item path (entity.fsh mixes texCoord/texCoord2). Armor used to
            // sample frame 0 only -> texture animation was frozen on armor.
            if (ant > 1) {
                ivec4 texmeta  = ivec4(texelFetch(Sampler0, ao + ivec2(4,1), 0)*255.0+0.5);
                ivec4 texflags = ivec4(texelFetch(Sampler0, ao + ivec2(5,1), 0)*255.0+0.5);
                float texFrametime = max(float(texmeta.r*65536 + texmeta.g*256 + texmeta.b), 1.0);
                float texTime = GameTime * 24000.0;
                int texframe = int(texTime / texFrametime) % ant;
                int texnext  = (texframe + 1) % ant;
                texCoord  = (vec2(0, ahh + texframe*as.y) + auv*vec2(as))/vec2(atlasSize) + ajit;
                texCoord2 = (vec2(0, ahh + texnext *as.y) + auv*vec2(as))/vec2(atlasSize) + ajit;
                transition = ((texflags.r & 1) == 1) ? fract(texTime / texFrametime) : 0.0;
            } else {
                // Atlas texture-animation bands (mirror of the item path): only
                // faces whose V midpoint falls inside an animated strip's stored
                // frame-0 band cycle; frames step UP (regions are stored
                // V-flipped). x=5.g holds the band COUNT (0..4); the midpoint
                // decision keeps all 4 corners of a quad together.
                ivec4 aaf = ivec4(texelFetch(Sampler0, ao + ivec2(5,1), 0)*255.0+0.5);
                int anb = min(aaf.g, 15);
                if (anb > 0) {
                    ivec4 am4 = ivec4(texelFetch(Sampler0, ao + ivec2(4,1), 0)*255.0+0.5);
                    float aft = max(float(am4.r*65536 + am4.g*256 + am4.b), 1.0);
                    float atexTime = GameTime * 24000.0;
                    float avmid = (subgroupQuadBroadcast(auv.y, 0) + subgroupQuadBroadcast(auv.y, 2))
                                  * 0.5 * float(as.y);
                    float ady = 0.0, ady2 = 0.0;
                    bool aInBand = false;
                    for (int b = 0; b < anb; b++) {
                        ivec4 am6 = ivec4(texelFetch(Sampler0, ao + ivec2(6 + 2*b, 1), 0)*255.0+0.5);
                        ivec4 am7 = ivec4(texelFetch(Sampler0, ao + ivec2(7 + 2*b, 1), 0)*255.0+0.5);
                        int ay0 = am6.r*256 + am6.g;
                        int afH = am6.b*256 + am7.r;
                        int afc = max(am7.g, 1);
                        if (avmid > float(ay0) && avmid < float(ay0 + afH)) {
                            int atf = int(atexTime / aft) % afc;
                            int atn = (atf + 1) % afc;
                            ady  = float(-atf * afH);
                            ady2 = float(-atn * afH);
                            aInBand = true;
                            break;
                        }
                    }
                    texCoord  = (vec2(0, ahh) + auv*vec2(as) + vec2(0.0, ady ))/vec2(atlasSize) + ajit;
                    texCoord2 = (vec2(0, ahh) + auv*vec2(as) + vec2(0.0, ady2))/vec2(atlasSize) + ajit;
                    transition = (aInBand && ((aaf.r & 1) == 1)) ? fract(atexTime / aft) : 0.0;
                }
            }
            // Un-mirror left limbs: flip model X about its centre (geometry is centred)
            // BEFORE the offset, so there is no lateral shift; combined with the det(-1)
            // left basis this cancels MC's X-mirror — left reads the same way as right.
            if (aleft) posoffset.x = -posoffset.x;
            // WAIST: part-0 box on the LEGGINGS layer (this layer packs a leg).
            // AOFF[0] was calibrated on the chest-layer body box (CubeDeformation
            // 1.0); the leggings body box (0.5) has its anchor corner 0.5 model px
            // closer to the box centre on every axis. Model-frame signs (-x,+y,+z)
            // map through abasis to (+e1,+e2,-n) = toward centre. Theory value
            // 0.0293 = 0.5/16 * 0.9375; per-axis calibration knob.
            vec3 aoff = AOFF[atarget];
            if (atarget == 0) for (int b = 0; b < nboxes && b < 3; b++)
                if (t[8 + b].b == 4 || t[8 + b].b == 5) { aoff += vec3(-0.0293, 0.0293, 0.0293); break; }
            // ascale: model + AOFF are block units; the carrier (and thus the measured
            // anchor corners) is in wearer units. ==1.0 in world, no-op there.
            posoffset = (posoffset - aoff) * ascale;
            // Full 3D orientation from the carrier-quad corners (Der Discohund basis),
            // exactly like the world path above. This captures all THREE axes including
            // limb TWIST -- the 2-DOF normal method (ay/ap) lost the twist, so animated
            // arms/legs could not fully follow the swing.
            // (a0..a3 corner roles were resolved above: lane order on 26.1.x,
            // uv-quadrant roles on 26.2+ — both in the emission-order
            // arrangement the calibrated basis below expects.)
            vec3 e1 = normalize(a0 - a1);
            vec3 e2 = normalize(a0 - a3);
            e2 = normalize(e2 - dot(e2, e1) * e1);               // Gram-Schmidt
            // Left limbs (aleft) keep the negated up axis (e2) — the upright fix; the
            // X-mirror itself is cancelled by the posoffset.x flip above. Right/head/
            // chest use the calibrated basis unchanged.
            mat3 abasis = aleft
                ? mat3(-e1, -e2, -cross(e1, e2))   // left: up negated; X-mirror handled above
                : mat3(-e1,  e2, -cross(e1, e2));  // right/head/chest: calibrated, unchanged
            // Reflected pass: desired transform is R*abasis; R flips the measured
            // cross(e1,e2) sign, so R*abasis == the measured basis with column 2 negated.
            if (areflect) abasis[2] = -abasis[2];
            // STAGE 2: a model face can ride any of 4 carrier faces. Each needs (1) an
            // orientation correction C_F so it faces front like the north face, and (2) a
            // re-anchor onto the box's NORTH corner-2 so all overlay there. C_F and the
            // anchors are derived from MC's ModelPart$Cube geometry (jar-decoded) and
            // numerically verified to overlay north to ~1e-15 for every part, both
            // handedness, and any layer inflation. NORTH (f6==3) is byte-for-byte Stage 1.
            mat3 CF = (f6 == 5) ? mat3(-1.0, 0.0, 0.0,  0.0, 1.0, 0.0,  0.0, 0.0, -1.0)  // south
                    : (f6 == 2) ? mat3( 0.0, 0.0,-1.0,  0.0, 1.0, 0.0,  1.0, 0.0,  0.0)  // west
                    : (f6 == 4) ? mat3( 0.0, 0.0, 1.0,  0.0, 1.0, 0.0, -1.0, 0.0,  0.0)  // east
                    : mat3(1.0);                                                          // north
            mat3 abasisBox = abasis * CF;
            posoffset = abasisBox * posoffset;     // orient to carrier; faces front, upright
            vec3 n = cross(e1, e2);                 // outward face normal (unit)
            if (areflect) n = -n;                   // measured cross is inward under R
            vec3 anchor;
            if      (f6 == 3) anchor = a2;                          // north: the corner itself
            else if (f6 == 2) anchor = a2 + (a0 - a1);             // west:  +depth edge, no perp
            else if (f6 == 5) anchor = a2 + (a0 - a1)              // south: +width edge, -depth
                              - (ADWs[atarget]*length(a0 - a1) + ADHs[atarget]*length(a0 - a3)) * n;
            else              anchor = a2                          // east:  -width along normal
                              - (ADWe[atarget]*length(a0 - a1) + ADHe[atarget]*length(a0 - a3)) * n;
            Pos = anchor + posoffset;
        }
    }
}
#endif
//debug
//else {
//    posoffset = vec3(gl_VertexID % 4 - 2, gl_VertexID % 4 / 2 * 2, -(gl_VertexID % 4) + 2 * 2);
//    Pos += posoffset;
//    vertexColor = vec4(1.0,0.0,0.0,1.0);
//}
