#version 330
uniform sampler2D InSampler;
layout(location=0) out vec4 fragColor;
void main(){
 ivec2 size=textureSize(InSampler,0);
 int bandRows=(16384+size.x-1)/size.x;
 ivec2 p=ivec2(gl_FragCoord.xy);
 vec4 c=texelFetch(InSampler,p,0);ivec4 b=ivec4(round(c*255.0));
 if(b.b>=240 && b.b<=247 && b.r<64 && b.g<64){
  int slot=b.b-240;
  int index=(slot%4)*4096+b.g*64+b.r;
  int origin=slot<4 ? 0 : size.y-bandRows;
  c=texelFetch(InSampler,ivec2(index%size.x,origin+index/size.x),0);c.a=1.0;
 }
 fragColor=c;
}
