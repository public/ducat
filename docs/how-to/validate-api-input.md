# How to validate amounts in API requests

This guide shows you how to turn the JSON form of an amount, `{ "amount": "12.34", "currency": "EUR" }`, into Money inside a Zod or Valibot request schema, and how to narrow a currency known only at run time to a literal one.

## Validate with Zod

Import `moneySchema` from `@ducatjs/money/zod` (Zod 4, an optional peer) and use it inside your schema. Restrict the currencies with `{ currency }`:

```ts
import { z } from 'zod';
import { money } from '@ducatjs/money';
import { moneySchema } from '@ducatjs/money/zod';

const Order = z.object({ total: moneySchema({ currency: ['EUR', 'USD'] }) });
Order.parse({ total: { amount: '12.34', currency: 'EUR' } }).total; // → 12.34 EUR
Order.parse({ total: { amount: '12.345', currency: 'EUR' } }); // throws ZodError
z.encode(moneySchema(), money('9.99', 'USD')); // → { amount: '9.99', currency: 'USD' }
```

The Zod schema is a codec, so `z.encode(schema, price)` writes the JSON back, as the last line shows.

## Validate with Valibot

Import `moneySchema` from `@ducatjs/money/valibot` (Valibot 1, an optional peer). Valibot has no codecs, so write the JSON back with `price.toJSON()`:

```ts
import * as v from 'valibot';
import { moneySchema } from '@ducatjs/money/valibot';

v.parse(moneySchema({ currency: 'JPY' }), { amount: '1000', currency: 'JPY' }); // → 1000 JPY
```

## Decide the scale and rounding

The scale is the schema's, not the input's: the currency's exponent, or `{ scale }`. Shorter amounts are padded (`"1.5"` EUR is 1.50 EUR). If you accept more decimals and round them, pass `{ rounding }`. If you want to validate but keep the JSON, use `moneyJSONSchema` instead.

## Narrow a run-time currency without a cast

If a value's currency is known only at run time (`Money<string>`), narrow it with `isMoneyIn(x, currency)` or `assertCurrency(m, currency)`, which throws a `CurrencyMismatchError` for another currency:

```ts
import { assertCurrency, fromJSON, isMoneyIn, money } from '@ducatjs/money';

const price = fromJSON({ amount: '12.34', currency: 'EUR' as string }); // Money<string>
if (isMoneyIn(price, 'EUR')) {
  price.add(money('1', 'EUR')); // → 13.34 EUR
}
assertCurrency(price, 'EUR'); // now Money<'EUR'>

const other = fromJSON({ amount: '1', currency: 'USD' as string });
assertCurrency(other, 'EUR'); // throws CurrencyMismatchError
```

## Related

- Reference: [`@ducatjs/money/zod` and `/valibot`](../reference/schemas.md), [`isMoneyIn` and `assertCurrency`](../reference/money.md)
- How-to: [How to parse amounts that people type](parse-user-input.md)
- Explanation: [About storing amounts](../explanation/storage.md) (why JSON is a decimal string)
