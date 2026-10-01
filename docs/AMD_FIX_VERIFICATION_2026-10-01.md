# 26.3 shader update, 2026-10-01

This update incorporates the AMD test3 carrier and animation changes into the
standard resource pack. It contains no DREVO models, Chroma integration, or
diagnostic overlays. The Blockbench plugin is unchanged.

- Repeated item carriers gather matching vertices by model buffer base, sprite
  origin, and instance. Three available corners reconstruct the fourth.
- If fewer than three corners are available, every affected triangle is rejected,
  including failures at non-provoking vertices. This prevents invalid triangles
  but does not restore missing geometry.
- One-shot playback derives its frame and interpolation fraction from the same
  clamped phase, preventing rounding from returning to the previous frame.

Fresh checks on the standard pack with RTX 4060 Ti, driver 595.71:

- 443 existing unit tests and resource-pack structure validation passed.
- All 83 shader variants compiled through ShaderC / SPIRV-Cross and linked in
  hidden OpenGL. This is not a live Vulkan gameplay test.
- 63 renders passed the existing decoded-model comparison tolerances.
- Eight injected corner failures matched the geometry reference exactly under
  both provoking-vertex conventions; the old fallback failed all eight cases.
- Five animations passed 21 endpoint times each, including day wrap and manual
  last-frame latching.

The RX 6700 XT tester reported normal animations and mostly complete models
after test2, with small flyouts remaining. Test3's per-corner rejection is locally
verified; complete AMD geometry recovery and gameplay FPS are not established.
Do not describe this release as eliminating all AMD rendering defects.
