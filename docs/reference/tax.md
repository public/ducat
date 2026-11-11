# `@ducatjs/money/tax`

Percentages, discounts and tax. **Installs:** `percentage`, `discount`, `addTax` and `extractTax` on `Money`.

Related: [How to add and extract tax](../how-to/add-and-extract-tax.md) · [`@ducatjs/money/exact`](exact.md) for unrounded tax parts · [About rounding](../explanation/rounding.md)

A `percent` is a `Factor` read exactly: `20`, `'7.7'`, `'1/3'`, a `ratio()` or a `Fixed`. Every function rounds once; `rounding` is a mode (default `'halfExpand'`) or a [rounding policy](policy.md).

## Functions

### percentage

`percentage<C extends string>(money: Money<C>, percent: Factor, rounding?: RoundingInput): Money<C>`

Method: `m.percentage(percent, rounding?)`.

`percent`% of `money`, rounded once to its scale (or to the policy).

### discount

`discount<C extends string>(price: Money<C>, percent: Factor, rounding?: RoundingInput): Money<C>`

Method: `price.discount(percent, rounding?)`.

The price after a `percent`% discount. A rounding mode rounds the discount amount; a policy rounds the discounted price itself, so it lands on the policy's scale and increment.

### addTax

`addTax<C extends string>(net: Money<C>, percent: Factor, rounding?: RoundingInput): TaxBreakdown<C>`

Method: `net.addTax(percent, rounding?)`.

Tax-exclusive: adds `percent`% tax to a net amount. `net + tax` is always exactly `gross`.

- **Rounds:** a rounding mode rounds the tax; a policy rounds the gross (the amount charged). The other part is the exact difference.

### extractTax

`extractTax<C extends string>(gross: Money<C>, percent: Factor, rounding?: RoundingInput): TaxBreakdown<C>`

Method: `gross.extractTax(percent, rounding?)`.

Tax-inclusive (VAT extraction): `net = gross / (1 + percent/100)`, rounded, and `tax = gross − net`, so the parts always add up.

- **Rounds:** the net, with a mode or a policy. With a policy, the tax is on the policy's increment too whenever the gross is.

All four throw what `multiply` throws ([money.md](money.md#multiply)): `RoundingError` for `'unnecessary'` when the result is inexact, `TypeError` or `RangeError` for a value that isn't a factor, and `CurrencyMismatchError` for a policy restricted to another currency.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/tax';

money('80', 'EUR').percentage('12.5', 'halfEven'); // → 10.00 EUR
money('10', 'EUR').addTax('20', 'halfEven'); // → { net: 10.00 EUR, tax: 2.00 EUR, gross: 12.00 EUR }
money('12', 'GBP').extractTax(20); // → { net: 10.00 GBP, tax: 2.00 GBP, gross: 12.00 GBP }
money('100', 'EUR').discount(15); // → 85.00 EUR
```

## Types

- `TaxBreakdown<C>`: `{ net: Money<C>; tax: Money<C>; gross: Money<C> }`, where `gross` is always exactly `net + tax`.
