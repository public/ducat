# How to test code that uses Money

This guide shows you how to set up Vitest, Jest or `bun test` so Money compares by value and prints readably, how to use the Money matchers, and how to write property tests with fast-check arbitraries. The helpers are in `@ducatjs/money/testing`; Vitest and fast-check are optional peer dependencies, used only by these entries, so production bundles are unaffected.

## Set up your test runner

Add one import to a setup file:

<!-- doctest: skip (a setup-file import, shown for its setup) -->

```ts
import '@ducatjs/money/testing/vitest'; // or '@ducatjs/money/testing/jest', or installMoneyMatchers(expect)
```

`toEqual`, `toStrictEqual` and nested structures then compare Money by value (1.0 EUR at scale 1 equals 1.00 EUR, and number and bigint minor units compare as equal), snapshots and failure diffs show `12.34 EUR`, and `console.log` shows `Money(12.34 EUR)`.

## Assert on amounts

Use the matchers, whose failures read "expected 12.35 EUR to be 12.34 EUR": `toBeMoney(amount, currency)`, `toHaveCurrency(code)`, the ordering matchers (`toBeGreaterThanMoney`…), and `toSumTo(total)` for allocation and instalment tests.

If a round-trip test must also check the scale, use `identical` rather than `equals`:

```ts
import { money } from '@ducatjs/money';

const one = money('1', 'EUR');
one.equals(money('1', 'EUR', { scale: 1 })); // → true
one.identical(money('1', 'EUR', { scale: 1 })); // → false
```

## Write property tests

Import the arbitraries from `@ducatjs/money/testing/arbitraries`. `arbMoney()` and `arbCurrency()` cover minor units beyond 2^53, currencies with exponents 0, 3 and 4, and scales above the currency's exponent:

<!-- doctest: skip (needs a test runner) -->

```ts
import fc from 'fast-check';
import { arbMoney } from '@ducatjs/money/testing/arbitraries';

test('a split always sums to its total', () => {
  fc.assert(fc.property(arbMoney(), (total) => expect(total.split(3)).toSumTo(total)));
});
```

## Add the matcher types for Jest

Vitest's types come with the import. For Jest, add the matchers to Jest's `Matchers` in a declaration file, in the form your Jest types use. ducat doesn't do this itself: augmenting Jest's global namespace clashes with Vitest's `Assertion` type (TS2320) in a project that has both.

With `@types/jest` (the global `jest` namespace):

<!-- doctest: skip (a declaration file for Jest projects; type-checked in test/jest-types) -->

```ts
import type { MoneyMatchers } from '@ducatjs/money/testing';
declare global {
  namespace jest {
    interface Matchers<R> extends MoneyMatchers<R> {}
  }
}
```

With `@jest/globals` (Jest's `expect` package, which must be resolvable from your project, so under pnpm add `expect` as a dev dependency):

<!-- doctest: skip (a declaration file for Jest projects) -->

```ts
import type { MoneyMatchers } from '@ducatjs/money/testing';
declare module 'expect' {
  interface Matchers<R> extends MoneyMatchers<R> {}
}
```

## Use `bun test`

Call `installMoneyMatchers(expect)`, which installs the matchers and the inspect hook. Bun supports neither custom equality testers nor snapshot serializers yet, so `toEqual` compares Money field by field there and snapshots show the fields; use `toBeMoney` instead.

## If two copies of ducat are installed

Value equality relies on `isMoney`, so a Money from a second installed copy of ducat is compared field by field, like any other object. Deduplicate the package.

## Related

- Reference: [`@ducatjs/money/testing`](../reference/testing.md)
- Explanation: [How ducat itself is tested](../explanation/how-ducat-is-tested.md)
