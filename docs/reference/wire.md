# `@ducatjs/money/wire`

Money to and from the formats other systems send, exactly both ways. **Installs:** nothing.

Related: [How to exchange amounts in wire formats](../how-to/exchange-wire-formats.md) · [Processors](processors.md) (where a processor's exponents differ from ISO)

Every reader checks the format strictly, and every writer throws rather than send a value the format can't hold. The readers other than `fromDineroObject` and `fromMinorUnits` return Money at the currency's exponent, and throw a `RoundingError` for extra decimals unless `{ scale }` or `{ rounding }` says what to do.

## google.type.Money

### toGoogleMoney

`toGoogleMoney(money: Money<string>, rounding?: RoundingMode): GoogleMoney`

`google.type.Money` in its proto3 JSON form, as Google APIs and many gRPC services use: `currencyCode`, `units` as an int64 string, and `nanos` (billionths) with the same sign. `toGoogleMoney(money('-1.75', 'EUR'))` is `{ currencyCode: 'EUR', units: '-1', nanos: -750000000 }`.

- **Rounds:** only with `rounding`, to 9 decimals.
- **Throws:** `RoundingError` for more than 9 decimals without `rounding`; `RangeError` when the whole units don't fit in an int64 or the code isn't three capital letters.

### fromGoogleMoney

`fromGoogleMoney<C extends CurrencyInput>(value: GoogleMoneyInput & { currencyCode: C }, options?: WireReadOptions): Money<C>`

Reads `google.type.Money` exactly: `{ currencyCode: 'USD', units: '12', nanos: 340000000 }` is 12.34 USD. Missing `units` or `nanos` mean 0, as in proto3.

- **Throws:** `RangeError` for a malformed value (`units` not an int64, `nanos` outside ±999,999,999 or with a sign other than a non-zero `units`'s); `RoundingError` for more decimals than the result's scale, unless `options.rounding` is given.

## ISO 20022

### toIso20022Amount

`toIso20022Amount(money: Money<string>, rounding?: RoundingMode, options?: Iso20022WriteOptions): Iso20022Amount`

The amount in `<InstdAmt Ccy="EUR">12.34</InstdAmt>`: `{ Ccy: 'EUR', value: '12.34' }`. It is written with the currency's decimals, as the payment networks' rules (CBPR+, HVPS+) require for ActiveCurrencyAndAmount, whatever the Money's scale: 12.3400 EUR at scale 4 is written `'12.34'`, and JPY `'1000'`.

- **Rounds:** only with `rounding`, to the currency's decimals (or `options.scale`).
- **Throws:** `RoundingError` for more decimals without `rounding`; `RangeError` for a negative amount (the direction goes in the credit/debit indicator), more than 18 digits, a scale outside 0–5, or a currency that isn't ISO 4217 (see below).

- **Currencies:** ISO 20022's `ActiveOrHistoricCurrencyCode` is ISO 4217, so only these are written or read: the current codes, including those with no minor unit such as `XAU` and `XDR` (which a program registers with `defineCurrency` to hold), and withdrawn codes (`HRK`) once `defineHistoricCurrencies` from `@ducatjs/money/historic` has registered them. A code ISO never published, such as `BTC` or `CNH`, throws.

### fromIso20022Amount

`fromIso20022Amount<C extends CurrencyInput>(amount: { Ccy: C; value: string }, options?: WireReadOptions): Money<C>`

Reads an ISO 20022 amount exactly. The text must be plain digits with an optional decimal point, at most 5 decimals and 18 digits (not counting leading or trailing zeros, as XSD counts them), with no sign, exponent or spaces; trim XML whitespace in the XML reader.

- **Throws:** `SyntaxError` for any other text or a malformed currency; `RangeError` for a currency that isn't ISO 4217, by the same rule as `toIso20022Amount`; `RoundingError` for more decimals than the currency has without `options` (KWD's 3 decimals fit; 12.345 EUR needs `{ scale: 3 }` or a rounding mode).

## ISO minor units

### toMinorUnits

`toMinorUnits(money: Money<string>, rounding?: RoundingMode): MinorUnitAmount`

`{ value, currency }`, an integer count of ISO 4217 minor units, the JSON several processors and ledgers use: `{ value: 1234, currency: 'EUR' }` for 12.34 EUR, `{ value: 500, currency: 'JPY' }` for 500 JPY. The same shape as Adyen's `amount`, at the ISO exponent.

- **Rounds:** only with `rounding`.
- **Throws:** `RoundingError` for more decimals than the currency has without `rounding`; `RangeError` beyond 2^53 − 1 minor units, which JSON numbers can't hold exactly.

### fromMinorUnits

`fromMinorUnits<C extends CurrencyInput>(amount: { value: number | bigint; currency: C }): Money<C>`

Reads `{ value, currency }` in ISO 4217 minor units.

- **Throws:** `RangeError` when `value` is a number that isn't a safe integer, or the object isn't `{ value, currency }`; `TypeError` when `value` is neither a number nor a bigint (a string from JSON, for example).

## dinero.js objects

### toDineroObject

`toDineroObject(money: Money<string>): DineroObject`

dinero.js 1's `toObject()` shape, which many APIs and databases written with dinero.js carry: `{ amount: 1234, currency: 'EUR', precision: 2 }` for 12.34 EUR. `precision` is the Money's scale, so nothing is rounded: 1.2340 EUR at scale 4 is `{ amount: 12340, currency: 'EUR', precision: 4 }`.

- **Throws:** `RangeError` beyond 2^53 − 1 units (dinero.js amounts are numbers).

### fromDineroObject

`fromDineroObject<C extends CurrencyInput>(object: { amount: number | bigint; currency: C; precision: number }): Money<C>`

Reads `{ amount, currency, precision }` exactly, at its precision. dinero.js gives every currency precision 2 unless told otherwise, so `{ amount: 500, currency: 'JPY', precision: 2 }` reads as 5.00 JPY (¥5, not ¥500). To bring a value to the currency's exponent, `round()` it: `m.round('unnecessary')` throws rather than drop a digit, and another mode rounds. All three fields are required.

- **Throws:** `TypeError` for a missing or wrongly typed `amount` or `precision`; `RangeError` for a missing `currency`, as `fromMinor` does for an unknown currency; `RangeError` for an `amount` that is a fraction or beyond 2^53 − 1, or a `precision` that isn't an integer from 0 to 1000; and as `fromMinor` does for an unknown currency.

```ts
import { fromDineroObject, toIso20022Amount } from '@ducatjs/money/wire';
import { money } from '@ducatjs/money';

toIso20022Amount(money('12.3400', 'EUR', { scale: 4 })); // → { Ccy: 'EUR', value: '12.34' }
fromDineroObject({ amount: 500, currency: 'JPY', precision: 2 }); // → 5.00 JPY
fromDineroObject({ amount: '500', currency: 'JPY', precision: 2 } as never); // throws TypeError
```

## Types

- `GoogleMoney`: `{ currencyCode: string; units: string; nanos: number }`.
- `GoogleMoneyInput`: `{ currencyCode: string; units?: string | number | bigint; nanos?: number }`: the proto3 JSON form, or units as a number or bigint.
- `Iso20022Amount`: `{ Ccy: string; value: string }`: `Ccy` is the attribute and `value` the element's text.
- `Iso20022WriteOptions`: `{ scale?: number }`: the decimals to write (default the currency's ISO exponent), at most 5. The networks' rules require the currency's minor unit, so give another only for messages that allow it.
- `MinorUnitAmount`: `{ value: number; currency: string }`.
- `DineroObject`: `{ amount: number; currency: string; precision: number }`: `amount` is an integer count of 10^−`precision` units.
- `WireReadOptions`: `{ scale?: number; rounding?: RoundingMode }`: the result's scale (default the currency's ISO exponent), and how to round to it (default `'unnecessary'`: throw).
