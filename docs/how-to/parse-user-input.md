# How to parse amounts that people type

This guide shows you how to turn text into Money: strict decimal strings from your own systems, amounts formatted for a locale (`1.234,50 €`), and amounts whose currency is in the text (`CHF 1’234.50`).

## Parse a decimal string from another system

`money()` takes a strict decimal string: an optional sign, digits, an optional point with digits, and an optional exponent. Everything else throws a `SyntaxError`, because it is more often a truncated or mangled value than a deliberate one:

```ts
import { money } from '@ducatjs/money';

money('-12.34', 'EUR'); // → -12.34 EUR
money('+7', 'EUR'); // → 7.00 EUR
money('1.5e3', 'EUR'); // → 1500.00 EUR
money('125E-2', 'EUR'); // → 1.25 EUR
money('.5', 'EUR'); // throws SyntaxError
money('5.', 'EUR'); // throws SyntaxError
money(' 12.34', 'EUR'); // throws SyntaxError
money('1,000', 'EUR'); // throws SyntaxError
```

If the text can have more decimals than the currency, pass `{ rounding }` (or `{ scale }`): parsing never rounds by default, so `money('1.005', 'EUR')` throws.

## Parse text formatted for a locale

If the text has grouping, symbols or another locale's separators, import `@ducatjs/money/parse` and call `parse(text, currency, locale)`, for example `parse('1.234,50 €', 'EUR', 'de-DE')`. It takes the currency from its argument and never guesses it from the text. Group separators must be where the locale puts them: `parse('78.00', 'EUR', 'de-DE')` throws instead of becoming 7800.00. If you accept looser input, pass `{ lenient: true }`, which brings back the misreading strict parsing prevents (`1.5` in de-DE becomes 15.00); [Where money arithmetic goes wrong](../explanation/footguns.md#lenient-parsing-that-misreads-input) shows what lenient parsers do with junk.

## Detect the currency from the text

Call `parseMoney(text, locale, options?)`. It reads ISO codes and symbols that mean exactly one currency. If a symbol is shared (`$`, `kr`, `£`, `¥`), pass a `hint` or your own `symbols` map:

```ts
import { parseMoney } from '@ducatjs/money/parse';

parseMoney('CHF 1’234.50', 'de-CH'); // → 1234.50 CHF
parseMoney('1.234,50 €', 'de-DE'); // → 1234.50 EUR
parseMoney('$5.00', 'en-CA'); // throws SyntaxError (CAD, USD, AUD...: pass a hint)
parseMoney('$5.00', 'en-CA', { hint: 'CAD' }); // → 5.00 CAD
parseMoney('$5.00', 'en-CA', { symbols: { $: 'CAD' } }); // → 5.00 CAD
parseMoney('€5.00', 'en-IE', { hint: 'USD' }); // throws SyntaxError
parseMoney('12.34', 'en', { hint: 'EUR', lenient: true }); // → 12.34 EUR
```

If you only accept some currencies, pass `currencies`, which can include codes registered with `defineCurrency`.

## Handle the errors

Every parser throws a `SyntaxError` rather than guess. Catch it at the input boundary and ask the user again; don't retry with `lenient: true` silently, because `lenient` accepts any grouping.

## Related

- Reference: [`@ducatjs/money/parse`](../reference/parse.md) (what `parse` and `parseMoney` accept and refuse), [the decimal-string grammar](../reference/money.md)
- How-to: [How to validate amounts in API requests](validate-api-input.md)
- Explanation: [About exactness](../explanation/exactness.md)
