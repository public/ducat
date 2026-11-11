# `@ducatjs/money/format`

Locale formatting through `Intl.NumberFormat`. **Installs:** `format` and `formatToParts` on `Money`.

Related: [How to parse user input](../how-to/parse-user-input.md) · [About the representation](../explanation/representation.md) (engine notes)

## Functions

### format

`format(money: Money<string>, locale?: string, options?: Intl.NumberFormatOptions): string`

Method: `m.format(locale?, options?)`.

The amount formatted as currency in `locale` (default: the runtime's). The digits shown are the value's scale, set explicitly whatever the engine's default digits for the currency; `options` are passed to `Intl.NumberFormat` after them, so an explicit `minimumFractionDigits` or `maximumFractionDigits` overrides them. Formatters are cached (up to 256).

- Below 10^15 minor units the value is passed to Intl as `minor / 10^scale`, a single correctly rounded division bit-identical to `Number(toDecimal(m))`. Larger values go as the exact decimal string, which needs Intl.NumberFormat v3 (Node 19+, Safari 15.4+, Firefox 116+); Node 18 loses digits beyond 2^53 there.
- **Throws:** `RangeError` for an invalid locale or options, as `Intl.NumberFormat` does.

### formatToParts

`formatToParts(money: Money<string>, locale?: string, options?: Intl.NumberFormatOptions): Intl.NumberFormatPart[]`

Method: `m.formatToParts(locale?, options?)`.

As `format`, as Intl's parts, for styling the currency symbol separately.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/format';

money('25', 'EUR').format('de-DE'); // → '25,00 €'
money('1234.5', 'EUR').format('en-GB', { currencyDisplay: 'code' }); // → 'EUR 1,234.50'
money('1.500', 'KWD', { scale: 3 }).format('en'); // → 'KWD 1.500'
const parts = money('5', 'EUR').formatToParts('en');
parts.map((part) => part.type); // → ['currency', 'integer', 'decimal', 'fraction']
```
