# `@ducatjs/money/exact`

`ExactMoney`, an exact rational amount for chained calculations that round once at the end. **Installs:** `exact`, `addTaxExact` and `extractTaxExact` on `Money`.

Related: [How to add and extract tax](../how-to/add-and-extract-tax.md) · [How to convert currencies](../how-to/convert-currencies.md) · [About rounding](../explanation/rounding.md)

## Functions

### exact

`exact<C extends string>(money: Money<C>): ExactMoney<C>`

Method: `m.exact()`.

The exact value of `money`, to chain: `exact(price).divide(3).round('halfEven')`.

### sumExact

`sumExact<C extends string>(items: readonly ExactMoney<C>[], currency?: C): ExactMoney<C>`

The exact sum; zero of `currency` for an empty list. Round it once for a batch's total.

- **Throws:** `RangeError` for an empty list without `currency`; `CurrencyMismatchError` for mixed currencies.

### addTaxExact

`addTaxExact<C extends string>(net: Money<C> | ExactMoney<C>, percent: Factor): ExactTaxBreakdown<C>`

Method: `net.addTaxExact(percent)`.

Tax-exclusive, rounding nothing: `tax = net × percent/100` and `gross = net + tax`, exactly.

### extractTaxExact

`extractTaxExact<C extends string>(gross: Money<C> | ExactMoney<C>, percent: Factor): ExactTaxBreakdown<C>`

Method: `gross.extractTaxExact(percent)`.

Tax-inclusive, rounding nothing: `net = gross / (1 + percent/100)` and `tax = gross − net`, exactly. Sum the parts over many rows and round each total once.

### isExactMoney

`isExactMoney(value: unknown): value is ExactMoney<string>`

Whether `value` is an `ExactMoney` from this copy of the package.

```ts
import { money } from '@ducatjs/money';
import { exact, extractTaxExact, sumExact } from '@ducatjs/money/exact';

extractTaxExact(money('12', 'EUR'), '20'); // → { net: 10 EUR, tax: 2 EUR, gross: 12 EUR }
money('10.01', 'EUR').addTaxExact('7.7').tax.toString(); // → '77077/100000 EUR'
sumExact([exact(money('1', 'EUR')).divide(3), exact(money('2', 'EUR')).divide(3)]); // → 1 EUR
```

## ExactMoney

`ExactMoney<C extends string>` is an exact amount: `num/den` major units of `currency`, reduced, with `den > 0`. Its fields `currency`, `num` (bigint) and `den` (bigint) are readonly. Build one with `exact()`; the constructor is internal. Every method returns a new value.

Arguments typed `ExactMoney<C> | Money<C>` take either, exactly; Money in another currency throws `CurrencyMismatchError`.

### Arithmetic

- `add(other: ExactMoney<C> | Money<C>): ExactMoney<C>` and `subtract(other: ExactMoney<C> | Money<C>): ExactMoney<C>`, exactly.
- `multiply(factor: Factor): ExactMoney<C>` and `divide(divisor: Factor): ExactMoney<C>`, exactly. **Throws:** `RangeError` for a zero divisor.
- `negate(): ExactMoney<C>` and `abs(): ExactMoney<C>`.
- `percentage(percent: Factor): ExactMoney<C>`: `percent`% of the amount, exactly.
- `ratioOf(total: ExactMoney<C> | Money<C>): Ratio`: the exact share, as [`ratioOf`](math.md#ratioof). **Throws:** `RangeError` for a zero total.
- `convert<To extends string>(rate: Rate<C, To>): ExactMoney<To>`: converts at an exact [`Rate`](convert.md), rounding nothing. **Throws:** `CurrencyMismatchError` when the rate is from another currency.

### Compare

- `compare(other: ExactMoney<C> | Money<C>): -1 | 0 | 1`, and `lessThan`, `lessThanOrEqual`, `greaterThan` and `greaterThanOrEqual` (each `(other: ExactMoney<C> | Money<C>) => boolean`).
- `equals(other: ExactMoney | Money): boolean`: the same currency and exact value; another currency is `false`.
- `min(...others)`, `max(...others)` (the first wins ties) and `clamp(lo, hi)`, all returning `ExactMoney<C>`. **Throws:** `RangeError` from `clamp` when `lo > hi`.
- `sign(): -1 | 0 | 1`, `isZero(): boolean`, `isPositive(): boolean`, `isNegative(): boolean`.
- `isExact(scale?: number): boolean`: whether the amount fits `scale` (default: the currency's exponent) without rounding.

### Round and read

- `round(rounding?: RoundingMode, scale?: number): Money<C>`, or `round(policy: RoundingPolicy): Money<C>`: rounds once, to `scale` (default: the currency's exponent) with `rounding` (default `'halfExpand'`), or to the policy's scale and increment. **Throws:** `RoundingError` for `'unnecessary'` when inexact; `RangeError` for an invalid scale.
- `roundWithResidual(rounding?: RoundingMode, scale?: number): Rounded<C>`, or `roundWithResidual(policy: RoundingPolicy): Rounded<C>`: rounds as `round` and also returns what rounding left out, for booking it (an "FX rounding" ledger line).
- `toNumber(): number`: the amount in major units as the nearest double, rounded once (10/3 EUR is 3.3333333333333335); ±Infinity beyond the largest double. Lossy on purpose.
- `toString(): string`: `'10/3 EUR'`, or `'10 EUR'` for a whole amount, for debugging.
- Numeric coercion (`a + b`, `a > b`) throws a `TypeError`: round first.

```ts
import { money } from '@ducatjs/money';
import { cashPolicy } from '@ducatjs/money/cash';
import { exact } from '@ducatjs/money/exact';

const share = exact(money('10.03', 'CHF')).divide(3); // → 1003/300 CHF
share.add(money('0.50', 'CHF')).max(money('3.50', 'CHF')); // → 1153/300 CHF
share.lessThan(money('3.35', 'CHF')); // → true
share.isExact(); // → false
share.round(cashPolicy('CHF')); // → 3.35 CHF
share.round('halfEven'); // → 3.34 CHF
share.roundWithResidual('halfEven').residual; // → 1/300 CHF
```

## Types

- `ExactMoney<C>`: see [ExactMoney](#exactmoney).
- `ExactTaxBreakdown<C>`: `{ net: ExactMoney<C>; tax: ExactMoney<C>; gross: ExactMoney<C> }`, where `net + tax` is exactly `gross` and nothing is rounded.
- `Rounded<C>`: `{ value: Money<C>; residual: ExactMoney<C> }`, where `value + residual` is exactly the unrounded amount.
