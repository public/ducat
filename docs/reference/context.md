# `@ducatjs/money/context`

`currencyContext`, the plain functions bound to one currency and locale. **Installs:** nothing.

Related: [How to work in one currency](../how-to/work-in-one-currency.md) · [About modules](../explanation/modules.md)

ducat has no global default currency, precision or locale. A context is a frozen plain object; making one changes nothing global, and two contexts never interfere. Its functions are the plain ones, so a context installs no methods.

## Functions

### currencyContext

`currencyContext<const C extends CurrencyInput>(currency: C, options?: CurrencyContextOptions): CurrencyContext<C>`
`currencyContext<const C extends CurrencyInput>(currency: C, options: CurrencyContextOptions & { parse: ParseFunction }): ParsingCurrencyContext<C>`

Binds `money`, `fromMinor`, `zero`, `format` and `is` to `currency` and `options.locale`, and `parse` when `options.parse` is given (it is passed in, so a context that only formats doesn't carry it).

- The currency must be registered when the context is made (with `/fn` alone, import `@ducatjs/money/iso/<CODE>` first), and the locale must be valid.
- **Throws:** `RangeError` for an unknown currency or an invalid locale; `TypeError` when `parse` isn't the `parse` function from `/parse` or `/fn`.

```ts
import { money } from '@ducatjs/money';
import { currencyContext, type MoneyOf } from '@ducatjs/money/context';
import { parse } from '@ducatjs/money/parse';

const eur = currencyContext('EUR', { locale: 'en-IE', parse });
const price: MoneyOf<typeof eur> = eur.money('1234.5');
eur.format(price); // → '€1,234.50'
eur.parse('€1,234.50'); // → 1234.50 EUR
eur.is(money('5', 'USD')); // → false
eur.format(money('5', 'USD')); // compile error, and throws
currencyContext('EUR', { locale: 'not a locale' }); // throws RangeError
```

## The context

`CurrencyContext<C>` has:

- `currency: C` and `locale: string | undefined` (undefined: the runtime's default locale).
- `money(amount: string | number | bigint, options?: MoneyOptions): Money<C>`, as [`money`](money.md#money).
- `fromMinor(minor: number | bigint, scale?: number): Money<C>`, as [`fromMinor`](money.md#fromminor).
- `zero(scale?: number): Money<C>`.
- `format(money: Money<C>, options?: Intl.NumberFormatOptions): string`, as [`format`](format.md) in the context's locale. **Throws:** `CurrencyMismatchError` for Money in another currency (a compile error for literal types).
- `is(value: unknown): value is Money<C>`, as [`isMoneyIn`](money.md#ismoneyin).

`ParsingCurrencyContext<C>` adds `parse(input: string, options?: ParseOptions): Money<C>`, as [`parse`](parse.md) in the context's currency and locale. Calling `parse` on a context made without it is a compile error, and throws.

## Types

- `CurrencyContextOptions`: `{ locale?: string; parse?: ParseFunction }`.
- `ParseFunction`: the type of `parse` from `@ducatjs/money/parse`, `(input: string, currency: string, locale?: string, options?: ParseOptions) => Money`.
- `CurrencyContext<C>`, `ParsingCurrencyContext<C>`: see [The context](#the-context).
- `MoneyOf<T>`: the Money type of a context: `MoneyOf<typeof eur>` is `Money<'EUR'>`.
