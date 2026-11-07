import codspeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // measures bench/ under CodSpeed in CI; outside CodSpeed's runner it leaves vitest unchanged
  plugins: [codspeedPlugin()],
  test: {
    // `pnpm test` runs only tests; benchmarks run through `pnpm bench:codspeed`
    include: ['test/**/*.test.ts'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
  },
});
