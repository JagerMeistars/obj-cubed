// Vanilla six-face humanoid armor cube recovery across physical aliases.
// Four independent corners preserve arbitrary affine poses. Coplanar recovery
// assumes vanilla rigid/uniform bone poses and the original PiP scale heuristic.
// Two-point recovery additionally uses packed Normal and is approximate; custom
// nonuniform poses and PiP normals that do not track the pose are not covered.
// Requires ARB ballot/int64/draw_parameters; stream contains whole 24-vertex cubes.
#ifdef OBJMC_CARRIER_ARMOR
#ifndef OBJMC_ARMOR_CARRIER_GLSL
#define OBJMC_ARMOR_CARRIER_GLSL
uint oc_cube_first_lane(uint64_t mask) {
    uint lo=uint(mask),hi=uint(mask>>32),v=lo!=0u?lo:hi,lane=lo!=0u?0u:32u;
    if((v&65535u)==0u){v>>=16;lane+=16u;}if((v&255u)==0u){v>>=8;lane+=8u;}
    if((v&15u)==0u){v>>=4;lane+=4u;}if((v&3u)==0u){v>>=2;lane+=2u;}if((v&1u)==0u)lane++;
    return lane;
}
vec3 oc_cube_bits(int i){return vec3(i&1,(i>>1)&1,(i>>2)&1);}
int oc_cube_id(int face,int corner){
    const ivec4 ids[6]=ivec4[6](ivec4(5,4,0,1),ivec4(3,2,6,7),ivec4(0,4,6,2),ivec4(1,0,2,3),ivec4(5,1,3,7),ivec4(4,5,7,6));
    return ids[face][corner];
}
vec2 oc_cube_uv_corner(int corner){return vec2(corner==0||corner==3?1:0,corner>=2?1:0);}
void oc_read_armor_carrier(vec3 position,vec2 uv,out vec3 positions[4],out vec2 uvs[4]) {
    int local=OBJMC_VERTEX_ID-gl_BaseVertexARB;
    int within=local%24,face=within/4,corner=within&3;
    int cubeBase=OBJMC_VERTEX_ID-within,draw=gl_DrawIDARB;
    vec2 pix=uv*vec2(64,32);
    bool head=pix.y<(face<2?12.0:18.0);
    float vmid=head?(face<2?4.0:12.0):(face<2?18.0:26.0);
    bool originalTop=face==1?pix.y>vmid:pix.y<vmid;
    bool mirror=(corner<2)!=originalTop;
    int sourceCorner=mirror?3-corner:corner;
    int physical=oc_cube_id(face,sourceCorner);
    // Standard head/body/limb rectangles have disjoint U intervals for a
    // known physical face, including their boundaries.
    const vec2 bodyRanges[6]=vec2[6](vec2(20,28),vec2(28,36),vec2(16,20),vec2(20,28),vec2(28,32),vec2(32,40));
    bool body=!head&&pix.x>=bodyRanges[face].x&&pix.x<=bodyRanges[face].y;
    float width=head?8.0:body?8.0:4.0,depth=head?8.0:4.0,height=head?8.0:12.0;
    vec2 span=vec2(face==2||face==4?depth:width,face<2?depth:height);
    if(face==1)span.y=-span.y;
    vec2 origin=pix-oc_cube_uv_corner(sourceCorner)*span;
    oc_carrier_corner=corner;oc_carrier_status=0;oc_carrier_count=0;oc_carrier_neighbors=0u;
    for(int i=0;i<4;i++){positions[i]=position;uvs[i]=(origin+oc_cube_uv_corner(mirror?3-i:i)*span)/vec2(64,32);}
    vec3 points[8];uint known=0u;
    for(int i=0;i<8;i++)points[i]=position;
    bool pending=true;
    while(pending){
        int chosenBase=readFirstInvocationARB(cubeBase),chosenDraw=readFirstInvocationARB(draw);
        if(cubeBase==chosenBase&&draw==chosenDraw){
            for(int i=0;i<8;i++){
                uint64_t peers=ballotARB(physical==i);
                if(peers!=uint64_t(0)){points[i]=readInvocationARB(position,oc_cube_first_lane(peers));known|=1u<<uint(i);}
            }
            pending=false;
        }
    }
    int indices[4]=int[4](-1,-1,-1,-1),n=0;
    for(int i=0;i<8;i++)if((known&(1u<<uint(i)))!=0u){
        oc_carrier_count++;
        if(n<3){indices[n]=i;n++;}
        else if(n==3){
            vec3 a=oc_cube_bits(indices[1])-oc_cube_bits(indices[0]);
            vec3 b=oc_cube_bits(indices[2])-oc_cube_bits(indices[0]);
            if(dot(cross(a,b),oc_cube_bits(i)-oc_cube_bits(indices[0]))!=0.0){indices[3]=i;n++;}
        }
    }
    bool complete=true,reconstructed=false;
    for(int i=0;i<4;i++){
        int id=oc_cube_id(face,mirror?3-i:i);
        if((known&(1u<<uint(id)))!=0u){positions[i]=points[id];oc_carrier_neighbors|=1u<<uint(i);}
        else if(n>=3){
            vec3 origin3=oc_cube_bits(indices[0]);
            vec3 a=oc_cube_bits(indices[1])-origin3,b=oc_cube_bits(indices[2])-origin3,c=oc_cube_bits(id)-origin3;
            vec3 pa=points[indices[1]]-points[indices[0]],pb=points[indices[2]]-points[indices[0]];
            if(n==4){
                vec3 d=oc_cube_bits(indices[3])-origin3,pd=points[indices[3]]-points[indices[0]];
                positions[i]=points[indices[0]]+mat3(pa,pb,pd)*(inverse(mat3(a,b,d))*c);reconstructed=true;
            }else if(dot(cross(a,b),c)==0.0){
                float aa=dot(a,a),ab=dot(a,b),bb=dot(b,b),ac=dot(a,c),bc=dot(b,c),det=aa*bb-ab*ab;
                positions[i]=points[indices[0]]+pa*((ac*bb-bc*ab)/det)+pb*((bc*aa-ac*ab)/det);reconstructed=true;
            }else {
                // Vanilla humanoid bones use a rigid pose with uniform scale.
                // Preserve the original shader's inner-layer inflation and
                // large-scale PiP reflection convention when only one cube
                // plane is represented in this subgroup.
                float inflation=1.0;
                int boxes=int(texelFetch(Sampler0,ivec2(8,0),0).a*255.0+0.5);
                for(int box=0;box<3;box++)if(box<boxes){
                    int part=int(texelFetch(Sampler0,ivec2(8+box,0),0).b*255.0+0.5);
                    if(part==4||part==5)inflation=0.5;
                }
                vec3 dims=vec3(width,height,depth)+vec3(2.0*inflation);
                vec3 la=a*dims,lb=b*dims;
                vec3 lu=normalize(la),lv=normalize(lb-lu*dot(lb,lu)),lw=cross(lu,lv);
                vec3 wu=normalize(pa),wv=normalize(pb-wu*dot(pb,wu)),ww=cross(wu,wv);
                float scale=length(pa)/length(la);
                bool reflected=scale*16.0/0.9235>20.0;
                float orientation=mirror!=reflected?-1.0:1.0;
                mat3 rigid=mat3(wu,wv,ww*orientation)*transpose(mat3(lu,lv,lw));
                positions[i]=points[indices[0]]+rigid*(c*dims)*scale;
                reconstructed=true;
            }
        }else if(n==2){
            // Approximate two-point fallback for a single represented face.
            // Packed Normal supplies the missing orientation; orthogonalize it
            // against the measured edge so normal quantization cannot skew it.
            int axis=face<2?1:face==2||face==4?0:2;
            vec3 ca=oc_cube_bits(indices[0]),cb=oc_cube_bits(indices[1]);
            if(ca[axis]!=cb[axis]||ca[axis]!=oc_cube_bits(id)[axis]){complete=false;continue;}
            float inflation=1.0;
            int boxes=int(texelFetch(Sampler0,ivec2(8,0),0).a*255.0+0.5);
            for(int box=0;box<3;box++)if(box<boxes){int part=int(texelFetch(Sampler0,ivec2(8+box,0),0).b*255.0+0.5);if(part==4||part==5)inflation=0.5;}
            vec3 dims=vec3(width,height,depth)+vec3(2.0*inflation);
            vec3 la=(cb-ca)*dims,pa=points[indices[1]]-points[indices[0]],lu=normalize(la),wu=normalize(pa);
            vec3 lw=vec3(0);lw[axis]=1.0;
            float sign=face==0||face==2||face==3?-1.0:1.0;
            vec3 normal=Normal*sign,ww=normal-wu*dot(normal,wu);
            if(dot(ww,ww)<0.00001){complete=false;continue;}
            ww=normalize(ww);
            float scale=length(pa)/length(la);
            bool reflected=scale*16.0/0.9235>20.0;
            float orientation=mirror!=reflected?-1.0:1.0;
            vec3 lv=cross(lw,lu),wv=cross(ww,wu)*orientation;
            positions[i]=points[indices[0]]+(mat3(wu,wv,ww)*transpose(mat3(lu,lv,lw)))*((oc_cube_bits(id)-ca)*dims)*scale;
            reconstructed=true;
        }else complete=false;
    }
    oc_carrier_status=complete?(reconstructed?4:1):0;
}
#endif
#endif
