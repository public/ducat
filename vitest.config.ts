import codspeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vitest/config';

// deep property runs (pnpm test:deep) take minutes per property
const isDeepRun = process.env.DUCAT_DEEP === '1';

// A deep run gets one fresh seed for the whole run, chosen here in the main process and handed to
// every test worker, so DUCAT_SEED=<seed> reproduces all of it.
if (isDeepRun && !process.env.DUCAT_SEED) {
  process.env.DUCAT_SEED = String((Date.now() ^ (Math.random() * 2 ** 31)) | 0);
}

export default defineConfig({
  // measures bench/ under CodSpeed in CI; outside CodSpeed's runner it leaves vitest unchanged
  plugins: [codspeedPlugin()],
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/db/**', 'test/browser/**'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
    setupFiles: ['test/setup-currencies.ts', 'test/setup.ts'],
    env: process.env.DUCAT_SEED ? { DUCAT_SEED: process.env.DUCAT_SEED } : {},
    testTimeout: isDeepRun ? 3_600_000 : 20_000,
  },
});
