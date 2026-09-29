// CPU export/format checks. These do not execute shaders or establish GPU parity.
import {describe, it, expect} from 'vitest';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {loadObjcubedWithContext} = require('../helpers/load-plugin.cjs');
const {loadColorPlugin} = require('../helpers/color-plugin.cjs');
const {PNG} = require('pngjs');

function fixture(specs, {animatedFormat = true} = {}) {
  const warnings = [];
  const textures = specs.map((spec, i) => {
    const {w = 16, fh = 16, frames = 1, gridW = w, gridH = fh, metadata = true} = spec;
    const texture = {uuid:`t${i}`, name:`texture${i}`, source:`data:t${i}`, width:w, height:fh*frames};
    if (metadata) {
      texture.uv_width = gridW;
      texture.uv_height = gridH;
      // Real BB 5.2.1 API is frameCount/display_height, not frame_count.
      // The getter returns undefined for a static texture.
      Object.defineProperty(texture, 'frameCount', {get: () => animatedFormat && frames > 1 ? frames : undefined});
      Object.defineProperty(texture, 'display_height', {get: () => fh});
      texture.getUVWidth = () => gridW;
      texture.getUVHeight = () => gridH;
    }
    if ('legacyFrameCount' in spec) texture.frame_count = spec.legacyFrameCount;
    const data = new Uint8Array(w*fh*frames*4);
    for (let y=0; y<fh*frames; y++) for (let x=0; x<w; x++) {
      const p=(y*w+x)*4;
      data.set([20+i, Math.floor(y/fh), y%fh, x%2 ? 128 : 255],p);
    }
    return {texture, data};
  });
  class Image {
    set src(value) {this.entry=textures.find(t=>t.texture.source===value); queueMicrotask(()=>this.onload());}
    get naturalWidth() {return this.entry.texture.width;}
    get naturalHeight() {return this.entry.texture.height;}
  }
  const {api} = loadObjcubedWithContext({globals:{
    Buffer, Image,
    console:{log(){},error(){},warn(message){warnings.push(String(message));}},
    Blockbench:{showQuickMessage(message){warnings.push(String(message));}},
    Texture:{all:textures.map(t=>t.texture)}, Outliner:{root:[],elements:[]},
    Format:{animated_textures:animatedFormat,per_texture_uv_size:true},
    document:{createElement(){let entry; return {getContext(){return {
      drawImage(img){entry=img.entry;},
      getImageData(){return {data:entry.data,width:entry.texture.width,height:entry.texture.height};},
    };}};}},
  }});
  const obj = [
    'v 0 0 0','v 1 0 0','v 1 1 0','v 0 1 0',
    'vt 0 0','vt 1 0','vt 1 1','vt 0 1',
    ...specs.flatMap((spec,i)=>[
      `o ocp0e${spec.emission || 0}i${i}`,`usemtl m_t${i}`,'f 1/1 2/2 3/3 4/4',
    ]),
  ].join('\n');
  const cfg = {
    texIndex:0, nopow:false, scale:1, offset:[0,0,0],
    colorbehavior:['direct','overlay','hurt'], duration:0, autoplay:false,
    easing:0, interpolation:0, noshadow:false, autorotate:3, visibility:7,
    displaySlots:{}, flipuv:false, useAtlas:true,
    atlasTexIndices:specs.map((_,i)=>i),
    texAnimEnabled:true, texFrametime:5, texFade:true,
  };
  return {api, obj, cfg, warnings, export(extra={}){return api.buildOutput({...cfg,...extra},[obj],'');}};
}

function decode(result) {
  // Decode the produced PNG, not the encoder's in-memory source arrays.
  const png = PNG.sync.read(Buffer.from(result.pngBuffer));
  const rd=(x,y)=>Array.from(png.data.subarray((y*png.width+x)*4,(y*png.width+x+1)*4));
  const rgb=p=>p[0]*65536+p[1]*256+p[2];
  const sizeX=rd(1,0)[0]*256+rd(1,0)[1];
  const sizeY=rd(1,0)[2]*256+rd(7,0)[0];
  const nvertices=rgb(rd(2,0))*256+rd(7,0)[1];
  const ntextures=rd(3,0)[3];
  const textureBase=2+Math.ceil(nvertices/4/sizeX);
  const posH=rd(5,0)[0]*256+rd(5,0)[1];
  const uvH=rd(5,0)[2]*256+rd(7,0)[2];
  const uvBase=textureBase+sizeY*ntextures+posH;
  const vertexBase=uvBase+uvH;
  const pixelAt=(base,index)=>rd(index%sizeX,base+Math.floor(index/sizeX));
  const uvOf=(face,corner)=>{
    const uvIndex=rgb(pixelAt(vertexBase,(face*4+corner)*2+1));
    return [0,1].map(axis=>rgb(pixelAt(uvBase,uvIndex*2+axis))/65535);
  };
  const bands=Array.from({length:rd(5,1)[1]},(_,i)=>{
    const a=rd(6+2*i,1), b=rd(7+2*i,1);
    return {y0:a[0]*256+a[1],fh:a[2]*256+b[0],frames:b[1]};
  });
  return {rd,bands,sizeX,sizeY,ntextures,textureBase,uvOf};
}

// Read an interior texel for a known encoded band and frame. This validates
// storage/frame order only; it is not a CPU reimplementation of shader output.
function bandPixel(decoded, band, frame, localRow) {
  return decoded.rd(2,decoded.textureBase+band.y0-frame*band.fh+localRow);
}

describe('animated atlas export: multiple strips, color and emission',()=>{
  it('stores four independent strips with unequal frame counts, tint flags and per-face emission',async()=>{
    const f=fixture([2,3,4,5].map((frames,i)=>({frames,emission:[15,0,7,0][i]})));
    const result=await f.export();
    const d=decode(result);
    expect(d.ntextures).toBe(1);
    expect(d.bands.map(b=>b.frames)).toEqual([2,3,4,5]);
    expect(d.rd(4,1).slice(0,3)).toEqual([0,0,5]);
    expect(d.rd(5,1)[0]&1).toBe(1);
    expect(((d.rd(6,0)[0]&1)<<8)|d.rd(6,0)[1]).toBe(28); // direct/overlay/hurt
    expect(result.elements.map(e=>e.light_emission||0)).toEqual([15,0,7,0]);
    expect(result.elements.every(e=>e.faces.north.tintindex===0)).toBe(true);
    for(let i=0;i<4;i++) {
      const band=d.bands[i];
      expect(band.fh).toBe(16);
      const rows=[0,1,2,3].map(c=>d.uvOf(i,c)[1]*d.sizeY);
      expect(Math.min(...rows)).toBeCloseTo(band.y0,1);
      expect(Math.max(...rows)).toBeCloseTo(band.y0+16,1);
      for(let frame=0;frame<band.frames;frame++) {
        expect(bandPixel(d,band,frame,3)).toEqual([20+i,frame,12,255]);
        expect(d.rd(3,d.textureBase+band.y0-frame*16+3)[3]).toBe(128);
      }
    }
  });

  it('flipuv changes within-frame orientation without reversing animated atlas frame order',async()=>{
    const f=fixture([{frames:3},{frames:1}]);
    const d=decode(await f.export({flipuv:true}));
    expect(d.bands).toHaveLength(1);
    for(let frame=0;frame<3;frame++)
      expect(bandPixel(d,d.bands[0],frame,3),`source frame ${frame}`).toEqual([20,frame,3,255]);
  });

  it('uses actual pixel frame height for a hi-res BB animation with a coarser UV grid',async()=>{
    // BB: width32/height96, UV16x16 => frameCount3, display_height32.
    const f=fixture([{w:32,fh:32,frames:3,gridW:16,gridH:16},{frames:1}]);
    const d=decode(await f.export());
    expect(d.bands).toEqual([{y0:64,fh:32,frames:3}]);
    const rows=[0,1,2,3].map(c=>d.uvOf(0,c)[1]*d.sizeY);
    expect(Math.max(...rows)-Math.min(...rows)).toBeCloseTo(32,1);
  });

  it('does not animate or crop a static hi-res texture when another atlas texture animates',async()=>{
    // Same aspect ratios => native BB frameCount is undefined, not 2.
    const f=fixture([{w:32,fh:32,frames:1,gridW:16,gridH:16},{frames:3}]);
    const d=decode(await f.export());
    expect(d.bands).toEqual([{y0:64,fh:16,frames:3}]);
    const rows=[0,1,2,3].map(c=>d.uvOf(0,c)[1]*d.sizeY);
    expect(Math.min(...rows)).toBeCloseTo(0,1);
    expect(Math.max(...rows)).toBeCloseTo(32,1);
  });

  it('square-strip fallback without BB metadata also maps faces to frame zero',async()=>{
    const f=fixture([{frames:3,metadata:false},{frames:1,metadata:false}]);
    const d=decode(await f.export());
    expect(d.bands).toEqual([{y0:32,fh:16,frames:3}]);
    const rows=[0,1,2,3].map(c=>d.uvOf(0,c)[1]*d.sizeY);
    expect(Math.min(...rows)).toBeCloseTo(32,1);
    expect(Math.max(...rows)).toBeCloseTo(48,1);
  });

  it('preserves a tall native static texture whose UV grid covers its whole image',async()=>{
    // In a format that supports animation, BB reports no frames for equal
    // image/UV aspect ratios. The global animate toggle must not split it.
    const f=fixture([{w:16,fh:32,frames:1,gridW:8,gridH:16},{frames:3}]);
    const d=decode(await f.export());
    expect(d.bands).toEqual([{y0:64,fh:16,frames:3}]);
    const rows=[0,1,2,3].map(c=>d.uvOf(0,c)[1]*d.sizeY);
    expect(Math.min(...rows)).toBeCloseTo(0,1);
    expect(Math.max(...rows)).toBeCloseTo(32,1);
  });

  it('allows manual square-strip animation when the BB format does not supply native animation',async()=>{
    const f=fixture([{frames:3,gridH:48},{frames:1}],{animatedFormat:false});
    const d=decode(await f.export());
    expect(d.bands).toEqual([{y0:32,fh:16,frames:3}]);
    const rows=[0,1,2,3].map(c=>d.uvOf(0,c)[1]*d.sizeY);
    expect(Math.min(...rows)).toBeCloseTo(32,1);
    expect(Math.max(...rows)).toBeCloseTo(48,1);
  });

  it('respects an explicit legacy frame_count=1 beside an animated strip',async()=>{
    const f=fixture([{frames:3,metadata:false,legacyFrameCount:1},{frames:3}]);
    const d=decode(await f.export());
    expect(d.bands).toEqual([{y0:80,fh:16,frames:3}]);
  });

  it('uses native rectangular frame dimensions on the single-texture path too',async()=>{
    const f=fixture([{w:16,fh:8,frames:3}]);
    const d=decode(await f.export({useAtlas:false}));
    expect(d.ntextures).toBe(3);
    expect(d.sizeY).toBe(8);
    for(let frame=0;frame<3;frame++)
      expect(d.rd(2,d.textureBase+frame*8+2)).toEqual([20,frame,5,255]);
  });

  it('keeps a native static tall hi-res texture whole on the single-texture path',async()=>{
    const f=fixture([{w:16,fh:32,frames:1,gridW:8,gridH:16}]);
    const d=decode(await f.export({useAtlas:false}));
    expect(d.ntextures).toBe(1);
    expect(d.sizeY).toBe(32);
    expect(d.rd(2,d.textureBase+2)).toEqual([20,0,29,255]);
  });

  it.each([false,true])('rejects malformed native frame boundaries (atlas=%s)',async useAtlas=>{
    // Native BB getter rounds this aspect to three frames, but 40/3 is not an
    // integer pixel height and must never be rounded into corrupt frame bands.
    const specs=[{w:16,fh:40/3,frames:3,gridW:16,gridH:16}];
    if(useAtlas)specs.push({frames:1});
    const f=fixture(specs);
    await expect(f.export({useAtlas})).rejects.toThrow('cannot be divided into 3 whole-pixel frames');
  });

  it('encodes rectangular native frames independently of another strip length',async()=>{
    const f=fixture([{w:16,fh:8,frames:3},{w:16,fh:16,frames:2}]);
    const d=decode(await f.export());
    expect(d.bands).toEqual([{y0:16,fh:8,frames:3},{y0:40,fh:16,frames:2}]);
    expect(bandPixel(d,d.bands[0],2,2)).toEqual([20,2,5,255]);
    expect(bandPixel(d,d.bands[1],1,2)).toEqual([21,1,13,255]);
  });

  it('warns when a fifth strip cannot animate while retaining its frame-zero pixels',async()=>{
    const f=fixture(Array.from({length:5},()=>({frames:2})));
    const d=decode(await f.export());
    expect(d.bands).toHaveLength(4);
    expect(f.warnings.join('\n')).toMatch(/Only the first four will animate/);
    expect(d.rd(2,d.textureBase+4*32+16+3)).toEqual([24,0,12,255]);
  });

  it('rejects an atlas strip with more than 255 frames instead of wrapping its count',async()=>{
    const f=fixture([{frames:256},{frames:1}]);
    await expect(f.export()).rejects.toThrow(/maximum is 255/);
  });

  it('keeps full-frame boundary UVs in the same band when the face UVs are mirrored',async()=>{
    const f=fixture([{frames:3},{frames:2}]);
    const mirrored=f.obj.replace('vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1',
      'vt 1 1\nvt 0 1\nvt 0 0\nvt 1 0');
    const d=decode(await f.api.buildOutput(f.cfg,[mirrored],''));
    for(let i=0;i<2;i++) {
      const band=d.bands[i];
      const rows=[0,1,2,3].map(c=>d.uvOf(i,c)[1]*d.sizeY);
      expect(rows[0]).toBeCloseTo(band.y0+band.fh,1);
      expect(rows[2]).toBeCloseTo(band.y0,1);
      const oppositeMidpoint=(rows[0]+rows[2])/2;
      expect(oppositeMidpoint).toBeGreaterThan(band.y0);
      expect(oppositeMidpoint).toBeLessThan(band.y0+band.fh);
    }
  });

  it('reserves dynamic slot markers when the 16px header fits only three animated strips',async()=>{
    const f=fixture([2,3,4,5].map(frames=>({frames})));
    const slots=['thirdperson_righthand','thirdperson_lefthand','firstperson_righthand',
      'firstperson_lefthand','ground','fixed','head','on_shelf'];
    const displaySlots=Object.fromEntries(slots.map(slot=>[slot,{scale:[1,1,0.5]}]));
    const d=decode(await f.export({displaySlots}));
    expect(d.bands).toHaveLength(3);
    expect((d.rd(5,1)[0]>>1)&15).toBe(8);
    expect(f.warnings.join('\n')).toMatch(/Only 3 textures can animate at a width of 16px/);
    for(let x=12;x<16;x++) {
      const marker=d.rd(x,1);
      expect((marker[0]*256+marker[1])/65535*4).toBeCloseTo(0.5,3);
    }
  });
});

describe('texture animation controls use the same native frame contract',()=>{
  it('reveals the animation controls for rectangular native frames',()=>{
    const p=loadColorPlugin();
    Object.assign(p.context.Texture.all[0],{width:16,height:24,uv_width:16,uv_height:8,frameCount:3});
    p.context.Format={animated_textures:true,per_texture_uv_size:true};
    const state=p.openDialog();
    expect(state.texFrameCount).toBe(3);
  });
  it('does not reveal an animation strip for a native static tall texture',()=>{
    const p=loadColorPlugin();
    Object.assign(p.context.Texture.all[0],{width:16,height:32,uv_width:8,uv_height:16,frameCount:undefined});
    p.context.Format={animated_textures:true,per_texture_uv_size:true};
    const state=p.openDialog();
    expect(state.texFrameCount).toBe(1);
  });
  it.each([false,true])('does not claim valid rectangular frames will fail export (atlas=%s)',useAtlas=>{
    const p=loadColorPlugin();
    Object.assign(p.context.Texture.all[0],{width:16,height:24,uv_width:16,uv_height:8,frameCount:3});
    if(useAtlas)p.context.Texture.all.push({uuid:'flat',width:16,height:16,frameCount:undefined});
    p.context.Format={animated_textures:true,per_texture_uv_size:true};
    p.context.Outliner.root.push({type:'cube'});
    const state=p.openDialog();
    state.useAtlas=useAtlas;
    if(useAtlas)state.atlasTexChecked=[true,true];
    state.texAnimEnabled=true;
    expect(state.previewTexSize).toEqual({w:16,h:useAtlas?40:24});
    expect(state.previewWarnings.filter(w=>w.level==='error')).toEqual([]);
  });
});
