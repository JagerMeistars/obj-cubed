# Shared armor decoding

`armor-fast.glsl` replaces four calls to the original per-vertex armor decoder
with `oc_decode_armor(out OcDecodedVertex vertex[4])`. Include it after
`decode.glsl` and call it only for marker-253 equipment in the fragment stage.
It uses the same global carrier arrays, control tint, normal, texture, clock and
lighting functions as the original decoder.

The header, playback control, UV face/side routing, scale, waist correction,
carrier basis and anchor, emissive flags, and texture-animation selection are
computed once per face. The final four-iteration loop reads only vertex and UV
data and applies animation and the shared transform. All decoded vertices keep
`custom=1`, `gui=hand=0` and white overlay, as the original armor path does.
Unused caps and empty routes discard the fragment. The pack targets 26.3, so it
uses the UV-based armor routing introduced in 26.2; obsolete submission-order
routing from 26.1 is intentionally absent.

## Independent shader parity test

Run from the repository root:

```sh
node tools/portable-renderer/armor-fast-test.mjs ../minecraft-research/armor-fast-validation
cc tools/portable-renderer/armor-fast-test.c \
  -o ../minecraft-research/armor-fast-validation/parity \
  $(pkg-config --cflags --libs epoxy) -lm -Wall -Wextra
../minecraft-research/armor-fast-validation/parity \
  ../minecraft-research/armor-fast-validation
```

The test extracts the actual original armor GLSL branch from `objmc_main.glsl`
and compares it with the fast decoder on a real OpenGL 3.3 driver using transform
feedback. The test substitutes a returned visibility flag for fragment-only
`discard`, and compares that with the original branch's culled position.

Coverage includes eight parts, six carrier faces, left and right sides, cyclic
corner orders, rotated world carriers and large reflected preview carriers,
one to three packed boxes, waist corrections, static and four-frame geometry,
all four easing modes, white/autoplay/manual/play-once dye controls, texture
frames and atlas bands with and without fades, shadow/emissive flags, and all
three vanilla lighting branches. This isolates decoder equivalence; it does not
validate the surrounding fullscreen proxy, rasterization, or game performance.
