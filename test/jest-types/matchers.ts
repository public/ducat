// Type check of the README's Jest typing snippet for @types/jest users (the global `jest`
// namespace), in a project of its own: next to Vitest's types it would clash (TS2320).
import { money } from '../../src/index.js';
import type { MoneyMatchers } from '../../src/testing/index.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the shape @types/jest declares
  namespace jest {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation
    interface Matchers<R> extends MoneyMatchers<R> {}
  }
}

declare const expect: <T>(actual: T) => jest.Matchers<void>;

expect(money('1', 'EUR')).toBeMoney('1', 'EUR');
expect([money('1', 'EUR')]).toSumTo(money('1', 'EUR'));
// @ts-expect-error toBeMoney needs a currency
expect(money('1', 'EUR')).toBeMoney('1');
