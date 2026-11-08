/**
 * `@ducatjs/money/testing/jest`: one import in a Jest setup file (`setupFilesAfterEnv`) installs
 * the money matchers, value equality and the snapshot serializer on Jest's global `expect`. It
 * needs no Jest package of its own. For the types, add `MoneyMatchers` to Jest's `Matchers` in a
 * declaration file (see the README): augmenting Jest's global namespace from here would clash
 * with Vitest's types in projects that have both.
 */
import { installMoneyMatchers, type ExpectWithExtensions } from './index.js';

export * from './index.js';

const globalExpect = (globalThis as { expect?: ExpectWithExtensions }).expect;
if (globalExpect === undefined) {
  throw new Error(
    '@ducatjs/money/testing/jest needs Jest’s global expect; import it from a setup file, or call installMoneyMatchers(expect)',
  );
}
installMoneyMatchers(globalExpect);
