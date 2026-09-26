// AS1 stores one routed armor quad per texture/layer. Decode its animation in
// the vertex stage; the fragment stage only recovers the wearer's affine pose.
#ifndef OBJCUBED_PORTABLE_ARMOR_AFFINE_GLSL
#define OBJCUBED_PORTABLE_ARMOR_AFFINE_GLSL

// Flags: target part 0..7, vanilla face 0..5, original inner layer, no shadow.
vec4 oc_armor_as1_rect(int flags) {
    int part=flags&7, face=(flags>>3)&7;
    int kind=part==1?0:part==0?1:part<=3?2:3;
    vec2 origin=kind==0?vec2(0.0):kind==1?vec2(16.0):kind==2?vec2(40.0,16.0):vec2(0.0,16.0);
    float width=kind<2?8.0:4.0, height=kind==0?8.0:12.0, depth=kind==0?8.0:4.0;
    if(face==2) return vec4(origin+vec2(0.0,depth),origin+vec2(depth,depth+height));
    if(face==3) return vec4(origin+vec2(depth,depth),origin+vec2(depth+width,depth+height));
    if(face==4) return vec4(origin+vec2(depth+width,depth),origin+vec2(2.0*depth+width,depth+height));
    return vec4(origin+vec2(2.0*depth+width,depth),origin+vec2(2.0*depth+2.0*width,depth+height));
}

vec3 oc_armor_as1_offset(int target,bool innerLayer) {
    const vec3 offsets[8]=vec3[8](
        vec3(0.2925,-0.785,-0.175),vec3(0.2925,-0.045,-0.2925),
        vec3(0.2375,-0.66,-0.175),vec3(0.2375,0.16,-0.175),
        vec3(0.14,-0.765,-0.14),vec3(0.14,-0.015,-0.14),
        vec3(0.17,-0.804,-0.17),vec3(0.17,0.004,-0.17));
    return offsets[target]+(target==0&&innerLayer?vec3(-0.0293,0.0293,0.0293):vec3(0.0));
}

void oc_decode_armor_as1_quad(int quad,out OcDecodedVertex vertex[4],out int flags) {
    ivec2 ao=ivec2(0),atlasSize=textureSize(Sampler0,0);
    ivec4 t[8];
    for(int i=1;i<8;i++) t[i]=getmeta(ao,i);
    ivec4 route=getmeta(ao,27),em=getmeta(ao,20);
    int target=clamp(route.r,0,7),face=route.g;
    bool innerLayer=route.b!=0,left=target==3||target==5||target==7;
    int shadow=getb(t[6].r,7,1);
    int emission=face==3?em.r:face==5?em.g:face==2?em.b:em.a;
    if(emission>0) shadow=1;
    flags=target|(face<<3)|(innerLayer?64:0)|(shadow<<7);
    ivec2 size=ivec2(t[1].r*256+t[1].g,t[1].b*256+t[7].r);
    int nvertices=t[2].r*16777216+t[2].g*65536+t[2].b*256+t[7].g;
    int nframes=max(t[3].r*65536+t[3].g*256+t[3].b,1);
    int ntextures=max(t[3].a,1);
    float duration=max(float(t[4].r*65536+t[4].g*256+t[4].b),1.0);
    int positionRows=t[5].r*256+t[5].g,uvRows=t[5].b*256+t[7].b;
    float time=GameTime*24000.0;
    ivec3 control=ivec3(oc_control_color.rgb*255.0+0.5);
    int frame;
    if(all(equal(control,ivec3(255)))) {
        time=getb(t[4].a,6)?time+duration:0.0;
        frame=int(time*float(nframes)/duration)%nframes;
    } else {
        int code=(control.r%128)*65536+control.g*256+control.b;
        if(oc_control_color.r>0.5) time=float(code);
        else if(code>=32768) {
            int elapsed=(int(time)%24000-(code-32768)+24000)%24000;
            time=elapsed>=nframes-1?float(nframes-1):float(elapsed)+fract(time);
        } else time=time+duration-mod(float(code),duration);
        frame=min(int(time*float(nframes)/duration),nframes-1)%nframes;
    }
    int easing=getb(t[4].a,4,2);
    float fraction=fract(time*float(nframes)/duration);
    if(easing==2) fraction=fraction<0.5?4.0*fraction*fraction*fraction:1.0-pow(-2.0*fraction+2.0,3.0)*0.5;
    int headerRows=2+int(ceil(float(nvertices)*0.25/float(size.x)));
    int dataRow=headerRows+size.y*ntextures;
    int vertexRow=dataRow+positionRows+uvRows,uvRow=dataRow+positionRows;
    float textureBase=float(headerRows),nextBase=float(headerRows),blend=0.0;
    ivec4 texflags=ivec4(texelFetch(Sampler0,ivec2(5,1),0)*255.0+0.5);
    int bands=min(texflags.g,15);
    if(ntextures>1||bands>0) {
        ivec4 texmeta=ivec4(texelFetch(Sampler0,ivec2(4,1),0)*255.0+0.5);
        float frametime=max(float(texmeta.r*65536+texmeta.g*256+texmeta.b),1.0);
        float textureFrame=GameTime*24000.0/frametime;
        if(ntextures>1) {
            int textureIndex=int(textureFrame)%ntextures;
            textureBase+=float(textureIndex*size.y);
            nextBase+=float(((textureIndex+1)%ntextures)*size.y);
            blend=(texflags.r&1)==1?fract(textureFrame):0.0;
        } else {
            float midpoint=oc_face_v_mid(ao,size.x,vertexRow,uvRow,quad*4+frame*nvertices)*float(size.y);
            for(int b=0;b<bands;b++) {
                ivec4 start=ivec4(texelFetch(Sampler0,ivec2(6+2*b,1),0)*255.0+0.5);
                ivec4 end=ivec4(texelFetch(Sampler0,ivec2(7+2*b,1),0)*255.0+0.5);
                int y=start.r*256+start.g,height=start.b*256+end.r,count=max(end.g,1);
                if(midpoint>float(y)&&midpoint<float(y+height)) {
                    int index=int(textureFrame)%count;
                    textureBase-=float(index*height);
                    nextBase-=float(((index+1)%count)*height);
                    blend=(texflags.r&1)==1?fract(textureFrame):0.0;
                    break;
                }
            }
        }
    }
    vec3 offset=oc_armor_as1_offset(target,innerLayer);
    for(int corner=0;corner<4;corner++) {
        ivec2 indices=getvert(ao,size.x,vertexRow,quad*4+corner+frame*nvertices);
        vec3 position=getpos(ao,size.x,dataRow,indices.x);
        if(nframes>1&&easing>0) {
            vec3 next=getpos(ao,size.x,dataRow,getvert(ao,size.x,vertexRow,quad*4+corner+((frame+1)%nframes)*nvertices).x);
            if(easing==3) {
                vec3 third=getpos(ao,size.x,dataRow,getvert(ao,size.x,vertexRow,quad*4+corner+((frame+2)%nframes)*nvertices).x);
                vec3 fourth=getpos(ao,size.x,dataRow,getvert(ao,size.x,vertexRow,quad*4+corner+((frame+3)%nframes)*nvertices).x);
                position=bezier(position,next,third,fourth,fraction);
            } else position=mix(position,next,fraction);
        }
        position.y+=0.5;
        if(left) position.x=-position.x;
        vertex[corner].position=position-offset;
        vec2 uv=getuv(ao,size.x,uvRow,indices.y);
        vec2 jitter=vec2(0.0001*float(corner),0.0001*float((corner+1)%4))/vec2(atlasSize);
        vertex[corner].uv=(vec2(0.0,textureBase)+uv*vec2(size))/vec2(atlasSize)+jitter;
        vertex[corner].uv2=(vec2(0.0,nextBase)+uv*vec2(size))/vec2(atlasSize)+jitter;
        vertex[corner].blend=blend;
        vertex[corner].custom=1;vertex[corner].gui=0;vertex[corner].hand=0;
        vertex[corner].shadow=shadow;vertex[corner].overlay=vec4(1.0);
    }
}
#ifdef OC_PORTABLE_VERTEX
void oc_decode_armor_as1(out OcDecodedVertex vertex[4],out int flags) {
    oc_decode_armor_as1_quad(0,vertex,flags);
}
#else
// AS1 position-only carrier. Its UV rectangle and semantic corner order are
// already known from flat flags, so no UV values or UV derivatives are needed.
vec3 oc_armor_as1_read_position(vec4 p,vec3 high,out bool missing) {
    vec4 dx=dFdx(p),dy=dFdy(p);
    vec3 hx=dFdx(high),hy=dFdy(high);
    missing=abs(p.w)+abs(dx.w)+abs(dy.w)==0.0;
    if(missing) return vec3(0.0);
    if(abs(p.w)>0.00390625) {
        return p.xyz/p.w+round(high/p.w)*OC_PORTABLE_CELL_SIZE;
    }
    if(abs(dx.w)>abs(dy.w)) {
        return dx.xyz/dx.w+round(hx/dx.w)*OC_PORTABLE_CELL_SIZE;
    }
    return dy.xyz/dy.w+round(hy/dy.w)*OC_PORTABLE_CELL_SIZE;
}

bool oc_decode_armor_as1_carrier(out vec3 positions[4]) {
    bool missing0,missing1,missing2,missing3;
    positions[0]=oc_armor_as1_read_position(oc_p0,oc_high01.xyz,missing0);
    positions[1]=oc_armor_as1_read_position(oc_p1,vec3(oc_high01.w,oc_high12.xy),missing1);
    positions[2]=oc_armor_as1_read_position(oc_p2,vec3(oc_high12.zw,oc_high23.x),missing2);
    positions[3]=oc_armor_as1_read_position(oc_p3,oc_high23.yzw,missing3);
    // All four derivative reads precede validity tests and later pixel culls.
    if(int(missing0)+int(missing1)+int(missing2)+int(missing3)!=1) return false;
    if(missing0) positions[0]=positions[3]+positions[1]-positions[2];
    if(missing1) positions[1]=positions[0]+positions[2]-positions[3];
    if(missing2) positions[2]=positions[1]+positions[3]-positions[0];
    if(missing3) positions[3]=positions[2]+positions[0]-positions[1];
    return !any(isnan(positions[0]))&&!any(isinf(positions[0]))
        && !any(isnan(positions[1]))&&!any(isinf(positions[1]))
        && !any(isnan(positions[2]))&&!any(isinf(positions[2]))
        && !any(isnan(positions[3]))&&!any(isinf(positions[3]));
}

void oc_armor_as1_carrier_uvs(int flags) {
    vec4 rect=oc_armor_as1_rect(flags)/vec4(64.0,32.0,64.0,32.0);
    oc_carrier_uvs[0]=rect.zy;
    oc_carrier_uvs[1]=rect.xy;
    oc_carrier_uvs[2]=rect.xw;
    oc_carrier_uvs[3]=rect.zw;
}

bool oc_apply_armor_as1(int flags,vec3 localPos[4],vec2 uv[4],out OcDecodedVertex vertex[4]) {
    int target=flags&7,face=(flags>>3)&7;
    int kind=target==1?0:target==0?1:target<=3?2:3;
    bool left=target==3||target==5||target==7,innerLayer=(flags&64)!=0;
    // The AS1 proxy encoder uses semantic TR,TL,BL,BR, independent of arena ID.
    vec3 a0=oc_carrier_positions[0],a1=oc_carrier_positions[1];
    vec3 a2=oc_carrier_positions[2],a3=oc_carrier_positions[3];
    bool mirror=dot(cross(a0-a1,a0-a3),oc_source_normal)<0.0;
    float inflation=innerLayer?0.5:1.0;
    float scale=length(a0-a3)*16.0/(((kind==0?8.0:12.0)+2.0*inflation)*0.9235);
    bool reflected=scale>20.0;
    bool mirrored=kind<2?false:(mirror!=reflected);
    if(kind>=2&&left!=mirrored) return false;
    if(mirrored) {
        vec3 swap=a0;a0=a3;a3=swap;
        swap=a1;a1=a2;a2=swap;
    }
    vec3 e1=normalize(a0-a1),e2=normalize(a0-a3);
    e2=normalize(e2-dot(e2,e1)*e1);
    mat3 basis=left?mat3(-e1,-e2,-cross(e1,e2)):mat3(-e1,e2,-cross(e1,e2));
    if(reflected) basis[2]=-basis[2];
    mat3 rotation=face==5?mat3(-1.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,-1.0)
                 :face==2?mat3(0.0,0.0,-1.0,0.0,1.0,0.0,1.0,0.0,0.0)
                 :face==4?mat3(0.0,0.0,1.0,0.0,1.0,0.0,-1.0,0.0,0.0):mat3(1.0);
    basis*=rotation;
    vec3 normal=cross(e1,e2);
    if(reflected) normal=-normal;
    vec3 anchor=a2;
    if(face==2) anchor+=a0-a1;
    else if(face==5) anchor+=a0-a1-((target==0?2.0:1.0)*length(a0-a1)+(target==0?-1.0:0.0)*length(a0-a3))*normal;
    else if(face==4) anchor-=((target==0?0.5:1.0)*length(a0-a1)+(target==0?0.5:0.0)*length(a0-a3))*normal;
#ifdef PER_FACE_LIGHTING
    vec2 illumination=minecraft_compute_light(Light0_Direction,Light1_Direction,oc_source_normal);
    vertexPerFaceColorBack=minecraft_mix_light_separate(-illumination,vec4(1.0));
    vertexPerFaceColorFront=minecraft_mix_light_separate(illumination,vec4(1.0));
#elif defined(NO_CARDINAL_LIGHTING)
    vertexColor=vec4(1.0);
#else
    vertexColor=minecraft_mix_light(Light0_Direction,Light1_Direction,oc_source_normal,vec4(1.0));
#endif
    for(int i=0;i<4;i++) {
        int corner=mirrored?3-i:i;
        vertex[i].position=anchor+basis*(localPos[corner]*scale);
        vertex[i].uv=uv[corner];
        vertex[i].uv2=uv[corner]+vec2(0.0,oc_parameters.x);
        vertex[i].blend=oc_parameters.y;
        vertex[i].custom=1;vertex[i].gui=0;vertex[i].hand=0;
        vertex[i].shadow=(flags>>7)&1;vertex[i].overlay=vec4(1.0);
    }
    return true;
}
#endif
#endif
