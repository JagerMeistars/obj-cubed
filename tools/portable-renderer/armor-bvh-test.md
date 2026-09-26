# AS2 GPU regression

`armor-bvh-test.mjs` assembles the current, unchanged AS2 traversal shader,
selected-quad decoder and AS1 wearer transform. The native OpenGL 3.3 harness
compares their output with an independent CPU forward transform and a scan of
every decoded triangle. It checks the selected surface and the decoded face's
center, including corner reversal for left limbs. Fixture hashes are recorded
in the preparation directory's `inputs.json`.

The matrix covers every source animation frame, easing modes 0–3 with global
tree bounds, the declared easing with per-segment bounds, orthographic and
perspective projections, both depth conventions, and ordinary 0.75×/1.4× and
reflected 80× wearer poses. The default runs torso, right-arm and left-arm
target metadata against the same source geometry. `--native-part` retains the
fixture's own target part. Rendering is limited to 16×16 for this proof.

```sh
node tools/portable-renderer/armor-bvh-test.mjs CONVERTED_AS2.png ../minecraft-research/armor-bvh-validation
cc tools/portable-renderer/armor-bvh-test.c -o ../minecraft-research/armor-bvh-validation/test $(pkg-config --cflags --libs epoxy) -lm -Wall -Wextra -Werror
../minecraft-research/armor-bvh-validation/test ../minecraft-research/armor-bvh-validation
```

A generated two-quad, four-frame fixture deliberately folds one quad out of
plane. It distinguishes the two possible quad diagonals. The optional negative
control changes only the prepared test shader, restoring the incorrect
right-limb diagonal for left limbs:

```sh
node tools/portable-renderer/armor-bvh-test.mjs --synthetic ../minecraft-research/armor-bvh-nonplanar-validation
../minecraft-research/armor-bvh-validation/test ../minecraft-research/armor-bvh-nonplanar-validation
node tools/portable-renderer/armor-bvh-test.mjs --synthetic ../minecraft-research/armor-bvh-negative-validation --negative-left-diagonal
../minecraft-research/armor-bvh-validation/test ../minecraft-research/armor-bvh-negative-validation --native-part
```

NVIDIA GTX 1650 / OpenGL 3.3 results:

| Input | Draws | Pixels | Reference hits | Failures |
|---|---:|---:|---:|---:|
| Real right-arm group, all three target poses | 10,800 | 2,764,800 | 11,532 | 0 |
| Real left-arm group, native target | 3,600 | 921,600 | 3,660 | 0 |
| Real torso group, native target | 3,600 | 921,600 | 6,848 | 0 |
| Synthetic nonplanar quads, all three target poses | 720 | 184,320 | 2,680 | 0 |
| Negative control, synthetic left target | 240 | 61,440 | 960 | **362 expected failures** |

The real groups each contain 68 quads and 60 frames. All positive runs had
zero bounded edge exceptions and zero difference between selected and nearest
CPU intersection distances. Maximum decoded face-center error was `0.001061`
at 80× scale. The negative control selected a surface up to `8.0541` units
behind the nearest one, proving the nonplanar diagonal case is exercised.

This matrix exposed a separate float32 ray-direction problem: subtracting two
near-plane points after a large view translation produced 302 wrong selections
under the reflected 80× perspective / zero-to-one projection. Computing the
direction in view coordinates before transforming it through the inverse view
rotation removed all 302 failures. The runtime AS2 shader contains that fix.
This is numerical and geometry evidence; actual-client frame rate is measured
separately.
