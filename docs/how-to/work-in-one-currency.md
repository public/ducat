# How to work in one currency and locale

This guide shows you how to bind ducat's functions to one currency and locale, for an app that works in a single currency. ducat has no global default currency, precision or locale, on purpose; a context from `@ducatjs/money/context` (or `/fn`) gives you the convenience without anything global.

## Make a context

Call `currencyContext(currency, { locale })`. It returns a frozen plain object with `money`, `fromMinor`, `zero`, `format` and `is`, all in that currency. If you also want `parse`, pass it in (it is about 1 kB, so a context that only formats doesn't carry it). Type values with `MoneyOf<typeof eur>`:

```ts
import { money } from '@ducatjs/money';
import { currencyContext, type MoneyOf } from '@ducatjs/money/context';
import { parse } from '@ducatjs/money/parse';

const eur = currencyContext('EUR', { locale: 'en-IE', parse });
type Eur = MoneyOf<typeof eur>; // Money<'EUR'>

const price: Eur = eur.money('1234.5');
eur.fromMinor(1234); // → 12.34 EUR
eur.zero(); // → 0.00 EUR
eur.format(price); // → '€1,234.50'
eur.parse('€1,234.50'); // → 1234.50 EUR
eur.is(money('5', 'USD')); // → false
eur.format(money('5', 'USD')); // compile error, and throws
currencyContext('EUR', { locale: 'not a locale' }); // throws RangeError
currencyContext('EUR').parse('5'); // compile error, and throws
```

The currency and the locale are checked when the context is made. `format` and `parse` take the same options as the functions they bind (`eur.format(m, { currencyDisplay: 'code' })`, `eur.parse(text, { lenient: true })`).

## Use a context in a `/fn` program

The context's functions are the plain ones, so a `/fn` program that uses a context installs no methods and carries only the currencies it imports: `import '@ducatjs/money/iso/EUR'` before making it. As a `/fn` program, a context with `/iso/EUR`, `money` and `format` is 3.0 kB gzipped, and passing `parse` adds 1.1 kB.

## Related

- Reference: [`@ducatjs/money/context`](../reference/context.md)
- How-to: [How to keep bundles small](keep-bundles-small.md)
