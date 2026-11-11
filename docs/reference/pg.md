# `@ducatjs/money/pg`

Keeps every amount node-postgres reads exact, and gives Postgres a composite money type. **Installs:** nothing. It doesn't import `pg`; you pass `pg.types` in.

Related: [How to store money with node-postgres](../how-to/node-postgres.md) · [How to store money in a database](../how-to/store-money-in-a-database.md)

## Type parsers

### exactTypes

`exactTypes(base: TypeParserSource, options?: ExactTypesOptions): TypeParserSource`

Type parsers for node-postgres that never turn an amount into a float: BIGINT as a bigint, NUMERIC as its exact string (rejecting `NaN` and `Infinity`), and their arrays the same way (pg's default parses `numeric[]` as floats). With `options.money`, the composite money type (and its arrays) is read as Money, keeping the scale it was stored at. Every other type keeps `base`'s parsers.

**The bigint applies to every BIGINT on that client**, `count(*)` and bigserial ids included, and `JSON.stringify` throws on a bigint. To keep pg's exact strings, pass `{ int8: 'string' }`, or give the money parsers their own pool. A composite type `exactTypes` doesn't know comes back as pg's raw text.

### parseBigInt

`parseBigInt(text: string): bigint`

BIGINT text as a bigint. node-postgres returns BIGINT as a string by default, which is exact but not a type the Money constructors take.

- **Throws:** `SyntaxError` for text that isn't an integer.

### parseNumeric

`parseNumeric(text: string): string`

NUMERIC text, checked and returned as the exact decimal string.

- **Throws:** `SyntaxError` for `NaN` and `±Infinity`, which Postgres NUMERIC can hold but aren't amounts.

### parseArray

`parseArray(text: string): unknown[]`

Splits Postgres array text (`{1,2,NULL}`, `{{1,2},{3,4}}`, `{"(1.00,EUR)"}`) into nested arrays of element text, with `null` for NULL. Quoted elements are unescaped.

- **Throws:** `SyntaxError` for malformed array text.

## The composite type

A composite type, `(amount numeric, currency text)`, named `ducat_money` by default. The amount is an unconstrained NUMERIC, so it keeps every digit and its scale.

### moneyTypeSql

`moneyTypeSql(name?: string): string[]`

The DDL for the composite type (default name `ducat_money`), plus a `sum` aggregate over it that throws on mixed currencies and on a value with a NULL amount or currency. A schema-qualified name (`moneyTypeSql('billing.amount')`) puts the type, its add function and the aggregate in that schema. Run the statements once, in order, in a migration: they aren't idempotent, and a second run fails with `duplicate_object`. Throws `RangeError` for a name that isn't a plain lower-case SQL name (optionally `schema.name`), or is too long for a Postgres name with an `_add` suffix.

### moneyTypeOids

`moneyTypeOids(client: Queryable, name?: string): Promise<MoneyTypeOids>`

Looks up the OIDs of the composite type and its array type, for `exactTypes`. Run it once at start-up on a client without the money parser. Rejects with `RangeError` when the database has no such type (run `moneyTypeSql()` first). OIDs differ between databases and change if the type is dropped and recreated; with one type per tenant schema, look up and pass each one's OIDs.

### toMoneyComposite

`toMoneyComposite(money: Money<string>): string`

The composite type's text for a query parameter, `(12.34,"EUR")`, at the Money's own scale. The currency is always quoted and escaped, so custom codes containing `\`, `"`, `,` or `)` survive. Cast it in SQL (`$1::ducat_money`) where Postgres can't infer the type.

### parseMoneyComposite

`parseMoneyComposite(text: string): Money<string>`

Money from the composite type's text, `(12.34,EUR)`. The amount keeps the scale it was stored with, and never less than the currency's exponent.

- **Throws:** `TypeError` for a NULL field (`(,EUR)`); `SyntaxError` for `NaN`, `Infinity` and malformed text.

## NUMERIC parameters

### toNumeric

`toNumeric<C extends CurrencyInput>(money: Money<C>, size: DecimalColumnSize): string`

The exact decimal for a `NUMERIC(p, s)` parameter. Postgres rounds extra decimals silently on insert, which is why the guard exists. Any scale up to the column's is accepted, and trailing zeros beyond it are dropped, since they don't change the value.

- **Throws:** `RangeError` where Postgres would change the value: more decimals than `size.scale` (that aren't zeros), or more integer digits than the column holds. Also `RangeError` for an invalid size, or a `size.scale` smaller than the currency's exponent, even when this value's extra decimals are zeros (`toNumeric(money('12', 'EUR'), { precision: 10, scale: 0 })` throws).

```ts
import { money } from '@ducatjs/money';
import { parseArray, parseMoneyComposite, toMoneyComposite, toNumeric } from '@ducatjs/money/pg';

toMoneyComposite(money('12.34', 'EUR')); // → '(12.34,"EUR")'
parseMoneyComposite('(12.3400,EUR)'); // → 12.3400 EUR
parseArray('{1,2,NULL}'); // → ['1', '2', null]
toNumeric(money('1.23456', 'EUR', { scale: 5 }), { precision: 19, scale: 4 }); // throws RangeError
```

## Constants and types

- `MONEY_TYPE_NAME`: `'ducat_money'`, the default name of the composite type.
- `DEFAULT_DECIMAL_SIZE`: `{ precision: 19, scale: 4 }`.
- `DecimalColumnSize`: `{ precision: number; scale: number }`.
- `ExactTypesOptions`: `{ money?: MoneyTypeOids; int8?: 'bigint' | 'string' }`. `int8` is how BIGINT (and BIGINT[]) values come back: `'bigint'` (the default) or `'string'`, pg's own exact format.
- `MoneyTypeOids`: `{ oid: number; arrayOid: number }`.
- `TypeParser`: `(text: string) => unknown`, a text-format value parser as node-postgres calls it.
- `TypeParserSource`: `{ getTypeParser(oid: number, format?: 'text' | 'binary'): TypeParser }`, the part of `pg.types` (or a client's `types` option) these parsers build on.
- `Queryable`: the part of a pg `Client` or `Pool` that `moneyTypeOids` uses: `query(sql, values)`.
