import {describe,it,expect} from 'vitest';
import fs from 'node:fs';

const shader=fs.readFileSync(new URL('../../objcubed/assets/minecraft/shaders/core/entity.fsh',import.meta.url),'utf8');
const guard=shader.split(/\r?\n/).find(line=>line.includes('if (skinDonor == -2'));
const condition=guard.match(/if \((.+)\) discard;/)[1];
const discards=new Function('skinDonor','gl_FrontFacing','color',`return ${condition};`);

describe('native profile face visibility',()=>{
 it.each([1,2,25,128,255])('keeps source faces visible from either side at alpha %s',alpha=>{
  expect(discards(-2,true,{a:alpha/255})).toBe(false);
  expect(discards(-2,false,{a:alpha/255})).toBe(false);
 });
 it('discards completely transparent skin pixels on both sides before depth output',()=>{
  expect(discards(-2,true,{a:0})).toBe(true);
  expect(discards(-2,false,{a:0})).toBe(true);
 });
 it('leaves ordinary entity materials to their native cutout and OIT paths',()=>{
  expect(discards(-1,true,{a:0})).toBe(false);
  expect(discards(-1,false,{a:0})).toBe(false);
 });
});
