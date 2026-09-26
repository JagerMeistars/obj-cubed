// AB1: conservative bounds in raw getpos coordinates, before the armor affine
// transform. Legacy or narrow textures take the unchanged fragment path.
bool oc_armor_bounds_hit(int width,int face,vec3 anchor,mat3 basis,float scale,
                         vec3 offset,bool left,vec2 screenPoint) {
    ivec2 textureDimensions=textureSize(Sampler0,0);
    if(width<26||width!=textureDimensions.x) return true;
    ivec4 marker=ivec4(texelFetch(Sampler0,ivec2(23,0),0)*255.0+.5);
    if(marker.rgb!=ivec3(65,66,49)) return true;
    ivec4 rowBytes=ivec4(texelFetch(Sampler0,ivec2(24,0),0)*255.0+.5);
    ivec4 countBytes=ivec4(texelFetch(Sampler0,ivec2(25,0),0)*255.0+.5);
    int row=rowBytes.r*65536+rowBytes.g*256+rowBytes.b;
    int count=countBytes.r*65536+countBytes.g*256+countBytes.b;
    if(face<0||face>=count||abs(scale)<1e-8||row<=0||row>=textureDimensions.y) return true;
    if((face*6+5)/width>=textureDimensions.y-row) return true;
    vec3 lo,hi;
    for(int a=0;a<6;a++) {
        int index=face*6+a;
        ivec3 b=ivec3(texelFetch(Sampler0,ivec2(index%width,row+index/width),0).rgb*255.0+.5);
        float value=float(b.r*65536+b.g*256+b.b)/32768.0-256.0;
        if(a<3) lo[a]=value;else hi[a-3]=value;
    }
    mat4 inverseProjection=inverse(ProjMat*ModelViewMat);
    vec4 nearPoint=inverseProjection*vec4(screenPoint,1.0,1.0);
#ifdef RENDERPEARL_DEPTH_IS_ZERO_TO_ONE
    vec4 middlePoint=inverseProjection*vec4(screenPoint,.5,1.0);
#else
    vec4 middlePoint=inverseProjection*vec4(screenPoint,0.0,1.0);
#endif
    if(abs(nearPoint.w)<1e-20||abs(middlePoint.w)<1e-20) return true;
    vec3 worldOrigin=nearPoint.xyz/nearPoint.w;
    vec3 origin=transpose(basis)*(worldOrigin-anchor)/scale+offset;
    vec3 direction=transpose(basis)*(middlePoint.xyz/middlePoint.w-worldOrigin)/scale;
    if(left) { origin.x=-origin.x;direction.x=-direction.x; }
    origin.y-=.5;
    if(any(isnan(origin))||any(isnan(direction))||any(isinf(origin))||any(isinf(direction))) return true;
    if(dot(direction,direction)<1e-30) return true;
    // Inverse-matrix and anchor subtraction use float32. Keep a small extra
    // allowance that grows with cancellation, including distant/large carriers.
    float magnitude=(length(worldOrigin)+length(anchor))/abs(scale)+length(offset)+length(origin)+length(lo)+length(hi);
    float tolerance=.00002+magnitude*.000002;
    lo-=vec3(tolerance);hi+=vec3(tolerance);
    float first=0.0,last=1e30;
    for(int a=0;a<3;a++) {
        if(abs(direction[a])<1e-20) {
            if(origin[a]<lo[a]||origin[a]>hi[a]) return false;
        } else {
            float t0=(lo[a]-origin[a])/direction[a],t1=(hi[a]-origin[a])/direction[a];
            first=max(first,min(t0,t1));last=min(last,max(t0,t1));
            if(first>last) return false;
        }
    }
    return last>=0.0;
}
