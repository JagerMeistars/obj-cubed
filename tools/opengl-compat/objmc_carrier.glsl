// OpenGL carrier recovery for item instances and vanilla humanoid armor cubes.
// Item contract: exporter emits identical NORTH carriers in encoded-face order.
// Standard Minecraft material splitting is accounted for with per-class rank.
// Define OBJMC_CARRIER_TERRAIN for terrain's separate alpha0/255 classes.
// Prepare item assets to emit only blended markers and guard instance ends.
// Unprepared mixed-class assets do not cover arbitrary forceTranslucent overrides.
// Full peer transfer is exact for Position; donor UV remapping may differ by ulps.
// Three peer reconstruction assumes the original carrier is a parallelogram.
// Status 0 explicitly means insufficient peers; callers must not treat it as a
// complete carrier. Group operations do not guarantee hardware scheduling.
// Requires ARB_shader_ballot, ARB_gpu_shader_int64, ARB_shader_draw_parameters.
#ifndef OBJMC_CARRIER_GLSL
#define OBJMC_CARRIER_GLSL
#define OBJMC_CARRIER_EXPLICIT_CORNER
int oc_carrier_corner=0;
int oc_carrier_status=0;
int oc_carrier_count=0;
uint oc_carrier_neighbors=0u;
#include <minecraft:objmc_armor_carrier.glsl>
// Avoid GLSL400 findLSB in Minecraft's GLSL330 roundtrip.
uint oc_first_lane(uint64_t mask) {
    uint lo=uint(mask), hi=uint(mask>>32);
    uint v=lo!=0u?lo:hi, lane=lo!=0u?0u:32u;
    if((v&65535u)==0u){v>>=16;lane+=16u;}
    if((v&255u)==0u){v>>=8;lane+=8u;}
    if((v&15u)==0u){v>>=4;lane+=4u;}
    if((v&3u)==0u){v>>=2;lane+=2u;}
    if((v&1u)==0u)lane+=1u;
    return lane;
}
// Standard exporter UV-offset texels use alpha = marker row modulo 256.
// Minecraft preserves face order separately within each material class.
int oc_item_face_rank(int faceID,int width) {
    int row=faceID/width+2,col=faceID%width;
    int cutBefore=2*(row/256)+min(row%256,1)-1;
#ifdef OBJMC_CARRIER_TERRAIN
    int residue=row&255;
    if(residue==0)return (((row+255)/256)-1)*width+col;
    if(residue==255)return (row/256)*width+col;
#else
    if((row&255)==0||(row&255)==255)return cutBefore*width+col;
#endif
    return (row-2-cutBefore)*width+col;
}
void oc_read_carrier(vec3 position,vec2 uv,out vec3 positions[4],out vec2 uvs[4]) {
    oc_carrier_corner=(OBJMC_VERTEX_ID-gl_BaseVertexARB)&3;
    int quadBase=OBJMC_VERTEX_ID-oc_carrier_corner;
    ivec2 atlasSize=textureSize(Sampler0,0);
    ivec2 ownPixel=ivec2(0),topLeft=ivec2(0);
    vec2 relativeUV=uv;
    int modelBase=quadBase;
    bool itemCarrier=false;
    ivec2 pixel=ivec2(uv*vec2(atlasSize));
    if(all(greaterThanEqual(pixel,ivec2(0)))&&all(lessThan(pixel,atlasSize))) {
        ivec4 offset=ivec4(texelFetch(Sampler0,pixel,0)*255.0+0.5);
        ivec2 ownOffset=ivec2(offset.r*256+offset.g,offset.b*256+offset.a);
        ivec2 origin=pixel-ownOffset;
        if(all(greaterThanEqual(origin,ivec2(0)))&&all(lessThan(origin,atlasSize))) {
            ivec4 marker=ivec4(texelFetch(Sampler0,origin,0)*255.0+0.5);
            if(all(equal(marker,ivec4(12,34,56,255)))) {
                itemCarrier=true;
                ivec4 info=ivec4(texelFetch(Sampler0,origin+ivec2(1,0),0)*255.0+0.5);
                int faceID=(ownOffset.y-2)*(info.r*256+info.g)+ownOffset.x;
                int faceRank=oc_item_face_rank(faceID,info.r*256+info.g);
                modelBase=quadBase-faceRank*4;
                ownPixel=pixel;topLeft=origin;
                relativeUV=uv-vec2(pixel)/vec2(atlasSize);
            }
        }
    }
#ifdef OBJMC_CARRIER_ARMOR
    // Match main's item-before-armor priority, including texture atlases.
    if(!itemCarrier && all(equal(ivec4(texelFetch(Sampler0,ivec2(0),0)*255.0+0.5),ivec4(12,34,56,253)))) {
        oc_read_armor_carrier(position,uv,positions,uvs);
        return;
    }
#endif
    int draw=gl_DrawIDARB;
    oc_carrier_status=0;oc_carrier_count=0;oc_carrier_neighbors=0u;
    for(int i=0;i<4;i++){positions[i]=position;uvs[i]=uv;}
    bool pending=true;
    bool conflict=false;
    while(pending) {
        int chosenBase=readFirstInvocationARB(modelBase);
        int chosenDraw=readFirstInvocationARB(draw);
        ivec2 chosenTopLeft=readFirstInvocationARB(topLeft);
        if(modelBase==chosenBase && draw==chosenDraw && all(equal(topLeft,chosenTopLeft))) {
            // Active lanes share one model instance (one quad for armor). Each
            // source index is uniform among the lanes executing the read.
            for(int corner=0;corner<4;corner++) {
                uint64_t peers=ballotARB(oc_carrier_corner==corner);
                if(peers!=uint64_t(0)) {
                    uint lane=oc_first_lane(peers);
                    vec3 sourcePosition=readInvocationARB(position,lane);
                    vec2 sourceUV=readInvocationARB(relativeUV,lane);
                    uint64_t different=ballotARB(oc_carrier_corner==corner &&
                        (any(notEqual(position,sourcePosition)) ||
                         any(greaterThan(abs(relativeUV-sourceUV),vec2(0.000001)))));
                    conflict=conflict || different!=uint64_t(0);
                    positions[corner]=sourcePosition;
                    uvs[corner]=sourceUV+vec2(ownPixel)/vec2(atlasSize);
                    oc_carrier_neighbors|=1u<<uint(corner);
                    oc_carrier_count++;
                }
            }
            pending=false;
        }
    }
    oc_carrier_status=conflict?3:oc_carrier_count==4?1:0;
    if(!conflict&&oc_carrier_count==3) {
        int missing=0;
        for(int i=0;i<4;i++)if((oc_carrier_neighbors&(1u<<uint(i)))==0u)missing=i;
        int prev=(missing+3)&3,next=(missing+1)&3,opposite=(missing+2)&3;
        positions[missing]=(positions[prev]-positions[opposite])+positions[next];
        uvs[missing]=(uvs[prev]-uvs[opposite])+uvs[next];
        oc_carrier_status=4;
    }
    if(conflict)for(int i=0;i<4;i++){positions[i]=position;uvs[i]=uv;}
}
#endif
