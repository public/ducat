// The Jest setup entry, loaded alone in its own file (a fresh module registry, no currency
// registered): it builds Money at load time, so it must register the ISO codes first.
import { expect, it } from 'vitest';
import { isCurrency } from '../src/currency.js';

// bun test shares one process across files: loading the entry here, against a stub, would cache it
// for test/testing.test.ts, which checks it installs on the real global expect
it.skipIf('Bun' in globalThis)(
  '@ducatjs/money/testing/jest loads alone, with every ISO code',
  async () => {
    // the Jest entry installs on Jest's global expect; give it one for the import
    const extensions: unknown[] = [];
    const stub = Object.assign(() => undefined, {
      extend: (matchers: unknown) => extensions.push(matchers),
      addEqualityTesters: (testers: unknown) => extensions.push(testers),
      addSnapshotSerializer: (serializer: unknown) => extensions.push(serializer),
    });
    const saved = (globalThis as { expect?: unknown }).expect;
    (globalThis as { expect?: unknown }).expect = stub;
    try {
      await import('../src/entries/testing-jest.js');
    } finally {
      (globalThis as { expect?: unknown }).expect = saved;
    }
    expect(extensions.length).toBeGreaterThan(0);
    expect(['USD', 'KWD', 'JPY'].every(isCurrency)).toBe(true);
  },
);
