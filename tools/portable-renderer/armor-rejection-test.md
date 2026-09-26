# Armor rejection checks

The early UV gate and AB1 bounds gate run before expensive geometry decoding.
They have separate real OpenGL 3.3 tests using a private EGL context. These tests
are intentionally small; they are not full-screen armor performance benchmarks.

## Early UV gate

Prepare the jar-derived humanoid carriers and the production early helper:

```sh
node tools/portable-renderer/armor-fast-test.mjs ../minecraft-research/armor-fast-validation
node tools/portable-renderer/armor-early-test.mjs ../minecraft-research/armor-fast-validation
cc tools/portable-renderer/armor-early-test.c \
  -o ../minecraft-research/armor-fast-validation/early-test \
  $(pkg-config --cflags --libs epoxy) -lm -Wall -Wextra -Werror
../minecraft-research/armor-fast-validation/early-test ../minecraft-research/armor-fast-validation
```

The shader receives actual sparse payloads from the production carrier encoder.
All eight parts, six carrier faces, mirrored limbs and four cyclic arena offsets
are checked at 17×13, 64×64 and 320×180. Header variants cover empty layers,
matching face routes, fully populated routes and a different body kind.
Every pixel must agree with the expected conservative face classification.
On NVIDIA GTX 1650 / 610.43.03 the test passed 2,304 draws / 47,552,256 pixels,
including 31,701,504 rejected unused pixels, with zero false rejections.

## AB1 inverse-ray bounds gate

```sh
node tools/portable-renderer/armor-bounds-test.mjs CONVERTED_ARMOR.png \
  ../minecraft-research/armor-bounds-validation
cc tools/portable-renderer/armor-bounds-test.c \
  -o ../minecraft-research/armor-bounds-validation/bounds-test \
  $(pkg-config --cflags --libs epoxy) -lm -Wall -Wextra -Werror
../minecraft-research/armor-bounds-validation/bounds-test \
  ../minecraft-research/armor-bounds-validation
```

The generator decodes original exported surface corners and triangle interior
points from three frames. It transforms those points **forward** through the
armor transform, view matrix and projection. The unchanged production GLSL
helper must accept the corresponding screen ray; the oracle does not duplicate
its inverse-ray calculation. Additional rays far outside the projected model
must reject, detecting an accidental always-visible implementation.

Coverage includes perspective and orthographic projections, both reversed-depth
conventions, left/right mirroring, reflected bases, wearer scales 0.05/1/16/80,
and a carrier around distance 400. The corrected heavy 216-face, 60-frame model
produces 51,840 surface projections. The initial unpadded helper rejected a tiny
wearer's exact surface corner; cancellation-dependent runtime padding fixed it.
The tested final helper SHA256 is
`61cba781537d235231589a8bbaac7e02a4fe1fa70e0fc4832a85e64bea977a69`.

These bounded tests establish conservativeness for the recorded cases, not all
floating-point inputs or devices. They do not certify full armor throughput,
and passing them does not remove the need for a small in-game rendering check.
