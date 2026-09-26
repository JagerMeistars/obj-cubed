# Coordinate precision check

The position texture stores RGB24 integers with a bias of 8,388,608 and
16 fractional bits. The GPU test extracts `getpos` from the actual pack,
uploads normalized RGBA8 textures, and compares transform-feedback results
against the integer format on the CPU. Every RGB24 value is exercised in
each of the three coordinate components: 50,331,648 decoded coordinates.

Requirements: Node.js, a C compiler, `pkg-config`, libepoxy and an EGL OpenGL
driver. From the repository root:

```sh
node tools/render-tester/coordinate-decode.mjs
```

On a system with separate NVIDIA and Mesa EGL installations, Mesa can be
selected explicitly:

```sh
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json node tools/render-tester/coordinate-decode.mjs
```

NVIDIA GTX 1650 and AMD Renoir both returned zero errors with the integer-byte
decoder. The preceding normalized-channel arithmetic differed from the
encoded values in 28,433,469 and 12,555,255 component checks respectively;
the largest error on either driver was 0.000030517578125 (two encoding steps).
This is a numerical precision check, separate from carrier gathering,
animation and actual Minecraft rendering.
