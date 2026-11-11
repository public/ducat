# `@ducatjs/money/format`

Locale formatting through `Intl.NumberFormat`. **Installs:** `format` and `formatToParts` on `Money`.

Related: [How to format amounts for display](../how-to/format-amounts.md) · [How to parse user input](../how-to/parse-user-input.md) · [About the representation](../explanation/representation.md) (engine notes)

## Functions

### format

`format(money: Money<string>, locale?: string, options?: FormatOptions): string`

Method: `m.format(locale?, options?)`.

The amount formatted as currency in `locale` (default: the runtime's). The digits shown are the value's scale, set explicitly whatever the engine's default digits for the currency; `options` are passed to `Intl.NumberFormat` after them, so an explicit `minimumFractionDigits` or `maximumFractionDigits` overrides them. Formatters are cached (up to 256).

- With `digits`, the amount is first rounded once, exactly, to `digits` decimal places with `rounding` (default `'halfExpand'`), as `toScale` does, and then shown with that many fraction digits. A larger `digits` pads: 12.3 EUR at `digits: 4` is €12.3000. ducat rounds, not Intl, so the result is exact at any size and in any rounding mode.

- Below 10^15 minor units the value is passed to Intl as `minor / 10^scale`, a single correctly rounded division bit-identical to `Number(toDecimal(m))`. Larger values go as the exact decimal string, which needs Intl.NumberFormat v3 (Node 19+, Safari 15.4+, Firefox 116+); Node 18 loses digits beyond 2^53 there.
- **Rounds:** only with `digits`, once, with `rounding`. Without it nothing is rounded.
- **Throws:** `TypeError` for `minimumFractionDigits` or `maximumFractionDigits` beside `digits`, or `rounding` without `digits` (Intl would round a second time, on a double); `RangeError` for an invalid locale or options, as `Intl.NumberFormat` does.

### formatToParts

`formatToParts(money: Money<string>, locale?: string, options?: FormatOptions): Intl.NumberFormatPart[]`

Method: `m.formatToParts(locale?, options?)`.

As `format`, as Intl's parts, for styling the currency symbol separately. It takes `digits` and `rounding` too.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/format';

money('25', 'EUR').format('de-DE'); // → '25,00 €'
money('1234.5', 'EUR').format('en-GB', { currencyDisplay: 'code' }); // → 'EUR 1,234.50'
money('1.500', 'KWD', { scale: 3 }).format('en'); // → 'KWD 1.500'
money('0.123456', 'EUR', { scale: 6 }).format('en', { digits: 4 }); // → '€0.1235'
money('12.3', 'EUR').format('en', { digits: 4 }); // → '€12.3000'
money('1.005', 'EUR', { scale: 3 }).format('en', { digits: 2, rounding: 'halfEven' }); // → '€1.00'
money('1', 'EUR').format('en', { digits: 2, maximumFractionDigits: 3 }); // throws TypeError
const parts = money('5', 'EUR').formatToParts('en');
parts.map((part) => part.type); // → ['currency', 'integer', 'decimal', 'fraction']
```

## Types

- `FormatOptions`: `Intl.NumberFormatOptions` plus `digits?: number` (round once, exactly, to that many decimal places, and show that many) and `rounding?: RoundingMode` (how `digits` rounds, default `'halfExpand'`). Every other Intl option passes through.
