// Summarize raster results and verify temporal boundary properties.
// Usage: node tools/render-tester/texture-animation-results.mjs <fixture-root>
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const [header,...lines]=fs.readFileSync(path.join(root,'results.tsv'),'utf8').trim().split(/\r?\n/),keys=header.split('\t');
const rows=new Map(lines.map(line=>{const cols=line.split('\t'),row=Object.fromEntries(keys.map((k,i)=>[k,cols[i]]));return[row.id,row];}));
const failures=[],checks=[];
for(const c of manifest.cases){const row=rows.get(c.id);if(!row||row.passed!=='true')failures.push({...c,result:row});}
for(const scenario of manifest.scenarios){
 const gui=manifest.cases.filter(c=>c.scenario===scenario.name&&c.pipeline==='gui');
 checks.push({name:scenario.name+':gui-pins-frame0',passed:new Set(gui.map(c=>rows.get(c.id)?.actualSHA256)).size===1});
 for(const pipeline of ['item','entity','armor']){
  const group=manifest.cases.filter(c=>c.scenario===scenario.name&&c.pipeline===pipeline&&c.geometryFrame===0);
  if(scenario.static)checks.push({name:scenario.name+':'+pipeline+':static-over-time',passed:new Set(group.map(c=>rows.get(c.id)?.actualSHA256)).size===1});
  const zero=group.find(c=>c.time===0),ft=scenario.ft??2;
  for(const c of group.filter(c=>c.time>0&&scenario.frames.every(fr=>c.time%(ft*fr)===0)))checks.push({name:c.id+':frame-wrap',passed:rows.get(zero.id)?.actualSHA256===rows.get(c.id)?.actualSHA256});
  if(scenario.geometry){
   const a=manifest.cases.find(c=>c.scenario===scenario.name&&c.pipeline===pipeline&&c.time===0&&c.geometryFrame===0);
   const b=manifest.cases.find(c=>c.scenario===scenario.name&&c.pipeline===pipeline&&c.time===0&&c.geometryFrame===3);
   checks.push({name:scenario.name+':'+pipeline+':geometry-control-moves-pose',passed:rows.get(a.id)?.actualSHA256!==rows.get(b.id)?.actualSHA256});
  }
 }
}
const report={createdAt:new Date().toISOString(),cases:manifest.cases.length,passed:manifest.cases.length-failures.length,failed:failures.length,byScenario:manifest.scenarios.map(s=>({scenario:s.name,total:manifest.cases.filter(c=>c.scenario===s.name).length,failed:failures.filter(c=>c.scenario===s.name).length})),temporalChecks:checks.length,temporalFailed:checks.filter(c=>!c.passed),allCoverageExact:[...rows.values()].every(r=>+r.missing===0&&+r.extra===0),maxMeanRGBError:Math.max(...[...rows.values()].map(r=>+r.meanRGBError)),failures:failures.map(c=>({id:c.id,selectedFrames:c.selectedFrames,...c.result}))};
fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,failures:report.failures.slice(0,3)},null,2));
if(report.failed||report.temporalFailed.length)process.exitCode=1;
