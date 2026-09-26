// AS2 groups compatible opaque armor quads behind one carrier per body part.
// Bounds and source coordinates use the same animated geometry as AS1.
#ifdef OC_PORTABLE_VERTEX
void oc_armor_bvh_clock(out int frame,out int easing,out float fraction) {
    ivec4 t3=getmeta(ivec2(0),3),t4=getmeta(ivec2(0),4);
    int frames=max(t3.r*65536+t3.g*256+t3.b,1);
    float duration=max(float(t4.r*65536+t4.g*256+t4.b),1.0);
    float time=GameTime*24000.0;
    ivec3 control=ivec3(oc_control_color.rgb*255.0+.5);
    if(all(equal(control,ivec3(255)))) {
        time=getb(t4.a,6)?time+duration:0.0;
        frame=int(time*float(frames)/duration)%frames;
    } else {
        int code=(control.r%128)*65536+control.g*256+control.b;
        if(oc_control_color.r>.5) time=float(code);
        else if(code>=32768) {
            int elapsed=(int(time)%24000-(code-32768)+24000)%24000;
            time=elapsed>=frames-1?float(frames-1):float(elapsed)+fract(time);
        } else time=time+duration-mod(float(code),duration);
        frame=min(int(time*float(frames)/duration),frames-1)%frames;
    }
    easing=getb(t4.a,4,2);
    fraction=fract(time*float(frames)/duration);
}
#else
int oc_armor_bvh_trace(vec2 screenPoint) {
    int flags=int(oc_parameters.z+.5),target=flags&7;
    bool left=target==3||target==5||target==7;
    vec3 canonical[4]=vec3[4](vec3(0.0),vec3(1.0,0.0,0.0),vec3(0.0,1.0,0.0),vec3(0.0,0.0,1.0));
    vec2 uv[4]=vec2[4](vec2(0.0),vec2(0.0),vec2(0.0),vec2(0.0));
    vec3 offset=oc_armor_as1_offset(target,(flags&64)!=0);
    for(int i=0;i<4;i++) {
        canonical[i].y+=.5;
        if(left) canonical[i].x=-canonical[i].x;
        canonical[i]-=offset;
    }
    OcDecodedVertex transformed[4];
    if(!oc_apply_armor_as1(flags,canonical,uv,transformed)) return -1;
    vec3 base=transformed[left?3:0].position;
    mat3 model=mat3(transformed[left?2:1].position-base,
                    transformed[left?1:2].position-base,
                    transformed[left?0:3].position-base);
    if(abs(determinant(model))<1e-16) return -1;
    // Subtract the near/middle points before adding the view translation.
    // A large wearer/preview translation can otherwise erase low direction
    // bits when two nearby world-space points are subtracted in float32.
    mat4 inverseProjection=inverse(ProjMat);
    mat4 inverseView=inverse(ModelViewMat);
    vec4 nearPoint=inverseProjection*vec4(screenPoint,1.0,1.0);
#ifdef RENDERPEARL_DEPTH_IS_ZERO_TO_ONE
    vec4 middlePoint=inverseProjection*vec4(screenPoint,.5,1.0);
#else
    vec4 middlePoint=inverseProjection*vec4(screenPoint,0.0,1.0);
#endif
    mat3 inverseModel=inverse(model);
    vec3 viewOrigin=nearPoint.xyz/nearPoint.w;
    vec3 worldOrigin=(inverseView*vec4(viewOrigin,1.0)).xyz;
    vec3 origin=inverseModel*(worldOrigin-base);
    vec3 direction=inverseModel*mat3(inverseView)*(middlePoint.xyz/middlePoint.w-viewOrigin);
    ivec2 top=ivec2(0);
    ivec4 t1=getmeta(top,1),t2=getmeta(top,2),t3=getmeta(top,3),t5=getmeta(top,5),t7=getmeta(top,7);
    int width=t1.r*256+t1.g,height=t1.b*256+t7.r;
    int vertices=t2.r*16777216+t2.g*65536+t2.b*256+t7.g;
    int frames=max(oc_bvh_int(t3),1),textures=max(t3.a,1);
    int positionRow=2+int(ceil(float(vertices)*.25/float(width)))+height*textures;
    int uvRow=positionRow+t5.r*256+t5.g,indexRow=uvRow+t5.b*256+t7.b;
    int bvhRow=oc_bvh_int(getmeta(top,28)),count=oc_bvh_int(getmeta(top,29));
    int segmentRow=oc_bvh_int(getmeta(top,30));
    int frame=int(oc_decoded_uv01.x+.5),easing=int(oc_decoded_uv01.y+.5);
    float fraction=oc_decoded_uv01.z,closest=1e30;
    int node=0,hit=-1;
    for(int visited=0;visited<count&&node<count;visited++) {
        int p=node*8;
        vec3 lo=vec3(oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p)),oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+1)),oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+2)));
        vec3 hi=vec3(oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+3)),oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+4)),oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+5)));
        int skip=oc_bvh_int(oc_bvh_bytes(top,width,bvhRow,p+6));
        if(!oc_bvh_box(origin,direction,lo,hi,closest)) { node=skip;continue; }
        if(segmentRow>0) {
            int q=(frame*count+node)*2;
            vec3 extent=hi-lo;
            vec3 segmentMin=lo+extent*vec3(oc_bvh_bytes(top,width,segmentRow,q).rgb)/255.0;
            vec3 segmentMax=lo+extent*vec3(oc_bvh_bytes(top,width,segmentRow,q+1).rgb)/255.0;
            if(!oc_bvh_box(origin,direction,segmentMin,segmentMax,closest)) { node=skip;continue; }
        }
        int face=oc_bvh_int(oc_bvh_bytes(top,width,bvhRow,p+7));
        if(face!=16777215) {
            vec3 v[4];
            for(int i=0;i<4;i++) v[i]=oc_bvh_position(top,width,positionRow,uvRow,indexRow,vertices,frames,face*4+i,frame,easing,fraction);
            float candidate=1e30;
            bool found=left?oc_bvh_triangle(origin,direction,v[3],v[2],v[1],candidate)
                           :oc_bvh_triangle(origin,direction,v[0],v[1],v[2],candidate);
            found=(left?oc_bvh_triangle(origin,direction,v[1],v[0],v[3],candidate)
                       :oc_bvh_triangle(origin,direction,v[2],v[3],v[0],candidate))||found;
            // Equal depth keeps the later source face, matching the order of
            // the opaque equipment layers before compaction.
            if(found&&(candidate<closest||(candidate==closest&&face>hit))) {
                closest=candidate;hit=face;
            }
        }
        node++;
    }
    return hit;
}
bool oc_decode_armor_bvh(int face,out OcDecodedVertex vertex[4]) {
    OcDecodedVertex local[4];int flags;
    oc_decode_armor_as1_quad(face,local,flags);
    vec3 position[4];vec2 uv[4];
    for(int i=0;i<4;i++) {position[i]=local[i].position;uv[i]=local[i].uv;}
    if(!oc_apply_armor_as1(flags,position,uv,vertex)) return false;
    int target=flags&7;
    bool left=target==3||target==5||target==7;
    for(int i=0;i<4;i++) {
        int corner=left?3-i:i;
        vertex[i].uv2=local[corner].uv2;
        vertex[i].blend=local[corner].blend;
    }
    return true;
}
#endif
