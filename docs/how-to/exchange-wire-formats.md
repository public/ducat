# How to exchange amounts with other systems

This guide shows you how to send and receive amounts in the formats other systems use: `google.type.Money`, ISO 20022 amounts, integer minor units, dinero.js objects, JSON, and plain JS numbers for charts and number-only APIs. The wire formats are in `@ducatjs/money/wire`; each writer throws rather than send a value the format can't hold, and each reader checks the format strictly.

## Convert to and from a wire format

```ts
import { money } from '@ducatjs/money';
import {
  fromDineroObject,
  fromGoogleMoney,
  toDineroObject,
  toGoogleMoney,
  toIso20022Amount,
  toMinorUnits,
} from '@ducatjs/money/wire';

toGoogleMoney(money('-1.75', 'EUR')); // → { currencyCode: 'EUR', units: '-1', nanos: -750000000 }
fromGoogleMoney({ currencyCode: 'USD', units: '12', nanos: 340000000 }); // → 12.34 USD
toIso20022Amount(money('12.34', 'EUR')); // → { Ccy: 'EUR', value: '12.34' }
toIso20022Amount(money('-5', 'EUR')); // throws RangeError: use the credit/debit indicator
toMinorUnits(money('500', 'JPY')); // → { value: 500, currency: 'JPY' }
toDineroObject(money('12.34', 'EUR')); // → { amount: 1234, currency: 'EUR', precision: 2 }
fromDineroObject({ amount: 12345, currency: 'EUR', precision: 4 }); // → 1.2345 EUR
fromDineroObject({ amount: 500, currency: 'JPY', precision: 2 }); // → 5.00 JPY
fromDineroObject({ amount: 500, currency: 'JPY', precision: 2 }).round('unnecessary'); // → 5 JPY
fromDineroObject({ amount: 550, currency: 'JPY', precision: 2 }).round('unnecessary'); // throws RoundingError
fromDineroObject({ amount: 12.5, currency: 'EUR', precision: 2 }); // throws RangeError
```

- **ISO 20022:** send negative amounts as positive ones with the credit/debit indicator; the schema allows no negative amounts.
- **dinero.js objects:** `precision` is the Money's scale both ways, so nothing is rounded. If the value should be at the currency's exponent, `round()` it: `m.round('unnecessary')` throws rather than drop a digit, and another mode rounds.
- **Minor units:** if the receiver is a payment processor whose exponents differ from ISO, use its own view instead ([How to send amounts to payment processors](send-amounts-to-payment-processors.md)).
- **Extra decimals:** the other readers return Money at the currency's exponent, and throw a `RoundingError` for extra decimals unless you pass `{ scale }` or `{ rounding }`.

## Send JSON

`JSON.stringify(m)` gives `{"amount":"12.34","currency":"EUR"}`, and `fromJSON` reverses it. The amount is a string so it survives JSON parsers that turn numbers into floats.

## Hand an amount to an API that takes numbers

If a chart, a PDF library or an API takes a JS number, use the named lossy conversions: `toNumber()` for major units, and `toMinorNumber({ lossy: true })` for minor units beyond 2^53. Don't do arithmetic on the result.

```ts
import { fromMinor, money } from '@ducatjs/money';

money('12.34', 'EUR').toNumber(); // → 12.34
fromMinor(100000n * 10n ** 18n, 'EUR', 18).toNumber(); // → 100000
fromMinor(1000000000000000050n, 'USD').toNumber(); // → 10000000000000000 (10000000000000000.50 has no double)
fromMinor(1000000000000000050n, 'USD').toMinorNumber(); // throws RangeError
fromMinor(1000000000000000050n, 'USD').toMinorNumber({ lossy: true }); // → 1000000000000000000
money('12.345', 'EUR', { scale: 3 }).toMinorNumber({ lossy: true }); // throws RoundingError: lossy waives only the 2^53 check; round() first
fromMinor(10n ** 309n, 'JPY').toNumber(); // → Infinity (beyond the largest double, as Number() gives)
```

If display code drops ".00" from whole amounts, test `hasFraction()` first.

## Related

- Reference: [`@ducatjs/money/wire`](../reference/wire.md), [serialisation on Money](../reference/money.md)
- Explanation: [About storing amounts](../explanation/storage.md), [About exactness](../explanation/exactness.md)
