#version 330
uniform sampler2D InSampler;
layout(location=0) out vec4 fragColor;
void main(){
 vec2 size=vec2(textureSize(InSampler,0));
 float rows=ceil(16384.0/size.x);
 // Centre-preserving uniform zoom hides the service rows. Filter only after
 // resolving UV metadata, so interpolation cannot corrupt the skin lookup.
 float zoom=max(1.0,size.y-2.0*rows)/size.y;
 vec2 source=vec2(0.5)+(gl_FragCoord.xy/size-vec2(0.5))*zoom;
 fragColor=texture(InSampler,source);
}
