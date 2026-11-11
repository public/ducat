# `@ducatjs/money/math`

Averages, shares, integral division, trimming the scale, and exact arithmetic on ratios. **Installs:** `ratioOf`, `divideToIntegral`, `remainder` and `trimScale` on `Money`.

Related: [How to split and allocate amounts](../how-to/split-and-allocate.md) · [About exactness](../explanation/exactness.md)

## Functions on amounts

### average

`average<C extends string>(amounts: readonly Money<C>[], rounding?: RoundingInput): Money<C>`

The exact sum divided by the count, rounded once at the largest scale in the list, with `rounding` (default `'halfExpand'`) or to a policy's scale and increment.

- **Throws:** `RangeError` for an empty list; `CurrencyMismatchError` for mixed currencies (a compile error for literal types).

### ratioOf

`ratioOf<C extends string, O extends string = C>(money: Money<C>, other: MoneyOperand<NoInfer<C>, O>): Ratio`

Method: `part.ratioOf(total)`.

The exact share `money / other`, reduced, for any scales. A `Ratio` goes straight to `multiply` or `allocate`.

- **Throws:** `RangeError` when `other` is zero; `CurrencyMismatchError` for another currency; `TypeError` when `other` isn't Money.

### divideToIntegral

`divideToIntegral<C extends string, O extends string = C>(money: Money<C>, divisor: MoneyOperand<NoInfer<C>, O>): number | bigint`

Method: `m.divideToIntegral(divisor)`.

How many whole times `divisor` fits into `money`, truncated toward zero: a number while it is a safe integer, a bigint beyond. `money = divisor × divideToIntegral(money, divisor) + remainder(money, divisor)` exactly.

- **Throws:** `RangeError` for a zero divisor; `CurrencyMismatchError` for another currency.

### remainder

`remainder<C extends string, O extends string = C>(money: Money<C>, divisor: MoneyOperand<NoInfer<C>, O>): Money<C>`

Method: `m.remainder(divisor)`.

What is left of `money` after taking `divisor` out a whole number of times, at the larger scale, with `money`'s sign (as JavaScript's `%`).

- **Throws:** as `divideToIntegral`.

### trimScale

`trimScale<C extends string>(money: Money<C>, minimumScale?: number): Money<C>`

Method: `m.trimScale(minimumScale?)`.

The same amount at the smallest scale that keeps it exact, but not below `minimumScale` (default: the currency's exponent). An amount at or below the minimum is returned unchanged; trimming never adds digits.

```ts
import { money } from '@ducatjs/money';
import { average } from '@ducatjs/money/math';

average([money('10', 'EUR'), money('10', 'EUR'), money('10.01', 'EUR')]); // → 10.00 EUR
money('25', 'EUR').ratioOf(money('100', 'EUR')); // → { num: 1n, den: 4n, n: 1, d: 4 }
money('9.99', 'EUR').divideToIntegral(money('2.50', 'EUR')); // → 3
money('9.99', 'EUR').remainder(money('2.50', 'EUR')); // → 2.49 EUR
money('-10', 'EUR').remainder(money('3', 'EUR')); // → -1.00 EUR
money('1.2300', 'EUR', { scale: 4 }).trimScale(); // → 1.23 EUR
```

## Functions on ratios

Each side may be a `Ratio`, a `Fixed`, a decimal or `'a/b'` string, or an integer (any `Factor`). The result is a reduced `Ratio`, exact. They throw what [`ratio`](money.md#ratio) throws for a value that isn't a factor.

- `ratioAdd(left: Factor, right: Factor): Ratio`: `left + right`.
- `ratioSubtract(left: Factor, right: Factor): Ratio`: `left − right`.
- `ratioMultiply(left: Factor, right: Factor): Ratio`: `left × right`.
- `ratioDivide(left: Factor, right: Factor): Ratio`: `left ÷ right`. **Throws:** `RangeError` when `right` is zero.
- `ratioNegate(value: Factor): Ratio`: `−value`.
- `ratioComplement(value: Factor): Ratio`: `1 − value`, the complement of a share or rate.
- `ratioCompare(left: Factor, right: Factor): -1 | 0 | 1`.

```ts
import { money, ratio } from '@ducatjs/money';
import { ratioAdd, ratioCompare, ratioComplement } from '@ducatjs/money/math';

ratioComplement('0.15'); // → { num: 17n, den: 20n, n: 17, d: 20 }
money('80.00', 'EUR').multiply(ratioComplement('0.15')); // → 68.00 EUR
ratioAdd('0.19', ratio(1, 3)); // → { num: 157n, den: 300n, n: 157, d: 300 }
ratioCompare('1/3', '0.3333'); // → 1
```
