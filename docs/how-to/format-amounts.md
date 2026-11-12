# How to format amounts for display

This guide shows you how to turn an amount into the text a person reads: in their locale, with the currency shown the way you want, and rounded for display when the stored value has more digits than you want to show.

## Format in a locale

Import `@ducatjs/money/format` and pass a locale. The digits shown are the amount's own, whatever the engine's default for the currency, and the locale places the symbol (hand-written format masks get both wrong: see [Where money arithmetic goes wrong](../explanation/footguns.md#formatting-that-drops-decimals-or-misplaces-symbols)):

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/format';

money('1234.5', 'EUR').format('en-IE'); // → '€1,234.50'
money('1.500', 'KWD', { scale: 3 }).format('en'); // → 'KWD 1.500'
```

## Choose how the currency appears

Any `Intl.NumberFormat` option passes through, so `currencyDisplay` and `currencySign` work as they do in Intl:

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/format';

money('1234.5', 'EUR').format('en-GB', { currencyDisplay: 'code' }); // → 'EUR 1,234.50'
```

## Show fewer or more digits than the amount has

If a unit price is stored at 6 decimals but you show 4, pass `digits`. ducat rounds the amount once, exactly, before Intl sees it, with `rounding` (`'halfExpand'` unless you say otherwise). A larger `digits` pads:

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/format';

const unitPrice = money('0.123456', 'EUR', { scale: 6 });
unitPrice.format('en', { digits: 4 }); // → '€0.1235'
unitPrice.format('en', { digits: 4, rounding: 'floor' }); // → '€0.1234'
money('12.3', 'EUR').format('en', { digits: 4 }); // → '€12.3000'
```

Don't use Intl's fraction-digit, significant-digit or `roundingIncrement` options for this: Intl would round the double it is given, a second time. With `digits` they throw a `TypeError`.

## Style the parts separately

If the currency symbol needs its own style, use `formatToParts`, which takes the same options:

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/format';

const parts = money('5', 'EUR').formatToParts('en');
parts.map((part) => part.type); // → ['currency', 'integer', 'decimal', 'fraction']
```

## Related

- [`@ducatjs/money/format` reference](../reference/format.md)
- [How to parse amounts people type](parse-user-input.md), the other direction
- [How to work in one currency](work-in-one-currency.md), for a `format` bound to one currency and locale
- [About the representation](../explanation/representation.md), for how amounts reach Intl exactly
