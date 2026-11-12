# `@ducatjs/money/fixed` and `@ducatjs/money/fixed/money`

`Fixed`, an exact decimal without a currency, for quantities, unit prices with more decimals than the currency, rates and values that aren't money yet. **Installs:** `/fixed` nothing; `/fixed/money` installs `toFixedPoint` on `Money` and `toMoney` on `Fixed`.

Related: [About exactness](../explanation/exactness.md) · [About the representation](../explanation/representation.md)

`@ducatjs/money/fixed` doesn't load Money or the currency table, so a program that uses only `Fixed` doesn't carry them. `@ducatjs/money/fixed/money` exports everything `/fixed` does, plus the conversions to and from Money.

## Functions

### fixed

`fixed(value: FixedInput, options?: FixedOptions): Fixed`

An exact fixed-point decimal.

- A string follows the [decimal-string grammar](money.md#decimal-strings) and keeps its own scale (`'12.340'` is scale 3).
- A number is read at its shortest decimal form, only when that has at most 15 significant digits, which a double always holds faithfully. An integer has scale 0.
- A bigint is an integer at scale 0. A `Fixed` is returned as it is (or rescaled with `options`).
- **Scale:** the input's, or `options.scale` (0 to 1000).
- **Rounds:** never by default; input with more decimals than `scale` throws unless `options.rounding` is given, and `rounding` needs a `scale`.
- **Throws:** `SyntaxError` for a string outside the grammar; `RangeError` for more than 1000 decimal places, a non-finite number, a number with more than 15 significant digits (so `fixed(0.1 + 0.2)` throws), or `rounding` without `scale`; `RoundingError` for more decimals than `scale` without `rounding`; `TypeError` for another type.

### fromScaled

`fromScaled(value: number | bigint, scale: number): Fixed`

The Fixed `value / 10^scale`: `fromScaled(12345, 3)` is 12.345.

- **Throws:** `RangeError` for a number that isn't a safe integer (pass a bigint) or an invalid scale; `TypeError` for another type.

### isFixed

`isFixed(value: unknown): value is Fixed`

Whether `value` is a Fixed.

### moneyToFixed

`moneyToFixed(money: Money<string>): Fixed` (from `/fixed/money`)

The exact Fixed of a Money amount, at the money's scale. Method: `m.toFixedPoint()`.

### fixedToMoney

`fixedToMoney<C extends CurrencyInput>(value: Fixed, currency: C, rounding?: RoundingMode): Money<C>` (from `/fixed/money`)

`value` as Money in `currency`, at the currency's exponent. Method: `value.toMoney(currency, rounding?)`.

- **Throws:** `RoundingError` when that would drop digits, unless `rounding` is given; `RangeError` for an unknown currency.

```ts
import { money } from '@ducatjs/money';
import { fixed, fromScaled } from '@ducatjs/money/fixed/money';

fixed('12.340').scale; // → 3
fixed('1.005', { scale: 2, rounding: 'halfEven' }); // → 1.00
fixed(0.1 + 0.2); // throws RangeError
fromScaled(12345, 3).toString(); // → '12.345'
money('12.34', 'EUR').toFixedPoint(); // → 12.34
fixed('1.005').toMoney('EUR', 'halfEven'); // → 1.00 EUR
fixed('1.005').toMoney('EUR'); // throws RoundingError
```

## Fixed

`Fixed` is immutable: readonly `value` (the scaled integer, a number while it is a safe integer and a bigint beyond) and `scale` (decimal places), so the decimal is `value / 10^scale`. The constructor is internal: calling `new Fixed()` throws a `TypeError`. Arguments typed `FixedInput` accept a decimal string, a number, a bigint or a Fixed, read as `fixed()` reads them.

### Arithmetic

- `add(other: FixedInput): Fixed` and `subtract(other: FixedInput): Fixed`: exact, at the larger of the two scales.
- `multiply(factor: Factor, rounding?: RoundingMode, options?: ArithmeticOptions): Fixed` and `divide(divisor: Factor, rounding?: RoundingMode, options?: ArithmeticOptions): Fixed`: the factor is exact (an integer, a decimal string, a bigint, a `ratio()` or another Fixed). **Rounds:** once, to this value's scale or `options.scale`, with `rounding` (default `'halfExpand'`); pass the scale rather than calling `toScale` afterwards, which would round twice. **Throws:** `RangeError` for a zero divisor; `RoundingError` for `'unnecessary'` when inexact.
- `negate(): Fixed` and `abs(): Fixed`.
- `round(rounding: RoundingMode, scale?: number): Fixed`: rounds to `scale` decimal places, **default 0** (a Fixed has no currency exponent).
- `toScale(scale: number, rounding?: RoundingMode): Fixed`: increasing the scale is exact; decreasing it rounds (default `'halfExpand'`).
- `trimScale(minimumScale?: number): Fixed`: the smallest scale, at least `minimumScale` (default 0), that keeps the value exact. It never adds digits.

`toScale` and `round` take any of the ten modes; `'unnecessary'` throws `RoundingError` if digits would be lost. Invalid scales throw `RangeError`.

### Compare

- `compare(other: FixedInput): -1 | 0 | 1`, exactly, across scales and number/bigint.
- `equals(other: FixedInput): boolean`: the same value at any scale (1.0 equals 1.00).
- `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`: `(other: FixedInput) => boolean`.
- `isZero(): boolean`, `isPositive(): boolean`, `isNegative(): boolean`, `sign(): -1 | 0 | 1`.

### Read

- `toString(): string`: the plain decimal string with every place of the scale (`'12.340'`).
- `toJSON(): string`: the same string, so JSON round-trips through `fixed()`.
- `toScaled(): ScaledInteger`: `{ value, scale }`.
- `toRatio(): Ratio`: the value as a reduced `Ratio`. A Fixed is a factor everywhere already; this keeps a ratio for reuse.
- `toNumber(): number`: the nearest double, for display and charts: lossy on purpose.
- `toMoney(currency, rounding?)`: needs `import '@ducatjs/money/fixed/money'`; see [fixedToMoney](#fixedtomoney).
- `Number(f)`, `+f`, `a + b` and `a > b` throw a `TypeError`; template strings use `toString()`.

```ts
import { money } from '@ducatjs/money';
import { fixed } from '@ducatjs/money/fixed';

const unitPrice = fixed('0.0425');
unitPrice.multiply(1200); // → 51.0000
fixed('100.00').divide(3, 'halfEven'); // → 33.33
fixed('9.990').divide('1.2', 'halfEven', { scale: 2 }); // → 8.32
fixed('1.5').add('0.25'); // → 1.75
fixed('2.5').round('halfEven'); // → 2
fixed('12.3400').trimScale(); // → 12.34
JSON.stringify({ unitPrice }); // → '{"unitPrice":"0.0425"}'
fixed('0.0725').toRatio(); // → { num: 29n, den: 400n, n: 29, d: 400 }
money('199.99', 'EUR').multiply(fixed('0.0725'), 'halfEven'); // → 14.50 EUR
```

## Types

- `Fixed`: see [Fixed](#fixed).
- `FixedInput`: `string | number | bigint | Fixed`.
- `FixedOptions`: `{ scale?: number; rounding?: RoundingMode }`; `rounding` defaults to `'unnecessary'` (throw).
- `ArithmeticOptions`: `{ scale?: number }`, the result's scale for `multiply` and `divide` (default: this value's).
- `ScaledInteger`: `{ value: number | bigint; scale: number }`.
