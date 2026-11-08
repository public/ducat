/**
 * `@ducatjs/money/testing/vitest`: one import in a Vitest setup file installs the money matchers,
 * value equality and the snapshot serializer, and types the matchers on `expect`:
 *
 *     // vitest.config.ts: test: { setupFiles: ['./test/setup.ts'] }
 *     import '@ducatjs/money/testing/vitest';
 */
import { expect } from 'vitest';
import { installMoneyMatchers, type MoneyMatchers } from './index.js';

export * from './index.js';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation
  interface Matchers<T = any> extends MoneyMatchers<T> {}
}

installMoneyMatchers(expect);
