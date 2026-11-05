import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
const {parseObj}=createRequire(import.meta.url)('../helpers/load-plugin.cjs').loadObjcubed();
const unit=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
const add=(a,b)=>a.map((v,i)=>v+b[i]);
function normals(points,faces){
  const obj=[...points.map(p=>'v '+p.join(' ')),...faces.map(f=>typeof f==='string'?f:'f '+f.map(i=>i+1).join(' '))].join('\n');
  return parseObj(obj,0,'smooth').cornerNormals;
}
const quad=[[-1,0,0],[0,0,0],[0,1,0],[-1,1,0]], tilt=1/Math.sqrt(3), wall=unit([-tilt,0,1]), z=[0,0,1];
const bent=[[0,0,0],[1,0,tilt],[1,1,tilt],[0,1,0]], pair=[[0,1,2,3],[4,5,6,7]];
function near(actual,expected){actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],10));}

it('joins opposite sides of an exact shared edge between shallow faces even with different OBJ vertex IDs',()=>{
  const n=normals([...quad,...bent],pair),shared=unit([-tilt,0,2]);
  for(const v of [n[0][1],n[0][2],n[1][0],n[1][3]])near(v,shared);
  near(n[0][0],z);near(n[1][1],wall);
});

it('keeps point contacts, near misses, hard edges, overlapping sheets, nonmanifold edges and separate objects independent',()=>{
  near(normals([...quad,...bent.map(([x,y,v])=>[x,y?y*2:y,v])],pair)[0][1],z);
  near(normals([...quad,...bent.map(([x,y,v])=>[x+1e-8,y,v])],pair)[0][1],z);
  near(normals([...quad,...bent.map(([x,y,v])=>[0,y,x+v])],pair)[0][1],z);
  near(normals([...quad,...bent.map(([x,y])=>[x,y,x*Math.tan(46*Math.PI/180)])],pair)[0][1],z);
  near(normals([...quad,...bent.map(([x,y,v])=>[-x,y,v])],[pair[0],[7,6,5,4]])[0][1],z);
  near(normals([...quad,...bent,...bent.map(([x,y,v])=>[x,y,-v])],[...pair,[8,9,10,11]])[0][1],z);
  near(normals([...quad,...bent],[pair[0],'o another',pair[1]])[0][1],z);
});

it('averages each incident face once along a fan of split edges',()=>{
  const points=[[0,0,0],[1,0,.2],[0,1,0], [0,0,0],[0,1,0],[-1,0,.2], [0,0,0],[-1,0,.2],[0,-1,0]];
  const n=normals(points,[[0,1,2],[3,4,5],[6,7,8]]);
  const v=unit(add(unit([-.2,0,1]),add(unit([.2,0,1]),unit([.2,0,1]))));
  for(const face of n)near(face[0],v);
});

it('does not give a tiny ledge the same influence as the full cheek sharing its edge',()=>{
  const ledge=[[0,0,0],[.1,0,.1*tilt],[.1,1,.1*tilt],[0,1,0]];
  const n=normals([...quad,...ledge],pair);
  const expected=unit([-.1*tilt,0,1.1]);
  for(const v of [n[0][1],n[1][0]])near(v,expected);
});
