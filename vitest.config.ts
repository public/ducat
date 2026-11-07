import { defineConfig } from 'vitest/config';

// deep property runs (npm run test:deep) take minutes per property
const isDeepRun = process.env.DUCAT_DEEP === '1';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/db/**', 'test/browser/**'],
    setupFiles: ['test/setup.ts'],
    testTimeout: isDeepRun ? 3_600_000 : 20_000,
  },
});
