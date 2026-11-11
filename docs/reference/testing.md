# `@ducatjs/money/testing`

Test helpers for Vitest and Jest: matchers, value equality, a snapshot serializer, and fast-check arbitraries. **Installs:** nothing on `Money`; `/testing/vitest` and `/testing/jest` install the matchers on `expect` when imported.

Related: [How to test code that uses money](../how-to/test-code-that-uses-money.md)

| entry                                | what it does                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ducatjs/money/testing`             | the helpers below; nothing runs on import                                                                                                                                                                                     |
| `@ducatjs/money/testing/vitest`      | the same exports, and calls `installMoneyMatchers(expect)` on Vitest's `expect`                                                                                                                                               |
| `@ducatjs/money/testing/jest`        | the same exports, and calls `installMoneyMatchers` on Jest's global `expect`; import it from a setup file (`setupFilesAfterEnv`). It needs no Jest package of its own, and throws an `Error` when there is no global `expect` |
| `@ducatjs/money/testing/arbitraries` | `arbMoney`, `arbCurrency` for fast-check                                                                                                                                                                                      |

Vitest and fast-check are optional peer dependencies, used only by these entries. Nothing in the core changes, so production bundles are unaffected. Vitest's types come with the import; for Jest, add `MoneyMatchers` to Jest's `Matchers` in a declaration file (ducat doesn't, because augmenting Jest's global namespace clashes with Vitest's `Assertion` type, TS2320, in a project that has both).

## Functions and values

### installMoneyMatchers

`installMoneyMatchers(expect: ExpectWithExtensions): void`

Installs everything on a test runner's `expect`: the matchers, value equality and the snapshot serializer. It also gives Money a Node inspect hook, so `console.log(price)` prints `Money(12.34 EUR)`. Safe to call more than once. A runner without `addEqualityTesters` or `addSnapshotSerializer` (Bun supports neither) gets the matchers and the inspect hook; there `toEqual` compares Money field by field and snapshots show the fields, so use `toBeMoney`.

### moneyMatchers

`moneyMatchers`: the matcher implementations, for `expect.extend`. Failures read "expected 12.35 EUR to be 12.34 EUR".

| matcher                              | passes when the received value is…                                               |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `toBeMoney(amount, currency)`        | Money equal to `amount` in `currency`, at any scale: `toBeMoney('12.34', 'EUR')` |
| `toHaveCurrency(code)`               | Money in `code`                                                                  |
| `toBeGreaterThanMoney(other)`        | Money greater than `other` (same currency)                                       |
| `toBeGreaterThanOrEqualMoney(other)` | Money greater than or equal to `other`                                           |
| `toBeLessThanMoney(other)`           | Money less than `other`                                                          |
| `toBeLessThanOrEqualMoney(other)`    | Money less than or equal to `other`                                              |
| `toSumTo(total)`                     | a list of Money that sums exactly to `total`, as allocations must                |

`toSumTo` throws when the received value isn't a list of Money or a part is in another currency: that is a mistake in the test, not a failure.

### moneyEquality

`moneyEquality: MoneyEqualityTester`

An equality tester for `expect.addEqualityTesters`: Money compares by value in `toEqual`, `toStrictEqual` and nested structures, same currency and same amount whatever the scale (1.0 EUR at scale 1 equals 1.00 EUR) and whether the minor units are a number or a bigint. For anything other than two Money values it returns `undefined`, so the usual comparison applies. It relies on `isMoney`, so a Money from a second installed copy of ducat is compared field by field, like any other object.

### moneySerializer

`moneySerializer: { test(value): boolean; serialize(value): string }`

A snapshot serializer that prints Money as `12.34 EUR` (unquoted, so it isn't a string), in snapshots and failure diffs.

## `@ducatjs/money/testing/arbitraries`

### arbMoney

`arbMoney<C extends string = string>(options?: ArbMoneyOptions<C>): Arbitrary<Money<C>>`

Money values for property tests: `arbMoney()`, `arbMoney({ currency: 'EUR', min: '0', max: '100' })`. With bounds, every value is within them; without, minor units reach ±10^30 (beyond 2^53). Scales are mostly the currency's exponent, sometimes up to three more decimals.

### arbCurrency

`arbCurrency(options?: ArbCurrencyOptions): Arbitrary<string>`

Currency codes, by default a representative mix of exponents 0, 2, 3 and 4 (JPY, EUR, KWD, CLF…). `{ all: true }` draws from every ISO 4217 code, `extra` adds codes (custom ones from `defineCurrency`), and `exponents` narrows whichever pool that is.

## Types

- `MoneyMatchers<R>`: the matchers' signatures, for `declare module` augmentation of Vitest's `Assertion` or Jest's `Matchers`.
- `MoneyMatcherContext`: `{ isNot: boolean }`, the part of the runner's matcher state the matchers receive as `this`.
- `MoneyMatcherResult`: `{ pass: boolean; message: () => string; actual?: unknown; expected?: unknown }`.
- `MoneyEqualityTester`: `(left: unknown, right: unknown) => boolean | undefined`.
- `ExpectWithExtensions`: the parts of `expect` used: `extend`, and optionally `addEqualityTesters` and `addSnapshotSerializer`.
- `ArbMoneyOptions<C>`: `{ currency?: C | Arbitrary<C>; min?: string | number | bigint; max?: string | number | bigint; scale?: number | Arbitrary<number> }`. `min` and `max` are in major units.
- `ArbCurrencyOptions`: `{ exponents?: readonly number[]; all?: boolean; extra?: readonly string[] }`.
