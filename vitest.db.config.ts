import { defineConfig } from 'vitest/config';

// database tests share one server per dialect, so files run one at a time
export default defineConfig({
  test: {
    include: ['test/db/**/*.test.ts'],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
