# AS1 proxy raster coverage

`armor-proxy-test.mjs` extracts the actual `oc_armor_as1_rect` function, AS1 vertex UV-to-proxy mapping, fragment screen-point reconstruction, and complete sparse carrier transport helper. It does not reimplement their executable expressions. Source SHA-256 values are recorded with generated test shaders. The fixture generator is shared with the original-versus-AS1 geometry test; these are standard head/body/arm/leg armor cube UV layouts and cyclic corner orders.

The C harness draws ordinary indexed triangles into a 16×16 RGBA32F target on a real GL3.3 context. It uses no transform feedback, storage writes, or full Minecraft client. Each covered pixel checks the reconstructed screen coordinate against `gl_FragCoord` and all four reconstructed source positions against CPU-assigned semantic UV corners. Accepted tolerances are 0.00005 for the combined maximum error. It also reads `gl_FrontFacing` and tests the intended wearer side with back-face culling enabled.

Run from the repository root, with an existing native EGL/epoxy development environment:

```sh
node tools/portable-renderer/armor-fast-test.mjs work/armor-affine-validation
node tools/portable-renderer/armor-proxy-test.mjs work/armor-proxy-validation work/armor-affine-validation
cc -O2 tools/portable-renderer/armor-proxy-test.c -o work/armor-proxy-validation/test $(pkg-config --cflags --libs epoxy egl) -lm
work/armor-proxy-validation/test work/armor-proxy-validation
work/armor-proxy-validation/test work/armor-proxy-validation --early
work/armor-proxy-validation/test work/armor-proxy-validation --negative
```

The negative-control command must return nonzero. Set `__EGL_VENDOR_LIBRARY_FILENAMES` to the desired vendor JSON when selecting one GPU on a multi-GPU system.

## Recorded result

NVIDIA GeForce GTX1650, driver610.43.03, OpenGL3.3: both the unchanged proxy and the early-outside-rectangle variant passed **3,720 draws /581,632 covered pixels, zero failures**. Each run contains:

- 2,272 full-viewport draws, spanning all eight target parts and their four side faces. Same-kind opposite limbs also produce a proxy; the separately tested AS1 pose helper rejects the wrong wearer side.
- 1,448 zero-pixel draws from other cube regions, side faces, or top/bottom caps.
- All four cyclic corner orders and base-vertex offsets0–7 for matching target/source parts.
- 1,024 matching draws with back-face culling enabled; no target coverage was lost and all covered pixels were front facing.

Removing the fragment's left-target screen-X correction produced **880 failed draws**, each failing all256 pixels. This negative control distinguishes the expected mirrored screen reconstruction from a vacuous draw-count check.

The early-return variant returns before sparse carrier encoding when its own original UV lies **strictly outside** the target rectangle. It still writes exactly the same clamped proxy position. Boundary vertices remain on the regular path. This is conservative for these standard armor cube layouts: every intended face corner lies inside the inclusive rectangle, while unwanted triangles remain degenerate regardless of unused varying values. The test does not claim safety for arbitrary nonstandard cube UV layouts.

This complements `armor-affine-test`: it proves proxy coverage, winding, sparse transport and screen reconstruction for the fixture geometry. It does not measure gameplay performance, animation/texture decoder parity, or Apple/Intel driver behavior. The small NVIDIA run does not reproduce the AMD heavy-armor stall.
