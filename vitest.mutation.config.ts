import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// The mutation run (stryker.config.json): the unit tests plus the database tests. Without
// DUCAT_PG_URL and DUCAT_MYSQL_URL only their SQLite parts run, through Node's built-in
// node:sqlite, so the adapters' shared code is mutation-tested without any server.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/**/*.test.ts'],
      exclude: ['test/browser/**'],
      testTimeout: 60_000,
    },
  }),
);
