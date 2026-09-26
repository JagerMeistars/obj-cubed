// Reject unused humanoid carrier faces before the full position payload or
// armor animation is decoded. The result is constant over one carrier face;
// retained faces still reach their position derivatives without pixel-varying
// control flow. A side-ambiguous limb is kept if EITHER side has a route.
bool oc_armor_carrier_used(vec4 weight,vec4 uv01,vec4 uv23) {
#ifdef ENTITY
    vec2 payload[4]=vec2[4](uv01.xy,uv01.zw,uv23.xy,uv23.zw);
    vec2 dx[4],dy[4],uv[4];
    vec4 wx=dFdx(weight),wy=dFdy(weight);
    for(int i=0;i<4;i++) { dx[i]=dFdx(payload[i]);dy[i]=dFdy(payload[i]); }
    int absent=-1,count=0;
    for(int i=0;i<4;i++) {
        if(abs(weight[i])+abs(wx[i])+abs(wy[i])==0.0) { absent=i;count++;uv[i]=vec2(0.0); }
        else {
            if(abs(weight[i])>0.00390625) uv[i]=payload[i]/weight[i];
            else if(abs(wx[i])>abs(wy[i])) uv[i]=dx[i]/wx[i];
            else uv[i]=dy[i]/wy[i];
            if(any(isnan(uv[i]))||any(isinf(uv[i]))) return false;
            // Minecraft's humanoid endpoints are integer positions in 64x32.
            // Round BEFORE classification so all pixels of the face agree.
            uv[i]=round(uv[i]);
        }
    }
    if(count!=1) return false;
    uv[absent]=uv[(absent+3)&3]+uv[(absent+1)&3]-uv[(absent+2)&3];
    vec2 midpoint=(min(min(uv[0],uv[1]),min(uv[2],uv[3]))
                  +max(max(uv[0],uv[1]),max(uv[2],uv[3])))*0.5;
    ivec2 face=oc_armor_uvface(midpoint);
    if(face.y<2) return false;
    ivec4 first=getmeta(ivec2(0),8);
    int boxes=min(max(first.a,1),3);
    for(int b=0;b<boxes;b++) {
        ivec4 north=b==0?first:getmeta(ivec2(0),8+b);
        int part=north.b;
        int kind=part==1?0:part==0?1:part<=3?2:3;
        if(kind!=face.x) continue;
        ivec4 route=north;
        if(face.y==5) route=getmeta(ivec2(0),11+b);
        else if(face.y==2) route=getmeta(ivec2(0),14+b);
        else if(face.y==4) route=getmeta(ivec2(0),17+b);
        if(route.r*256+route.g!=65535) return true;
    }
    return false;
#else
    return false;
#endif
}
