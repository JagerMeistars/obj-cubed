// Opaque item BVH: one affine carrier per model, preserving the existing
// animated source vertices. Transparent models keep independent face draws.
ivec4 oc_bvh_bytes(ivec2 origin,int width,int row,int index) {
    return ivec4(texelFetch(Sampler0,origin+ivec2(index%width,row+index/width),0)*255.0+.5);
}
int oc_bvh_int(ivec4 b) { return b.r*65536+b.g*256+b.b; }
float oc_bvh_float(ivec4 b) {
    return float(oc_bvh_int(b))/32768.0-256.0;
}
bool oc_bvh_box(vec3 origin,vec3 direction,vec3 lo,vec3 hi,float closest) {
    float first=0.0,last=closest;
    for(int axis=0;axis<3;axis++) {
        if(abs(direction[axis])<1e-20) {
            if(origin[axis]<lo[axis] || origin[axis]>hi[axis]) return false;
        } else {
            float a=(lo[axis]-origin[axis])/direction[axis];
            float b=(hi[axis]-origin[axis])/direction[axis];
            first=max(first,min(a,b));last=min(last,max(a,b));
            if(first>last) return false;
        }
    }
    return last>=0.0;
}
bool oc_bvh_triangle(vec3 origin,vec3 direction,vec3 a,vec3 b,vec3 c,inout float closest) {
    vec3 e1=b-a,e2=c-a,p=cross(direction,e2);
    float d=dot(e1,p);
    if(abs(d)<1e-15) return false;
    vec3 t=origin-a;
    float u=dot(t,p)/d;
    if(u<0.0 || u>1.0) return false;
    vec3 q=cross(t,e1);
    float v=dot(direction,q)/d;
    if(v<0.0 || u+v>1.0) return false;
    float distance=dot(e2,q)/d;
    if(distance<0.0 || distance>=closest) return false;
    closest=distance;
    return true;
}
vec3 oc_bvh_position(ivec2 origin,int width,int positionRow,int uvRow,int indexRow,int nvertices,int nframes,int id,int frame,int easing,float fraction) {
    ivec2 ix=getvert(origin,width,indexRow,id+frame*nvertices);
    vec3 p=getpos(origin,width,positionRow,ix.x);
    if(nframes<=1 || easing==0) return p;
    int f1=(frame+1)%nframes;
    vec3 p1=getpos(origin,width,positionRow,getvert(origin,width,indexRow,id+f1*nvertices).x);
    if(easing==1) return mix(p,p1,fraction);
    if(easing==2) {
        float t=fraction<.5?4.0*fraction*fraction*fraction:1.0-pow(-2.0*fraction+2.0,3.0)*.5;
        return mix(p,p1,t);
    }
    vec3 p2=getpos(origin,width,positionRow,getvert(origin,width,indexRow,id+((frame+2)%nframes)*nvertices).x);
    vec3 p3=getpos(origin,width,positionRow,getvert(origin,width,indexRow,id+((frame+3)%nframes)*nvertices).x);
    return bezier(p,p1,p2,p3,fraction);
}
#ifndef OC_PORTABLE_ARMOR_ONLY
int oc_bvh_trace(OcItemAffine pose,ivec2 markerPixel,vec2 screenPoint) {
    vec3 canonical[4]=vec3[4](oc_decoded0.xyz,vec3(oc_decoded0.w,oc_decoded1.xy),vec3(oc_decoded1.zw,oc_decoded2.x),oc_decoded2.yzw);
    vec3 base=oc_item_affine_apply(pose,canonical[0]);
    mat3 model=mat3(oc_item_affine_apply(pose,canonical[1])-base,
                    oc_item_affine_apply(pose,canonical[2])-base,
                    oc_item_affine_apply(pose,canonical[3])-base);
    if(abs(determinant(model))<1e-16) return -1;
    // Subtract nearby ray points before the potentially large view translation.
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
    ivec4 offset=ivec4(texelFetch(Sampler0,markerPixel,0)*255.0+.5);
    ivec2 top=markerPixel-ivec2(offset.r*256+offset.g,offset.b*256+offset.a);
    ivec4 t1=getmeta(top,1),t2=getmeta(top,2),t3=getmeta(top,3),t5=getmeta(top,5),t7=getmeta(top,7);
    int width=t1.r*256+t1.g, height=t1.b*256+t7.r;
    int nvertices=t2.r*16777216+t2.g*65536+t2.b*256+t7.g;
    int nframes=max(oc_bvh_int(t3),1),ntextures=max(t3.a,1);
    int positionRow=2+int(ceil(float(nvertices)*.25/float(width)))+height*ntextures;
    int uvRow=positionRow+t5.r*256+t5.g;
    int indexRow=uvRow+t5.b*256+t7.b;
    int bvhRow=oc_bvh_int(getmeta(top,16));
    int count=oc_bvh_int(getmeta(top,17));
    int segmentRow=width>=22 && getmeta(top,20).rgb==ivec3(66,70,49)?oc_bvh_int(getmeta(top,21)):0;
    int frame=int(oc_decoded_uv01.x+.5),easing=int(oc_decoded_uv01.y+.5);
    float fraction=oc_decoded_uv01.z,closest=1e30;
    int node=0,hit=-1;
    for(int visited=0;visited<count && node<count;visited++) {
        int p=node*8;
        vec3 lo=vec3(oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p)),oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+1)),oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+2)));
        vec3 hi=vec3(oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+3)),oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+4)),oc_bvh_float(oc_bvh_bytes(top,width,bvhRow,p+5)));
        int skip=oc_bvh_int(oc_bvh_bytes(top,width,bvhRow,p+6));
        if(!oc_bvh_box(origin,direction,lo,hi,closest)) { node=skip;continue; }
        // Optional per-segment bounds stay conservative through interpolation,
        // but avoid testing the entire sweep of a moving wing at every frame.
        if(segmentRow>0) {
            int q=(frame*count+node)*2;
            vec3 relativeMin=vec3(oc_bvh_bytes(top,width,segmentRow,q).rgb)/255.0;
            vec3 relativeMax=vec3(oc_bvh_bytes(top,width,segmentRow,q+1).rgb)/255.0;
            vec3 extent=hi-lo;
            vec3 segmentMin=lo+extent*relativeMin;
            vec3 segmentMax=lo+extent*relativeMax;
            if(!oc_bvh_box(origin,direction,segmentMin,segmentMax,closest)) { node=skip;continue; }
        }
        int face=oc_bvh_int(oc_bvh_bytes(top,width,bvhRow,p+7));
        if(face!=16777215) {
            vec3 v[4];
            for(int i=0;i<4;i++) v[i]=oc_bvh_position(top,width,positionRow,uvRow,indexRow,nvertices,nframes,face*4+i,frame,easing,fraction);
            if(oc_bvh_triangle(origin,direction,v[0],v[1],v[2],closest)) hit=face;
            if(oc_bvh_triangle(origin,direction,v[2],v[3],v[0],closest)) hit=face;
        }
        node++;
    }
    return hit;
}
#endif
