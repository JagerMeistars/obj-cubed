// Native Minecraft 26.3 SkullModel carriers; profile is supplied by Minecraft.
#include <objcubed:profile_geometry.glsl>
bool oc_native_profile(out vec3 result,out vec2 coord,out int unlit) {
#if OC_NATIVE_PROFILE_GEOMETRY
    if(textureSize(Sampler0,0)!=ivec2(64))return false;
    vec3 p[4];vec2 uv[4];oc_read_carrier(Position,UV0,p,uv);
    vec2 lo=uv[0],hi=uv[0];for(int i=1;i<4;i++){lo=min(lo,uv[i]);hi=max(hi,uv[i]);}
    int face=-1,id=0;vec3 origin=vec3(0);mat3 basis=mat3(0);
    if(all(lessThan(abs(lo-vec2(0.125000000,0.000000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.250000000,0.125000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d1/d3;float idf=32.0*(0.5*(sqrt(576.0+4.0*ratio)-40.0));id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[0]=(p[1]-p[0])/(-0.500000000*sizes[0]);basis[2]=(p[3]-p[0])/(-0.500000000*sizes[2]);float scale=length(basis[0]);basis[1]=cross(basis[2],basis[0])/scale;
        origin=p[0]-basis*(vec3(0.250000000,-0.500000000,0.250000000)*sizes);face=0;
    }
    else if(all(lessThan(abs(lo-vec2(0.250000000,0.000000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.375000000,0.125000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d1/d3;float idf=32.0*(0.5*(sqrt(576.0+4.0*ratio)-40.0));id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[0]=(p[1]-p[0])/(-0.500000000*sizes[0]);basis[2]=(p[3]-p[0])/(0.500000000*sizes[2]);float scale=length(basis[0]);basis[1]=cross(basis[2],basis[0])/scale;
        origin=p[0]-basis*(vec3(0.250000000,0.000000000,-0.250000000)*sizes);face=1;
    }
    else if(all(lessThan(abs(lo-vec2(0.000000000,0.125000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.125000000,0.250000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d3/d1;float idf=32.0*(ratio-8.0);id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[2]=(p[1]-p[0])/(0.500000000*sizes[2]);basis[1]=(p[3]-p[0])/(0.500000000*sizes[1]);float scale=length(basis[2]);basis[0]=cross(basis[1],basis[2])/scale;
        origin=p[0]-basis*(vec3(-0.250000000,-0.500000000,-0.250000000)*sizes);face=2;
    }
    else if(all(lessThan(abs(lo-vec2(0.125000000,0.125000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.250000000,0.250000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d1/d3;float idf=32.0*(ratio-32.0);id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[0]=(p[1]-p[0])/(-0.500000000*sizes[0]);basis[1]=(p[3]-p[0])/(0.500000000*sizes[1]);float scale=length(basis[0]);basis[2]=cross(basis[0],basis[1])/scale;
        origin=p[0]-basis*(vec3(0.250000000,-0.500000000,-0.250000000)*sizes);face=3;
    }
    else if(all(lessThan(abs(lo-vec2(0.250000000,0.125000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.375000000,0.250000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d3/d1;float idf=32.0*(ratio-8.0);id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[2]=(p[1]-p[0])/(-0.500000000*sizes[2]);basis[1]=(p[3]-p[0])/(0.500000000*sizes[1]);float scale=length(basis[2]);basis[0]=cross(basis[1],basis[2])/scale;
        origin=p[0]-basis*(vec3(0.250000000,-0.500000000,0.250000000)*sizes);face=4;
    }
    else if(all(lessThan(abs(lo-vec2(0.375000000,0.125000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.500000000,0.250000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d1/d3;float idf=32.0*(ratio-32.0);id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[0]=(p[1]-p[0])/(0.500000000*sizes[0]);basis[1]=(p[3]-p[0])/(0.500000000*sizes[1]);float scale=length(basis[0]);basis[2]=cross(basis[0],basis[1])/scale;
        origin=p[0]-basis*(vec3(-0.250000000,-0.500000000,0.250000000)*sizes);face=5;
    }
    else if(all(lessThan(abs(lo-vec2(0.625000000,0.000000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.750000000,0.125000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d1/d3;float idf=32.0*(0.5*(sqrt(576.0+4.0*ratio)-40.0));id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[0]=(p[1]-p[0])/(-0.531250000*sizes[0]);basis[2]=(p[3]-p[0])/(-0.531250000*sizes[2]);float scale=length(basis[0]);basis[1]=cross(basis[2],basis[0])/scale;
        origin=p[0]-basis*(vec3(0.265625000,-0.515625000,0.265625000)*sizes);face=6;
    }
    else if(all(lessThan(abs(lo-vec2(0.750000000,0.000000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.875000000,0.125000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d1/d3;float idf=32.0*(0.5*(sqrt(576.0+4.0*ratio)-40.0));id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[0]=(p[1]-p[0])/(-0.531250000*sizes[0]);basis[2]=(p[3]-p[0])/(0.531250000*sizes[2]);float scale=length(basis[0]);basis[1]=cross(basis[2],basis[0])/scale;
        origin=p[0]-basis*(vec3(0.265625000,0.015625000,-0.265625000)*sizes);face=7;
    }
    else if(all(lessThan(abs(lo-vec2(0.500000000,0.125000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.625000000,0.250000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d3/d1;float idf=32.0*(ratio-8.0);id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[2]=(p[1]-p[0])/(0.531250000*sizes[2]);basis[1]=(p[3]-p[0])/(0.531250000*sizes[1]);float scale=length(basis[2]);basis[0]=cross(basis[1],basis[2])/scale;
        origin=p[0]-basis*(vec3(-0.265625000,-0.515625000,-0.265625000)*sizes);face=8;
    }
    else if(all(lessThan(abs(lo-vec2(0.625000000,0.125000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.750000000,0.250000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d1/d3;float idf=32.0*(ratio-32.0);id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[0]=(p[1]-p[0])/(-0.531250000*sizes[0]);basis[1]=(p[3]-p[0])/(0.531250000*sizes[1]);float scale=length(basis[0]);basis[2]=cross(basis[0],basis[1])/scale;
        origin=p[0]-basis*(vec3(0.265625000,-0.515625000,-0.265625000)*sizes);face=9;
    }
    else if(all(lessThan(abs(lo-vec2(0.750000000,0.125000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(0.875000000,0.250000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d3/d1;float idf=32.0*(ratio-8.0);id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[2]=(p[1]-p[0])/(-0.531250000*sizes[2]);basis[1]=(p[3]-p[0])/(0.531250000*sizes[1]);float scale=length(basis[2]);basis[0]=cross(basis[1],basis[2])/scale;
        origin=p[0]-basis*(vec3(0.265625000,-0.515625000,0.265625000)*sizes);face=10;
    }
    else if(all(lessThan(abs(lo-vec2(0.875000000,0.125000000)),vec2(0.00001)))&&all(lessThan(abs(hi-vec2(1.000000000,0.250000000)),vec2(0.00001)))){
        float d1=length(p[1]-p[0]),d3=length(p[3]-p[0]);if(min(d1,d3)<0.000001)return false;float ratio=d1/d3;float idf=32.0*(ratio-32.0);id=int(round(idf));if(id<1 || id>4095 || abs(idf-float(id))>0.08)return false;
        vec3 sizes=vec3(32.0+float(id)/32.0,1.0,1.0/(8.0+float(id)/32.0));basis[0]=(p[1]-p[0])/(0.531250000*sizes[0]);basis[1]=(p[3]-p[0])/(0.531250000*sizes[1]);float scale=length(basis[0]);basis[2]=cross(basis[0],basis[1])/scale;
        origin=p[0]-basis*(vec3(-0.265625000,-0.515625000,0.265625000)*sizes);face=11;
    }
    vec3 target;if(face<0 || !oc_profile_geometry(id,face,OBJMC_VERTEX_ID%4,target,coord,unlit))return false;
#ifdef OC_NATIVE_PROFILE_NORMALS
    ocSmoothNormal=oc_normal_transform(basis,ocProfileNormal);
#endif
    result=origin+basis*target;return true;
#else
    return false;
#endif
}
