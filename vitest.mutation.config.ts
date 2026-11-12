import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// The mutation run (stryker.config.json): the unit tests plus the database tests. Without
// DUCAT_PG_URL and DUCAT_MYSQL_URL only their SQLite parts run, through Node's built-in
// node:sqlite, so the adapters' shared code is mutation-tested without any server. The test
// options replace the base config's rather than merging, which would keep its test/db exclude.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/**/*.test.ts'],
    exclude: ['test/browser/**'],
    testTimeout: 60_000,
  },
});
