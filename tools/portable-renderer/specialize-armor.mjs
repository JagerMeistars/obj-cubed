// Keep the equipment pipeline's ordinary, legacy-armor and AS1 paths while
// omitting item-only decoders. Operate on generated copies, never the sources.
function replaceOnce(source, before, after, label) {
  const at=source.indexOf(before);
  if(at<0 || source.indexOf(before,at+before.length)>=0)
    throw new Error(`Armor specialization: expected one ${label}`);
  return source.slice(0,at)+after+source.slice(at+before.length);
}
function block(source, needle) {
  const start=source.indexOf(needle),open=source.indexOf('{',start);
  if(start<0||open<0) throw new Error(`Armor specialization: missing ${needle}`);
  let depth=1,end=open+1;
  // These bounded regions contain executable GLSL and comments without braces.
  // Fail on a changed region instead of writing a partial specialization.
  for(;end<source.length&&depth;end++) {
    if(source[end]==='{') depth++;
    else if(source[end]==='}') depth--;
  }
  if(depth) throw new Error(`Armor specialization: unterminated ${needle}`);
  return {start,end};
}
function removeBlock(source,needle) {
  const {start,end}=block(source,needle);
  return source.slice(0,start)+source.slice(end);
}
export function specializeArmorSources({vertex,fragment,decode}) {
  const itemExpression=vertex.match(/if\((mode!=2 && mode!=4(?: && mode!=5)?)\)/)?.[1];
  if(!itemExpression) throw new Error('Armor specialization: item condition changed');
  const item=`    if(${itemExpression})`;
  const start=vertex.indexOf('    ivec2 pixel=');
  const end=vertex.indexOf('#ifdef ENTITY',start);
  if(start<0||end<0||!vertex.slice(start,end).includes('int mode=0;'))
    throw new Error('Armor specialization: item classification changed');
  vertex=vertex.slice(0,start)+'    int mode=0;\n'+vertex.slice(end);
  vertex=replaceOnce(vertex,
    `vec2 localUV=(${itemExpression}) ? UV0*vec2(atlas)-vec2(pixel) : UV0*vec2(64.0,32.0);`,
    'vec2 localUV=UV0*vec2(64.0,32.0);','vertex carrier UV');
  vertex=removeBlock(vertex,item);
  fragment=replaceOnce(fragment,
    `mode!=2?(oc_carrier_uvs[i]+vec2(markerPixel))/atlas:round(oc_carrier_uvs[i])/vec2(64.0,32.0)`,
    'round(oc_carrier_uvs[i])/vec2(64.0,32.0)','fragment carrier UV');
  // First item branch restores north-face UV roles; the second decodes the
  // item/BVH. Keep its AS1 and legacy-armor else branches unchanged.
  fragment=removeBlock(fragment,item);
  const branch=block(fragment,item);
  const after=fragment.slice(branch.end);
  if(!/^ else if\(mode==[45](?:\s*\|\|\s*mode==[45])?\)/.test(after))
    throw new Error('Armor specialization: AS1 branch changed');
  fragment=fragment.slice(0,branch.start)+'    '+after.slice(' else '.length);
  const decoder=decode.indexOf('OcDecodedVertex oc_decode_vertex(');
  if(decoder<0) throw new Error('Armor specialization: decoder boundary changed');
  decode=decode.slice(0,decoder);
  for(const [name,source]of Object.entries({vertex,fragment,decode})) {
    if(/\b(?:oc_decode_vertex|oc_bvh_trace|oc_item_order_carrier|oc_item_affine_init|oc_item_affine_apply)\s*\(/.test(source))
      throw new Error(`Armor specialization: item call remains in ${name}`);
  }
  return {vertex,fragment,decode};
}
