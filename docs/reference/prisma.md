# `@ducatjs/money/prisma`

Helpers for storing Money with Prisma: minor-unit columns (with an optional scale column), Decimal columns, and result-extension fields. **Installs:** `toDecimalValue` on `Money`.

Related: [How to store money with Prisma](../how-to/prisma.md) · [How to store money in a database](../how-to/store-money-in-a-database.md) · [About storage](../explanation/storage.md)

`src/prisma.ts` doesn't import `@prisma/client`. It types Decimal structurally, as `{ toFixed(): string }`, so it also works with decimal.js and big.js. `examples/prisma/typecheck.ts` checks the helpers against Prisma's generated extension types. Prisma maps `BigInt` to JS `bigint`; the helpers accept it, and `fromMinor` normalises it back to a number when it is safe.

## Storage options

| storage                              | Postgres                                                      | MySQL             | SQLite                                                                          | helpers                                                                                |
| ------------------------------------ | ------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **minor units + code** (recommended) | `amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL`     | `BIGINT, CHAR(3)` | `INTEGER, TEXT`                                                                 | `toMinorColumns(m, 'amountMinor', 'currency')`, `minorMoneyField(...)`, `fromMinor`    |
| **decimal**                          | `NUMERIC(19,4)` for most cases; `NUMERIC(38,8)` for crypto/FX | `DECIMAL(19,4)`   | **avoid** (NUMERIC affinity may store REAL); use TEXT + `toDecimal` if you must | `toDecimalValue(m, Prisma.Decimal)`, `fromDecimal(d, 'EUR')`, `decimalMoneyField(...)` |
| **JSON**                             | `jsonb` `{amount: "12.34", currency}`                         | `JSON`            | `TEXT`                                                                          | `JSON.stringify(m)`, `fromJSON`                                                        |

- BIGINT holds ±9.2·10^18 minor units, which is 92 quadrillion EUR. Postgres's `money` type is locale-dependent; don't use it.
- A NUMERIC scale must be at least the largest exponent you store: 4 covers CLF/UYW, and 3 covers BHD/KWD.
- A scale column, `amount_scale SMALLINT NOT NULL` next to `amount_minor` and `currency`, makes minor units self-describing: any scale round-trips, sub-minor amounts included, and stored rows keep their meaning if a currency's exponent changes. A missing (NULL) scale throws on read.

## Functions

### toMinorColumns

`toMinorColumns<A extends string, K extends string>(money: Money<string>, amount: A, currency: K): { [A]: bigint; [K]: string }`

`toMinorColumns<A extends string, K extends string, S extends string>(money: Money<string>, amount: A, currency: K, options: ScaleColumnOption<S>): { [A]: bigint; [K]: string; [S]: number }`

Column values for writes: `data: { ...toMinorColumns(total, 'totalMinor', 'currency') }`. The minor units are a bigint (Prisma `BigInt`), at the currency's ISO exponent. With `{ scale: 'amountScale' }`, any scale is stored, next to the minor units it counts.

- **Rounds:** never.
- **Throws:** `RangeError` without a scale column when the value isn't at the currency's exponent, because the columns can't record its scale: `round()` it first.

### minorMoneyField

`minorMoneyField<A extends string, K extends string>(amount: A, currency: K): { needs; compute(row): Money<string> }`

`minorMoneyField<A extends string, K extends string, S extends string>(amount: A, currency: K, options: ScaleColumnOption<S>): { needs; compute(row): Money<string> }`

A Prisma result-extension field that exposes a Money built from a minor-units column and a currency column, and optionally a scale column. Without a scale column the minor units are read at the currency's current exponent.

- **Throws** (from `compute`, when a row is read): `RangeError` for an unknown currency, or a scale column that isn't an integer from 0 to 1000 (a NULL scale included).

### decimalMoneyField

`decimalMoneyField<A extends string, K extends string>(amount: A, currency: { currencyField: K }): { needs; compute(row): Money<string> }`

`decimalMoneyField<A extends string, C extends CurrencyInput>(amount: A, currency: { currency: C }): { needs; compute(row): Money<C> }`

A result-extension field for a Decimal column, with the currency taken from another column (`{ currencyField: 'currency' }`) or fixed (`{ currency: 'EUR' }`, typed `Money<'EUR'>`). Reads as `fromDecimal` does.

### toDecimalValue

`toDecimalValue<D>(money: Money<string>, Decimal: new (value: string) => D): D`

Method: `money.toDecimalValue(Decimal)`.

A Decimal for a NUMERIC column, built from the exact decimal string: `toDecimalValue(m, Prisma.Decimal)`.

### fromDecimal

`fromDecimal<C extends CurrencyInput>(value: string | DecimalLike, currency: C, options?: MoneyOptions): Money<C>`

Money from a Decimal (or decimal string) column, exactly. Trailing zeros are fine.

- **Throws:** `RoundingError` for more decimals than the currency allows (`12.3456` in NUMERIC(19,4) for EUR) unless `{ scale }` or `{ rounding }` is passed; `SyntaxError` for a string that isn't a decimal.

## Types

- `DecimalLike`: `{ toFixed(): string }`, the structural type of `Prisma.Decimal`, decimal.js and big.js values.
- `ScaleColumnOption<S>`: `{ scale: S }`: the integer column holding the number of decimals the minor units are counted in (2 for cents).
