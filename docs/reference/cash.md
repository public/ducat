# `@ducatjs/money/cash`

Cash rounding to the smallest coin in use, rounding to any increment, and cash digits. **Installs:** `cashRound` and `roundToIncrement` on `Money`.

Related: [How to round cash totals](../how-to/round-cash.md) · [Currency data](currency-data.md) · [Known limitations](limitations.md)

The rules come from `data/cash-rounding.json`, one per currency (and country, for EUR), each with a `source` URL and a `verified` flag. CLDR's cash data (`data/cldr-cash.json`) is a second source that the tests check the table against. Card and other electronic payments are never rounded in any of these jurisdictions: apply cash rounding only to cash tenders.

## The rules

- CHF 0.05, SEK and NOK 1.00, DKK 0.50, CAD and AUD 0.05, NZD 0.10
- HUF 5, CZK 1, CLP 10, ILS 0.10, MYR 0.05
- AMD and CRC 10, UZS and TZS 50, RSD, PKR, MNT and TWD 1, MRU 0.20
- EUR 0.05 in BE, NL, FI, IE, IT, SK, EE and LT, and more. There is no euro-wide rule, so EUR needs a `country`.
- Ties follow each rule's source: Serbia rounds a 50 para tie down (`10.50 RSD` to `10.00`); every other rule rounds ties away from zero (`'halfExpand'`). A `rounding` option overrides it.
- CLDR rounds AMD, CRC, TZS and UZS cash to whole units, but their smallest coins are 10, 10, 50 and 50; the table follows the national sources.
- Rules backed only by secondary sources have `verified: false`; `includeUnverified: false` turns them off. Which they are is in [Known limitations](limitations.md).

## Functions

### cashRound

`cashRound<C extends string>(money: Money<C>, options?: CashRoundOptions): Money<C>`

Method: `m.cashRound(options?)`.

Rounds a cash total to the currency's cash step, using `options.country` for EUR. Returns `money` unchanged when no rule applies. The result keeps `money`'s scale when it is larger than the currency's (10.034 CHF gives 10.050).

### cashPolicy

`cashPolicy(currency: string, options?: CashRoundOptions): RoundingPolicy`

The cash rule as a [rounding policy](policy.md), at the currency's exponent, for `currency` only: `m.multiply('1.075', cashPolicy('CHF'))` rounds once, straight to 0.05. Unlike `cashRound`, a policy always returns its own scale (10.034 CHF gives 10.05).

- **Throws:** `RangeError` when no rule applies (EUR without a country that has one, or an unverified rule with `includeUnverified: false`); use `isoPolicy` for currencies without cash rounding. The policy throws `CurrencyMismatchError` for amounts in other currencies.

### roundToIncrement

`roundToIncrement<C extends string>(money: Money<C>, increment: Money<C>, rounding?: RoundingMode): Money<C>`

Method: `m.roundToIncrement(increment, rounding?)`.

Rounds to a multiple of `increment` with `rounding` (default `'halfExpand'`): 0.05, 0.50, 1, or whole hundreds.

- **Throws:** `RangeError` when the increment isn't positive; `CurrencyMismatchError` for an increment in another currency; `RoundingError` for `'unnecessary'` when `money` isn't a multiple.

### cashRule

`cashRule(currency: string, country?: string): CashRule | undefined`

The rule for a currency, narrowed by country (ISO 3166 alpha-2), or `undefined`.

### currencyDigits

`currencyDigits(currency: string, options?: CurrencyDigitsOptions): number`

The decimals amounts are shown with: the ISO exponent, or with `{ usage: 'cash' }` the decimals of a cash amount (CLDR's `cashDigits`): none when cash is rounded to whole units, the exponent otherwise. A currency without a cash rule takes its exponent.

- **Throws:** `RangeError` for an unknown code.

### cashUnit

`cashUnit(currency: string, options?: CashUnitOptions): string`

The smallest cash step in major units, as an exact decimal string with the currency's decimals. A currency without a cash rule (or EUR without a country that has one) gives its minor unit.

- **Throws:** `RangeError` for an unknown code.

```ts
import { money } from '@ducatjs/money';
import { cashPolicy, cashUnit, currencyDigits } from '@ducatjs/money/cash';

money('10.03', 'CHF').cashRound(); // → 10.05 CHF
money('10.034', 'CHF', { scale: 3 }).cashRound(); // → 10.050 CHF
money('10.034', 'CHF', { scale: 3 }).round(cashPolicy('CHF')); // → 10.05 CHF
money('10.50', 'RSD').cashRound(); // → 10.00 RSD
money('10.03', 'EUR').cashRound({ country: 'NL' }); // → 10.05 EUR
money('10.03', 'EUR').cashRound(); // → 10.03 EUR (no euro-wide rule)
money('12345.60', 'CHF').roundToIncrement(money('100', 'CHF'), 'floor'); // → 12300.00 CHF
currencyDigits('SEK', { usage: 'cash' }); // → 0
cashUnit('DKK'); // → '0.50'
cashUnit('GBP'); // → '0.01'
cashPolicy('EUR'); // throws RangeError
```

## Tables and types

- `CASH_RULES`: every rule, as a readonly array of `CashRule`.
- `CashRule`: `{ currency: string; increment: number; countries: readonly string[]; scope: string; verified: boolean; source: string; rounding?: RoundingMode }`. `increment` is the step in ISO minor units; `countries` is empty for a rule that applies wherever the currency is used; `verified` is false when only secondary sources were found; `rounding` is the tie rule where it isn't `'halfExpand'`.
- `CashRoundOptions`: `{ country?: string; rounding?: RoundingMode; includeUnverified?: boolean }` (`includeUnverified` defaults to true).
- `CurrencyDigitsOptions`: `{ usage?: 'standard' | 'cash'; country?: string; includeUnverified?: boolean }`.
- `CashUnitOptions`: `{ country?: string; includeUnverified?: boolean }`.
