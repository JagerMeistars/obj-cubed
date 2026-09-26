// Decode one armor carrier face for all four virtual vertices. Everything that
// belongs to the face (header, playback, routing and wearer transform) is shared.
// Minecraft 26.3 always uses the UV-layout armor addressing introduced in 26.2.
void oc_decode_armor(out OcDecodedVertex vertex[4]) {
#ifdef ENTITY
    ivec2 ao=ivec2(0);
    ivec4 t[14];
    for(int i=1;i<14;i++) t[i]=getmeta(ao,i);
    ivec2 atlasSize=textureSize(Sampler0,0);
    vec2 onepixel=1.0/vec2(atlasSize);
    ivec2 as=ivec2(t[1].r*256+t[1].g,t[1].b*256+t[7].r);
    int anv=t[2].r*16777216+t[2].g*65536+t[2].b*256+t[7].g;
    int anf=max(t[3].r*65536+t[3].g*256+t[3].b,1);
    int ant=max(t[3].a,1);
    float adur=max(float(t[4].r*65536+t[4].g*256+t[4].b),1.0);
    int avph=t[5].r*256+t[5].g;
    int avth=t[5].b*256+t[7].b;
    int shadow=getb(t[6].r,7,1);
    int nboxes=max(t[8].a,1);

    // The tint is a playback control word. Rebuild the original white armor
    // lighting once, rather than allowing its near-black control bytes to tint.
#ifdef PER_FACE_LIGHTING
    vec2 ocwl=minecraft_compute_light(Light0_Direction,Light1_Direction,oc_source_normal);
    vertexPerFaceColorBack=minecraft_mix_light_separate(-ocwl,vec4(1.0));
    vertexPerFaceColorFront=minecraft_mix_light_separate(ocwl,vec4(1.0));
#elif defined(NO_CARDINAL_LIGHTING)
    vertexColor=vec4(1.0);
#else
    vertexColor=minecraft_mix_light(Light0_Direction,Light1_Direction,oc_source_normal,vec4(1.0));
#endif

    float at=GameTime*24000.0;
    ivec3 control=ivec3(oc_control_color.rgb*255.0+0.5);
    int afr;
    if(all(equal(control,ivec3(255)))) {
        at=getb(t[4].a,6)?at+adur:0.0;
        afr=int(at*float(anf)/adur)%anf;
    } else {
        int atc=(control.r%128)*65536+control.g*256+control.b;
        if(oc_control_color.r>0.5) at=float(atc);
        else if(atc>=32768) {
            int ael=(int(at)%24000-(atc-32768)+24000)%24000;
            at=(ael>=anf-1)?float(anf-1):float(ael)+fract(at);
        } else at=at+adur-mod(float(atc),adur);
        afr=min(int(at*float(anf)/adur),anf-1)%anf;
    }
    int easing=getb(t[4].a,4,2);
    float atr=fract(at*float(anf)/adur);
    if(easing==2) atr=atr<0.5?4.0*atr*atr*atr:1.0-pow(-2.0*atr+2.0,3.0)*0.5;

    vec2 T0=oc_carrier_uvs[0],T1=oc_carrier_uvs[1];
    vec2 T2=oc_carrier_uvs[2],T3=oc_carrier_uvs[3];
    vec2 qmid=(min(min(T0,T1),min(T2,T3))+max(max(T0,T1),max(T2,T3)))*0.5;
    ivec2 pf=oc_armor_uvface(qmid*vec2(64.0,32.0));
    int f6=pf.y;
    if(f6<2) discard; // Unused caps and non-humanoid UV rectangles.
    vec3 P0=oc_carrier_positions[0],P1=oc_carrier_positions[1];
    vec3 P2=oc_carrier_positions[2],P3=oc_carrier_positions[3];
    vec3 a0=((T0.x>qmid.x)&&(T0.y<qmid.y))?P0:((T1.x>qmid.x)&&(T1.y<qmid.y))?P1:((T2.x>qmid.x)&&(T2.y<qmid.y))?P2:P3;
    vec3 a1=((T0.x<qmid.x)&&(T0.y<qmid.y))?P0:((T1.x<qmid.x)&&(T1.y<qmid.y))?P1:((T2.x<qmid.x)&&(T2.y<qmid.y))?P2:P3;
    vec3 a2=((T0.x<qmid.x)&&(T0.y>qmid.y))?P0:((T1.x<qmid.x)&&(T1.y>qmid.y))?P1:((T2.x<qmid.x)&&(T2.y>qmid.y))?P2:P3;
    vec3 a3=((T0.x>qmid.x)&&(T0.y>qmid.y))?P0:((T1.x>qmid.x)&&(T1.y>qmid.y))?P1:((T2.x>qmid.x)&&(T2.y>qmid.y))?P2:P3;
    bool amirror=dot(cross(a0-a1,a0-a3),oc_source_normal)<0.0;
    bool innerLayer=false;
    for(int b=0;b<nboxes&&b<3;b++)
        if(t[8+b].b==4||t[8+b].b==5) { innerLayer=true; break; }
    float ainfl=innerLayer?0.5:1.0;
    float ascale=length(a0-a3)*16.0/(((pf.x==0?8.0:12.0)+2.0*ainfl)*0.9235);
    bool areflect=ascale>20.0;
    bool amir=pf.x<2?false:(amirror!=areflect);
    if(amir) {
        vec3 sw=a0;a0=a3;a3=sw;
        sw=a1;a1=a2;a2=sw;
    }
    int abody=-1;
    for(int b=0;b<nboxes&&b<3;b++) {
        int pt=t[8+b].b;
        int kind=pt==1?0:pt==0?1:pt<=3?2:3;
        bool left=pt==3||pt==5||pt==7;
        if(kind!=pf.x||(kind>=2&&left!=amir)) continue;
        if(t[8+b].r*256+t[8+b].g==65535&&t[11+b].r*256+t[11+b].g==65535) {
            ivec4 west=getmeta(ao,14+b),east=getmeta(ao,17+b);
            if(west.r*256+west.g==65535&&east.r*256+east.g==65535) continue;
        }
        abody=b;break;
    }
    if(abody<0) discard;
    ivec4 em=getmeta(ao,20+abody);
    int afk;
    int aemis;
    if(f6==3) { afk=t[8+abody].r*256+t[8+abody].g;aemis=em.r; }
    else if(f6==5) { afk=t[11+abody].r*256+t[11+abody].g;aemis=em.g; }
    else if(f6==2) { ivec4 m=getmeta(ao,14+abody);afk=m.r*256+m.g;aemis=em.b; }
    else { ivec4 m=getmeta(ao,17+abody);afk=m.r*256+m.g;aemis=em.a; }
    if(afk==65535) discard;
    if(aemis>0) shadow=1;
    int atarget=t[8+abody].b;
    if(atarget<0||atarget>7) atarget=0;
    bool aleft=atarget==3||atarget==5||atarget==7;
    const vec3 AOFF[8]=vec3[8](
        vec3(0.2925,-0.785,-0.175),vec3(0.2925,-0.045,-0.2925),
        vec3(0.2375,-0.66,-0.175),vec3(0.2375,0.16,-0.175),
        vec3(0.14,-0.765,-0.14),vec3(0.14,-0.015,-0.14),
        vec3(0.17,-0.804,-0.17),vec3(0.17,0.004,-0.17));
    vec3 aoff=AOFF[atarget];
    if(atarget==0&&innerLayer) aoff+=vec3(-0.0293,0.0293,0.0293);
    vec3 e1=normalize(a0-a1),e2=normalize(a0-a3);
    e2=normalize(e2-dot(e2,e1)*e1);
    mat3 abasis=aleft?mat3(-e1,-e2,-cross(e1,e2)):mat3(-e1,e2,-cross(e1,e2));
    if(areflect) abasis[2]=-abasis[2];
    mat3 CF=f6==5?mat3(-1.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,-1.0)
           :f6==2?mat3(0.0,0.0,-1.0,0.0,1.0,0.0,1.0,0.0,0.0)
           :f6==4?mat3(0.0,0.0,1.0,0.0,1.0,0.0,-1.0,0.0,0.0):mat3(1.0);
    mat3 abasisBox=abasis*CF;
    vec3 n=cross(e1,e2);
    if(areflect) n=-n;
    vec3 anchor=a2;
    if(f6==2) anchor+=a0-a1;
    else if(f6==5) anchor+=a0-a1-((atarget==0?2.0:1.0)*length(a0-a1)+(atarget==0?-1.0:0.0)*length(a0-a3))*n;
    else if(f6==4) anchor-=((atarget==0?0.5:1.0)*length(a0-a1)+(atarget==0?0.5:0.0)*length(a0-a3))*n;

#ifdef OC_PORTABLE_ARMOR_BOUNDS
    vec2 screenPoint=vec2(oc_p1.w+oc_p2.w,oc_p2.w+oc_p3.w)*2.0-1.0;
    if(!oc_armor_bounds_hit(as.x,afk,anchor,abasisBox,ascale,aoff,aleft,screenPoint)) discard;
#endif

    int ahh=2+int(ceil(float(anv)*0.25/float(as.x)));
    int ah=ahh+as.y*ant;
    int vertexRows=ah+avph+avth;
    int uvRows=ah+avph;
    float texBase=float(ahh),texNextBase=float(ahh),blend=0.0;
    bool secondUV=false;
    ivec4 texflags=ivec4(texelFetch(Sampler0,ivec2(5,1),0)*255.0+0.5);
    int anb=min(texflags.g,15);
    if(ant>1||anb>0) {
        ivec4 texmeta=ivec4(texelFetch(Sampler0,ivec2(4,1),0)*255.0+0.5);
        float frametime=max(float(texmeta.r*65536+texmeta.g*256+texmeta.b),1.0);
        float textureFrame=GameTime*24000.0/frametime;
        secondUV=true;
        if(ant>1) {
            int texframe=int(textureFrame)%ant;
            texBase+=float(texframe*as.y);
            texNextBase+=float(((texframe+1)%ant)*as.y);
            blend=(texflags.r&1)==1?fract(textureFrame):0.0;
        } else {
            float avmid=oc_face_v_mid(ao,as.x,vertexRows,uvRows,(afk*4)%anv+afr*anv)*float(as.y);
            for(int b=0;b<anb;b++) {
                ivec4 am6=ivec4(texelFetch(Sampler0,ivec2(6+2*b,1),0)*255.0+0.5);
                ivec4 am7=ivec4(texelFetch(Sampler0,ivec2(7+2*b,1),0)*255.0+0.5);
                int ay0=am6.r*256+am6.g;
                int afH=am6.b*256+am7.r;
                int afc=max(am7.g,1);
                if(avmid>float(ay0)&&avmid<float(ay0+afH)) {
                    int atf=int(textureFrame)%afc;
                    texBase-=float(atf*afH);
                    texNextBase-=float(((atf+1)%afc)*afH);
                    blend=(texflags.r&1)==1?fract(textureFrame):0.0;
                    break;
                }
            }
        }
    }

    for(int i=0;i<4;i++) {
        vec2 UV0=oc_carrier_uvs[i];
        int ac=UV0.x<qmid.x?(UV0.y<qmid.y?1:2):(UV0.y<qmid.y?0:3);
        if(amir) ac=3-ac;
        int avbase=(afk*4+ac)%anv;
        ivec2 ai=getvert(ao,as.x,vertexRows,avbase+afr*anv);
        vec3 posoffset=getpos(ao,as.x,ah,ai.x);
        if(anf>1&&easing>0) {
            vec3 po2=getpos(ao,as.x,ah,getvert(ao,as.x,vertexRows,avbase+((afr+1)%anf)*anv).x);
            if(easing==3) {
                vec3 po3=getpos(ao,as.x,ah,getvert(ao,as.x,vertexRows,avbase+((afr+2)%anf)*anv).x);
                vec3 po4=getpos(ao,as.x,ah,getvert(ao,as.x,vertexRows,avbase+((afr+3)%anf)*anv).x);
                posoffset=bezier(posoffset,po2,po3,po4,atr);
            } else posoffset=mix(posoffset,po2,atr);
        }
        posoffset.y+=0.5;
        if(aleft) posoffset.x=-posoffset.x;
        posoffset=(posoffset-aoff)*ascale;
        vertex[i].position=anchor+abasisBox*posoffset;
        vec2 auv=getuv(ao,as.x,uvRows,ai.y);
        vec2 ajit=vec2(onepixel.x*0.0001*float(ac),onepixel.y*0.0001*float((ac+1)%4));
        vertex[i].uv=(vec2(0.0,texBase)+auv*vec2(as))/vec2(atlasSize)+ajit;
        // Match the generic decoder's initial UV2 when no texture animation is
        // active. Its blend is zero, but keeping it avoids hidden differences.
        vertex[i].uv2=secondUV?(vec2(0.0,texNextBase)+auv*vec2(as))/vec2(atlasSize)+ajit:UV0;
        vertex[i].blend=blend;
        vertex[i].custom=1;
        vertex[i].gui=0;
        vertex[i].hand=0;
        vertex[i].shadow=shadow;
        vertex[i].overlay=vec4(1.0);
    }
#else
    discard;
#endif
}
