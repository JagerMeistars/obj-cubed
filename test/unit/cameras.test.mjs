import {it, expect} from 'vitest';
import {createRequire} from 'node:module';
const {loadObjcubed} = createRequire(import.meta.url)('../helpers/load-plugin.cjs');
const api = loadObjcubed();
const track = name => ({name, frames: Array.from({length:3},(_,i)=>({x:i,y:2,z:-3,yaw:90,pitch:-20}))});
const generate = cameras => api.generateDatapackFiles('scene',3,'demo','item_display',null,'stick','scene',null,null,true,cameras);

it('one-command start keeps the viewer and uses the newly summoned root even beside an older scene',()=>{
  const files=generate([track('wide'),track('close')]);
  // Execute the orchestration; existing play_once and watch_ready are boundaries.
  // An older colocated root must never be selected by nearest/distance here.
  for(const entry of ['scene/start','scene/camera/close/start']) for(const player of [true,false]) {
    let root=41, next=41;
    const events=[];
    const run=(name,executor)=>{
      if(name==='scene/play_once'){root=executor.id;events.push(['play',root]);return;}
      if(name.endsWith('/watch_ready')){events.push(['watch',executor.id,root,name]);return;}
      for(const line of files.get(`data/demo/function/${name}.mcfunction`).split('\n')) {
        if(line==='execute unless entity @s[type=minecraft:player] run return 0'){if(!executor.player)return;}
        else if(line==='scoreboard players set #root oc.cam.owner -1')root=-1;
        else if(line.startsWith('execute summon minecraft:item_display run function demo:')) {
          const entity={id:++next,player:false};events.push(['summon',entity.id]);
          run(line.split('function demo:')[1],entity);
        } else if(line.startsWith('data merge entity @s ')) {
          expect(executor.player).toBe(false);
          expect(line).toContain('item_display:"fixed"');
          expect(line).toContain('strings:["scene"]');
        } else if(line.startsWith('function demo:'))run(line.slice('function demo:'.length),executor);
        else throw Error('Unhandled start command: '+line);
      }
    };
    run(entry,{id:'viewer',player});
    const camera=entry==='scene/start'?'wide':'close';
    expect(events).toEqual(player?[
      ['summon',42],['play',42],['watch','viewer',42,`scene/camera/${camera}/watch_ready`],
    ]:[]);
  }
});

it('exports named camera tracks with closed function references and persistent viewer restoration',()=>{
  const files=generate([track('wide'),track('close')]);
  for(const [path,text] of files) {
    if(!path.endsWith('.mcfunction')) continue;
    for(const match of text.matchAll(/\bfunction ([a-z0-9_.-]+):([a-z0-9_./-]+)/g))
      expect(files.has(`data/${match[1]}/function/${match[2]}.mcfunction`),`${path}: ${match[0]}`).toBe(true);
  }
  const get=name=>files.get(`data/demo/function/scene/camera/${name}.mcfunction`);
  expect(get('load')).toContain(JSON.stringify(track('wide').frames));
  for(const name of ['wide','close']) {
    expect(get(`${name}/watch_ready`)).toContain('if score @s oc.cam.owner = #root oc.cam.owner');
    expect(get(`${name}/watch_ready`)).toContain('unless entity @s[tag=oc.cam.viewer] run function objcubed:__camera/save');
    expect(get(`${name}/select`)).toContain(`tracks.${name}[$(frame)]`);
  }
  expect(files.get('data/objcubed/function/__camera/save_data.mcfunction')).toContain('returns.p$(id).dimension set from entity @s Dimension');
  expect(files.get('data/objcubed/function/__camera/return_player.mcfunction')).toContain('execute in $(dimension) run tp @s $(x) $(y) $(z) $(yaw) $(pitch)');
  expect(files.get('data/demo/function/scene/zzz/_latch_once.mcfunction')).toContain('scene/camera/end_view');
  expect(files.get('data/demo/function/scene/summon.mcfunction')).toContain('item_display:"fixed"');
  for(const dim of ['overworld','the_nether','the_end'])
    expect(files.get('data/demo/function/scene/tick.mcfunction')).toContain(`execute in minecraft:${dim} as`);
  expect([...generate([]).keys()].some(k=>k.includes('/camera/'))).toBe(false);
  for(const bad of [track('bad.name'), {...track('bad'),frames:[]}, {...track('bad'),frames:[{x:NaN},...track('bad').frames.slice(1)]}])
    expect(()=>generate([bad])).toThrow();
  expect(()=>generate([track('same'),track('same')])).toThrow();
  expect(()=>api.generateDatapackFiles('__camera',3,'objcubed','item_display')).toThrow('reserved');
  expect(api.generateDatapackFiles('camera',3,'objcubed','item_display',null,null,null,null,null,true,[track('wide')]).get('data/objcubed/function/camera/init.mcfunction')).toContain('objcubed.camera');
  expect(()=>api.generateDatapackFiles('scene',3,'demo','player','mainhand',null,null,null,null,true,[track('wide')])).toThrow();
});

it('camera frames follow the model clock for manual, loop and one-shot playback across midnight',()=>{
  const files=generate([track('wide')]);
  for(const [mode,score,time,expected] of [
    ['manual',2,100,2],['loop',2,4,2],['loop',23999,24000,1],
    ['once',32768+23999,24000,1],['once',32768+23999,24010,2],
  ]) {
    const scores=new Map([['@s oc.cam.frame',score],['@s objcubed.scene',score],['#cycle objcubed.scene',24000],['#dur objcubed.scene',3]]);
    const commands=mode==='manual'?[]:files.get(`data/demo/function/scene/camera/${mode}_frame.mcfunction`).split('\n');
    commands.push('scoreboard players operation @s oc.cam.frame %= #dur objcubed.scene');
    for(const command of commands){
      let m;
      if(command==='execute store result score @s oc.cam.frame run time query gametime') scores.set('@s oc.cam.frame',time);
      else if((m=command.match(/^scoreboard players operation (\S+ \S+) (%=|-=) (\S+ \S+)$/))){
        const a=scores.get(m[1]),b=scores.get(m[3]);scores.set(m[1],m[2]==='-='?a-b:((a%b)+b)%b);
      } else if((m=command.match(/^scoreboard players add (\S+ \S+) (\d+)$/))) scores.set(m[1],scores.get(m[1])+Number(m[2]));
      else if((m=command.match(/^execute if score (\S+ \S+) matches (\d+)\.\. run scoreboard players set (\S+ \S+) (\d+)$/))){
        if(scores.get(m[1])>=Number(m[2]))scores.set(m[3],Number(m[4]));
      } else throw Error('Unhandled camera command: '+command);
    }
    expect(scores.get('@s oc.cam.frame'),`${mode} at ${time}`).toBe(expected);
  }
});
