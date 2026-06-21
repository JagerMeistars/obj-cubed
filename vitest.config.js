import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: the plugin's pure logic uses Node fs/zlib; no DOM needed
    // for L1/L2. The Blockbench API is hand-stubbed in test/helpers.
    environment: 'node',
    include: ['test/**/*.test.mjs'],
    reporters: 'default',
  },
});
