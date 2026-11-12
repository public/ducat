# `@ducatjs/money/allocate`

Splitting an amount into parts that always sum to it. **Installs:** `allocate`, `split`, `instalments`, `schedule` and `chunk` on `Money`.

Related: [How to split and allocate amounts](../how-to/split-and-allocate.md) · [What is proved](../explanation/proofs.md)

Every function here is exact: the parts sum to the whole, and nothing is rounded with a rounding mode. A negative amount is split as the mirror image of the positive one. The parts are in the amount's currency and scale.

## Functions

### allocate

`allocate<C extends string>(money: Money<C>, weights: readonly Weight[], options?: AllocateOptions): Money<C>[]`

Method: `m.allocate(weights, options?)`.

Splits `money` into one part per weight, proportional to the weights. A zero weight gets zero. Weights are integers, bigints or decimal strings (`'33.3'`), read exactly; multiplying every weight by the same positive number changes nothing.

- **Remainder:** the units the proportional shares leave over go where `options.remainder` says (default `'largest'`). With `'largest'` each part is less than one unit from its exact share (proved: `alloc_near_largest`); with `'first'` and `'last'`, at most one unit.
- **Why `'largest'` is the default:** among all splits into whole units that add up to the total, it is the one closest to the exact shares. Each part is its share rounded down or up, and the leftover units go to the parts with the largest fractional remainders. That minimises the total absolute error, the total squared error and the largest single error at once. It optimises absolute error, not error relative to each weight, so it can show the Alabama paradox: raising the total by one unit can, rarely, lower one part by one unit (below). Use `'first'`, `'last'`, `'toFirst'` or `'toLast'` when the leftover should land in a predictable place instead.
- **Throws:** `RangeError` for no weights, a negative weight, all weights zero, or an unknown remainder strategy; `SyntaxError` for a string weight outside the decimal-string grammar.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

money('100', 'EUR').allocate([1, 1, 1]); // → [33.34 EUR, 33.33 EUR, 33.33 EUR]
money('0.05', 'EUR').allocate(['70', '30']); // → [0.04 EUR, 0.01 EUR]
money('-100', 'EUR').allocate([1, 1, 1]); // → [-33.34 EUR, -33.33 EUR, -33.33 EUR]
```

The Alabama paradox with the default `'largest'`: weights 1, 3 and 3 split three cents as one each, but four cents as 0, 2 and 2.

```ts
import { fromMinor } from '@ducatjs/money';
import '@ducatjs/money/allocate';

fromMinor(3, 'EUR').allocate([1, 3, 3]).map(String); // → ['0.01 EUR', '0.01 EUR', '0.01 EUR']
fromMinor(4, 'EUR').allocate([1, 3, 3]).map(String); // → ['0.00 EUR', '0.02 EUR', '0.02 EUR']
```

### split

`split<C extends string>(money: Money<C>, count: number, options?: AllocateOptions): Money<C>[]`

Method: `m.split(count, options?)`.

`count` near-equal parts: `allocate` with equal weights. The remainder goes per `options.remainder`.

- **Throws:** `RangeError` for a count that isn't a positive integer.

### instalments

`instalments<C extends string>(total: Money<C>, count: number, options?: InstalmentOptions<C>): Money<C>[]`

Method: `total.instalments(count, options?)`.

`count` payments, all the same regular amount except where the remainder goes. `options.remainder` is `'toFirst'` (the default: the first instalment absorbs it), `'toLast'`, `'first'` or `'last'`. With `options.unit`, every regular instalment is a whole multiple of the unit.

- **Throws:** `RangeError` for a count that isn't a positive integer, or a unit that isn't positive; `CurrencyMismatchError` for a unit in another currency.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

money('100', 'EUR').instalments(6); // → [16.70 EUR, 16.66 EUR, 16.66 EUR, 16.66 EUR, 16.66 EUR, 16.66 EUR]
money('100', 'EUR').instalments(3, { unit: money('1', 'EUR') }); // → [34.00 EUR, 33.00 EUR, 33.00 EUR]
```

### schedule

`schedule<C extends string>(total: Money<C>, tranches: readonly Tranche<C>[]): Money<C>[]`

Method: `total.schedule(tranches)`.

One part per tranche, in order: a fixed `amount`, a `percent` of the total (optionally with a `cap`), or the `rest`. Percentages are computed together by largest-remainder allocation, so no rounding mode is needed.

- **Throws:** `RangeError` for more than one rest tranche, percentages over 100, tranches that exceed the total, or a leftover without a rest tranche; `CurrencyMismatchError` for a tranche amount or cap in another currency.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

money('1000', 'EUR').schedule([{ percent: 30 }, { amount: money('200', 'EUR') }, { rest: true }]); // → [300.00 EUR, 200.00 EUR, 500.00 EUR]
```

### chunk

`chunk<C extends string>(total: Money<C>, max: Money<C>): Money<C>[]`

Method: `total.chunk(max)`.

Tranches of at most `max`: every one but the last is exactly `max`, and the last is positive. A zero total gives one zero tranche.

- **Throws:** `RangeError` when `max` isn't positive or `total` is negative; `CurrencyMismatchError` for a `max` in another currency.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

money('1000', 'EUR').chunk(money('300', 'EUR')); // → [300.00 EUR, 300.00 EUR, 300.00 EUR, 100.00 EUR]
```

## Types

- `Weight`: `number | bigint | string`, a non-negative integer, bigint or decimal string.
- `Remainder`: where the indivisible remainder goes. `'largest'` (Hamilton's largest-remainder method: units go to the biggest fractional parts, ties to the earlier bucket), `'first'` and `'last'` (one unit each to the first or last buckets with a non-zero weight), `'toFirst'` and `'toLast'` (the whole remainder to the first or last bucket).
- `AllocateOptions`: `{ remainder?: Remainder }`, for `allocate` and `split`.
- `InstalmentOptions<C>`: `{ remainder?: 'first' | 'last' | 'toFirst' | 'toLast'; unit?: Money<C> }`.
- `Tranche<C>`: `{ amount: Money<C> }`, `{ percent: Weight; cap?: Money<C> }` or `{ rest: true }`.
