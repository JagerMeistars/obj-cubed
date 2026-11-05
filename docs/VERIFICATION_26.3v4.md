# 26.3v4 release checks

Minecraft 26.3, Blockbench plugin 0.11.0.

- All 588 unit tests passed, including texture animation without geometry animation, datapack targets and the three shading modes.
- The pack validator checked 22 shader files, resource format 97.1 and data format 121.0.
- The release build checks the embedded equipment catalog and preserves the upstream license in the resource pack. Its local `provenance.json` lists the hashes of individual pack files.

| Release file | SHA-256 |
| --- | --- |
| `objcubed.js` | `23d842af44453cf1bc27560e9ba6e70c1a9ea253ecc960b50ce5e6065ba199d4` |
| `objcubed.zip` | `2fcda87fe182250dc2c4f8c5164651d52e623286152641a9df3e51dd94f6b6ff` |

This release check did not include a new in-game FPS benchmark or a fresh AMD or Vulkan run.
