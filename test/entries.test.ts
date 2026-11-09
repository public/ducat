// The /testing setup entries can't run in scripts/bundle-check.mjs (they install on a test runner's
// expect), so they're loaded here, in a file that registers no currency itself. They build Money at
// load time, which throws unless the entry registers the ISO codes before its module runs.
import { expect, it } from 'vitest';
import { isCurrency } from '../src/currency.js';

it('@ducatjs/money/testing/vitest loads alone, with every ISO code', async () => {
  await import('../src/entries/testing-vitest.js');
  expect(['USD', 'KWD', 'JPY'].every(isCurrency)).toBe(true);
});
