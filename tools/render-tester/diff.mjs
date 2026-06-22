// Render-tester (numerical differential, phase B/D).
// Goal: per display slot, does the obj3 shader reproduce a vanilla cube under the
// item display transform R*S? We compute the transform the SHADER actually applies
// to the decoded model offset (T_shader) and compare it to the true display R*S on
// a set of test points (a unit cube's corners). Divergence = the shader's deviation.
//
// Ground truth used:
//  - FaceBakery NORTH quad order (jar): c0=(maxX,maxY,minZ) c1=(maxX,minY,minZ)
//    c2=(minX,minY,minZ) c3=(minX,maxY,minZ). So c0-c1 = +Y edge, c0-c3 = +X edge,
//    anchor = c2 (min corner).
//  - MC 26.1.2 bakes display into the vertices; the shader reconstructs from the
//    baked carrier edges (hand/world) or reads it from the header (GUI).

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sc=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const mul=(M,v)=>add(add(sc(M[0],v[0]),sc(M[1],v[1])),sc(M[2],v[2])); // M = columns
function rotXYZ(rx,ry,rz){ // vanilla intrinsic XYZ, same as the shader's guiRotMat
  const d=Math.PI/180, cx=Math.cos(rx*d),sx=Math.sin(rx*d),cy=Math.cos(ry*d),sy=Math.sin(ry*d),cz=Math.cos(rz*d),sz=Math.sin(rz*d);
  // columns of R = Rx*Ry*Rz
  const r00=cy*cz, r01=-cy*sz, r02=sy;
  const r10=sx*sy*cz+cx*sz, r11=-sx*sy*sz+cx*cz, r12=-sx*cy;
  const r20=-cx*sy*cz+sx*sz, r21=cx*sy*sz+sx*cz, r22=cx*cy;
  return [[r00,r10,r20],[r01,r11,r21],[r02,r12,r22]];
}
const matVecRS=(R,S,v)=>mul(R,[v[0]*S[0],v[1]*S[1],v[2]*S[2]]); // R*S*v (true display)

// FaceBakery NORTH placeholder corners, block units (element from[8,0,8] to[24,16,8] -> /16)
const PH = { c0:[1.5,1,0.5], c1:[1.5,0,0.5], c2:[0.5,0,0.5], c3:[0.5,1,0.5] };
// bake display (R*S about block centre 0.5,0.5,0.5; pivot cancels in edges anyway)
function bake(R,S,p){ const piv=[0.5,0.5,0.5]; return add(matVecRS(R,S,sub(p,piv)),piv); }

// T_shader for HAND/WORLD: reconstruct from baked carrier edges (current shader).
function tShaderHandWorld(R,S,p){
  const c0=bake(R,S,PH.c0), c1=bake(R,S,PH.c1), c3=bake(R,S,PH.c3);
  const ex=sub(c0,c1), ey=sub(c0,c3);              // ex=+Y edge, ey=+X edge (FaceBakery)
  const sxv=len(ex), syv=len(ey);
  const vP1=norm(ex);
  const vP2=norm(sub(ey, sc(vP1, dot(ey,vP1))));   // Gram-Schmidt
  const fullRot=[vP2,vP1,cross(vP2,vP1)];          // mat3(vPos2,vPos1,cross) cols
  const wscale=(sxv+syv)*0.5;                       // current: UNIFORM avg
  return mul(fullRot, sc(p, wscale));
}
// T_shader for GUI: header carries display.scale + rotation directly (per-axis).
function tShaderGui(R,S,p){ return matVecRS(R,S,p); }   // guiRotMat*diag(guiScale)

const SLOTS = [
  { name:'thirdperson', fn:tShaderHandWorld },
  { name:'firstperson', fn:tShaderHandWorld },
  { name:'ground',      fn:tShaderHandWorld },
  { name:'fixed(frame)',fn:tShaderHandWorld },
  { name:'on_shelf',    fn:tShaderHandWorld },
  { name:'gui',         fn:tShaderGui },
];
const TESTS = [
  { name:'identity',         R:[0,0,0],  S:[1,1,1] },
  { name:'uniform scale 2',  R:[0,0,0],  S:[2,2,2] },
  { name:'per-axis 2,1,1 (X)',R:[0,0,0], S:[2,1,1] },
  { name:'per-axis 1,2,1 (Y)',R:[0,0,0], S:[1,2,1] },
  { name:'per-axis 1,1,2 (Z)',R:[0,0,0], S:[1,1,2] },
  { name:'rotate 45,30,0',   R:[45,30,0],S:[1,1,1] },
  { name:'rot+uniform',      R:[20,40,10],S:[1.5,1.5,1.5] },
];
// test points: a unit cube's 8 corners around origin
const CUBE=[];for(const x of[-0.5,0.5])for(const y of[-0.5,0.5])for(const z of[-0.5,0.5])CUBE.push([x,y,z]);

function maxDiff(Reuler,S,fn){
  const Rm=rotXYZ(Reuler[0],Reuler[1],Reuler[2]);
  let m=0; for(const p of CUBE){ const a=matVecRS(Rm,S,p), b=fn(Rm,S,p); m=Math.max(m,len(sub(a,b))); } return m;
}
console.log('Per-slot divergence of obj3 from a vanilla cube (max |obj3 - vanilla| over cube corners, blocks):\n');
const head='slot'.padEnd(14)+TESTS.map(t=>t.name.padEnd(13)).join('');
console.log(head); console.log('-'.repeat(head.length));
for(const sl of SLOTS){
  let row=sl.name.padEnd(14);
  for(const t of TESTS){ const d=maxDiff(t.R,t.S,sl.fn); row+=(d<1e-9?'OK':d.toFixed(3)).padEnd(13); }
  console.log(row);
}
console.log('\nOK = matches vanilla to ~1e-9. A number = block-space divergence.');
console.log('Expected per the design: GUI matches all (header carries per-axis); hand/world');
console.log('match identity/uniform/rotation but diverge on per-axis scale (flat placeholder');
console.log('exposes only 2 in-plane edges -> per-axis depth is unrecoverable -> averaged).');
