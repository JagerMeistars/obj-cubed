// Independent numerical contract for color modes on the white-quad GPU fixture.
// Usage: node tools/render-tester/check-color-behavior.mjs <fixture-directory>
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const [header,...lines]=fs.readFileSync(path.join(root,'results.tsv'),'utf8').trim().split(/\r?\n/);
const columns=header.split('\t'),rows=new Map(lines.map(line=>{const a=line.split('\t'),row=Object.fromEntries(columns.map((key,i)=>[key,a[i]]));return[row.id,row];}));
const assertions=[];
function check(name,ok,details){assertions.push({name,passed:!!ok,...details});}
// Conventional six-sector HSV conversion, independent of the GLSL hrgb formula.
function hsv(h){const x=((h%1)+1)%1*6,i=Math.floor(x),f=x-i;return [[1,f,0],[1-f,1,0],[0,1,f],[0,1-f,1],[f,0,1],[1,0,1-f]][i%6];}
function expectedTint(modes,rgb){
 const tint=modes.map((mode,k)=>mode==='direct'?rgb[k]/255:1);
 const hueBytes=rgb.filter((_,k)=>modes[k]==='overlay');
 const hueValue=hueBytes.reduce((n,byte)=>n*256+byte,0);
 // Existing format reserves hue=0 as neutral, and uses 255*256^(N-1).
 const hue=hueValue?hsv(hueValue/(255*256**(hueBytes.length-1))):[1,1,1];
 const hurt=modes.some((mode,k)=>mode==='hurt'&&rgb[k]!==0)?[1,.7,.7]:[1,1,1];
 return tint.map((t,k)=>Math.round(255*t*hue[k]*hurt[k]));
}
for(const c of manifest.cases){
 const row=rows.get(c.id);check(c.id+':result-exists',!!row,{});if(!row)continue;
 check(c.id+':visible',+row.currentPixels>0,{pixels:+row.currentPixels});
 // This correction must not alter frame selection, scale, or the carrier geometry.
 check(c.id+':geometry-unchanged',row.currentPixels===row.baselinePixels&&row.currentCentroid===row.baselineCentroid&&row.currentBounds===row.baselineBounds,{current:[row.currentPixels,row.currentCentroid,row.currentBounds],baseline:[row.baselinePixels,row.baselineCentroid,row.baselineBounds]});
 if(c.pipeline==='item'||c.pipeline==='entity'){
  const expected=expectedTint(c.modes,c.rgb),actual=row.currentRGB.split(',').map(Number);
  check(c.id+':composed-rgb',actual.every((v,k)=>Math.abs(v-expected[k])<=1.01),{expected,actual});
 }else{
  check(c.id+':legacy-pipeline-unchanged',row.currentSHA256===row.baselineSHA256,{differentPixels:+row.differentPixels});
 }
}
// Real four-frame geometry: manual frame 1 -> 3 moves the quad by two source steps.
for(const pipeline of ['item','entity'])for(const lighting of ['lit','fullbright']){
 const a=rows.get(`${pipeline}-111-manual1-${lighting}`),b=rows.get(`${pipeline}-111-manual3-${lighting}`);
 check(`${pipeline}:${lighting}:manual-time-changes-pose`,a&&b&&a.currentCentroid!==b.currentCentroid,{frame1:a?.currentCentroid,frame3:b?.currentCentroid});
 const full=rows.get(`${pipeline}-000-white-${lighting}`),small=rows.get(`${pipeline}-222-rgb-${lighting}`);
 check(`${pipeline}:${lighting}:scale-reduces-coverage`,full&&small&&+small.currentPixels<+full.currentPixels*.3,{full:full?.currentPixels,scaled:small?.currentPixels});
}
const failures=assertions.filter(a=>!a.passed);
const report={createdAt:new Date().toISOString(),cases:manifest.cases.length,assertions:assertions.length,passed:assertions.length-failures.length,failed:failures.length,baselineChangedCases:[...rows.values()].filter(r=>+r.differentPixels>0).length,contract:'Item/entity RGB = direct channel mask × HSV hue × hurt factor, independent of noshadow. Hue zero and scale zero retain existing neutral semantics. Geometry must match release baseline. Armor remains RGB24 playback control; block/terrain ignore colorbehavior (explicit compatibility boundaries).',failures};
fs.writeFileSync(path.join(root,'assertions.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,failures:failures.slice(0,8)},null,2));
if(failures.length)process.exitCode=1;
