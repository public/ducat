# `@ducatjs/money/parse`

Reading amounts as people write them, in any locale. **Installs:** nothing.

Related: [How to parse user input](../how-to/parse-user-input.md) · [How to validate API input](../how-to/validate-api-input.md) · [Known limitations](limitations.md)

For machine input (JSON, columns, wire formats) use [`money()`](money.md#money) and its strict [decimal-string grammar](money.md#decimal-strings) instead.

## Functions

### parse

`parse<C extends CurrencyInput>(input: string, currency: C, locale?: string, options?: ParseOptions): Money<C>`

Reads a locale-formatted amount in `currency`. The currency comes from the argument and is never guessed from the text: currency symbols and codes, spaces and bidi marks around the number are ignored.

- **Accepts:** the locale's group and decimal separators; NBSP and narrow NBSP, Swiss `’`; Arabic-Indic, Persian, Devanagari and Thai digits; a minus sign (ASCII or U+2212) or accounting parentheses in the affixes, which make it negative.
- **Group separators** must be where the locale puts them (`1.234,50` in de-DE, `1,23,456.78` in en-IN), because a misplaced one is usually another locale's decimal separator. `{ lenient: true }` accepts them anywhere.
- **Scale and rounding:** as `money()`, with `options.scale` and `options.rounding`.
- **Throws:** `SyntaxError` for no digits, unexpected characters, more than one decimal separator, or group separators in the wrong places; `RangeError` for a malformed locale tag (from `Intl`); `RoundingError` for more decimals than the scale without `rounding`. A locale the runtime has no data for isn't detected: `parse` uses the runtime's fallback separators (`parseMoney` rejects it).

### parseMoney

`parseMoney<C extends string = string>(input: string, locale: string, options?: ParseMoneyOptions<C>): Money<C>`

Reads a formatted amount and detects its currency from the text, without guessing.

- **Detects:** uppercase ISO codes (among `currencies`), and symbols that mean exactly one currency, in the locale (from `Intl.NumberFormat`) or in English (`US$`, `CA$`, `A$`). The number is then read as `parse` reads it, with the detected currency's separators.
- **Shared symbols** (`$`, `kr`, and also `£` and `¥`, which other currencies use as narrow symbols) need a `hint`, or a `symbols` entry such as `{ $: 'CAD' }`, even where the locale "owns" the symbol: `$` in en-CA is usually CAD, but a Canadian text can mean USD.
- `currencies` limits what is detected (default: every ISO 4217 currency), and can include codes registered with `defineCurrency`.
- `lenient: true` accepts any grouping, and a bare number when a `hint` is given. It never makes the currency a guess.
- **Throws:** `SyntaxError` when the text has no currency at all (unless a `hint` and `lenient: true` are given), when a currency in the text contradicts the `hint`, when the text names two currencies, when text around the number isn't a currency (`"about 100 USD"`), when a shared symbol has no `hint`, or for group separators in the wrong places for the locale (`1,234,567`; `12,34,567` in en-IN); `RangeError` for a locale the runtime has no Intl data for; `RoundingError` as `parse`.

```ts
import { parse, parseMoney } from '@ducatjs/money/parse';

parse('1.234,50 €', 'EUR', 'de-DE'); // → 1234.50 EUR
parse('78.00', 'EUR', 'de-DE'); // throws SyntaxError
parse('(12.50)', 'USD', 'en-US'); // → -12.50 USD
parseMoney('CHF 1’234.50', 'de-CH'); // → 1234.50 CHF
parseMoney('$5.00', 'en-CA'); // throws SyntaxError (CAD, USD, AUD...: pass a hint)
parseMoney('$5.00', 'en-CA', { hint: 'CAD' }); // → 5.00 CAD
parseMoney('12.34', 'en', { hint: 'EUR', lenient: true }); // → 12.34 EUR
```

## Types

- `ParseOptions`: `MoneyOptions` (`scale`, `rounding`) plus `lenient?: boolean`.
- `ParseMoneyOptions<C>`: `MoneyOptions` plus `hint?: C`, `symbols?: Readonly<Record<string, C>>`, `currencies?: readonly C[]` and `lenient?: boolean`.
