# `@ducatjs/money/zod` and `@ducatjs/money/valibot`

Schemas that turn the JSON form of Money into Money inside your request schemas. **Installs:** nothing. Zod (4) and Valibot (1) are optional peer dependencies; no other entry imports them.

Related: [How to validate API input](../how-to/validate-api-input.md) · [About storage](../explanation/storage.md) (why JSON is a decimal string)

Both entries accept exactly what `toJSON` writes:

- an exact decimal string (no exponent, plus sign, spaces or grouping) with at most 50 digits (`maxDigits`) and no more decimals than the scale;
- a known currency, or one of `{ currency }`.

The scale is the schema's, not the input's: the currency's exponent, or `{ scale }`. Shorter amounts are padded (`"1.5"` EUR is 1.50 EUR). `{ rounding }` accepts more decimals, as in `money()`. Errors are issues on the `amount` or `currency` path, and keys other than those two are dropped. Bad options throw when the schema is built.

## `@ducatjs/money/zod`

### moneySchema

`moneySchema<C extends string = string>(options?: MoneySchemaOptions<C>): MoneyCodec<C>`

A Zod codec between `{ amount, currency }` and Money: `schema.parse(json)` (or `z.decode`) gives Money, and `z.encode(schema, money)` gives `{ amount, currency }`, written at the amount's own scale.

- **Throws:** `ZodError` from `parse` for invalid input.

### moneyJSONSchema

`moneyJSONSchema<C extends string = string>(options?: MoneySchemaOptions<C>): ZodType<MoneyJSON<C>>`

Checks the same things as `moneySchema` but keeps the JSON object (with only `amount` and `currency`), for code that passes the JSON on rather than computing with it.

- `MoneyCodec<C>`: the Zod codec type `moneySchema` returns.

## `@ducatjs/money/valibot`

### moneySchema

`moneySchema<C extends string = string>(options?: MoneySchemaOptions<C>): MoneySchema<MoneyFor<C>>`

Parses `{ amount, currency }` into Money, accepting exactly what the Zod schema accepts. Valibot has no codecs, so encode with `price.toJSON()` (or `JSON.stringify`), which this schema reads back.

- **Throws:** `ValiError` from `v.parse` for invalid input.

### moneyJSONSchema

`moneyJSONSchema<C extends string = string>(options?: MoneySchemaOptions<C>): MoneySchema<MoneyJSON<C>>`

The same checks, keeping the JSON object.

- `MoneySchema<TOutput>`: the Valibot schema type both functions return: the JSON shape, then a transformation.

## Types (both entries)

- `MoneySchemaOptions<C>`: `{ currency?: C | readonly C[]; scale?: number; rounding?: RoundingMode; maxDigits?: number }`. Without `currency`, any ISO 4217 code or code registered with `defineCurrency` is accepted, and nothing else. `rounding` defaults to `'unnecessary'`, which rejects amounts with more decimals than the scale, as `fromJSON` does. `maxDigits` (default 50) counts digits without the sign and point, and keeps an oversized request body from building a huge number.
- `MoneyFor<C>`: the Money type a schema produces: one `Money<C>` per allowed currency, not a mixed-currency Money.

```ts
import * as v from 'valibot';
import { moneySchema } from '@ducatjs/money/valibot';

v.parse(moneySchema({ currency: 'EUR' }), { amount: '1.5', currency: 'EUR' }); // → 1.50 EUR
v.parse(moneySchema(), { amount: '1e3', currency: 'EUR' }); // throws ValiError
```
