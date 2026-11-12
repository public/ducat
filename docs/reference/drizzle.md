# `@ducatjs/money/drizzle/pg`, `/drizzle/mysql`, `/drizzle/sqlite`

Drizzle ORM column types, so selects return `Money` and inserts take it, with the currency in the column's type. **Installs:** nothing. `drizzle-orm` is an optional peer dependency, imported only by these three entries.

Related: [How to store money with Drizzle](../how-to/drizzle.md) · [How to store money in a database](../how-to/store-money-in-a-database.md)

Each entry exports `moneyMinor`, `moneyDecimal` and `moneyJson` for its dialect. Each returns a Drizzle custom-column builder: call it with the column's name, as in `moneyMinor('EUR')('total_minor')`.

| column                | Postgres         | MySQL            | SQLite    | value                                          |
| --------------------- | ---------------- | ---------------- | --------- | ---------------------------------------------- |
| `moneyMinor('EUR')`   | `bigint`         | `bigint`         | `integer` | minor units in a fixed currency                |
| `moneyDecimal('EUR')` | `numeric(19, 4)` | `decimal(19, 4)` | `text`    | the exact decimal; pass `{ precision, scale }` |
| `moneyJson()`         | `jsonb`          | `json`           | `text`    | `{"amount":"12.34","currency":"EUR"}`          |

## Columns

### moneyMinor

`moneyMinor<C extends CurrencyInput>(currency: C): (name?: string) => CustomColumnBuilder<Money<C>>`

A BIGINT (SQLite INTEGER) column of minor units in a fixed currency (`1234` is 12.34 EUR), read back as `Money<C>`, exact up to ±9.2·10^18 minor units. mysql2 returns BIGINT as a number by default and better-sqlite3 returns integers as numbers, both exact only below 2^53; use bigint or string mode (`supportBigNumbers` with `bigNumberStrings` in mysql2, `defaultSafeIntegers(true)` in better-sqlite3) for larger amounts. node-postgres returns strings already.

- **Throws** on write: `CurrencyMismatchError` for another currency (also a compile error); `RangeError` for a value at a scale other than the currency's, or beyond the BIGINT range. On read: `RangeError` for a number beyond 2^53 (it may have lost digits), `SyntaxError` for a string that isn't an integer.

### moneyDecimal

`moneyDecimal<C extends CurrencyInput>(currency: C, size?: DecimalColumnSize): (name?: string) => CustomColumnBuilder<Money<C>>` (Postgres and MySQL)

`moneyDecimal<C extends CurrencyInput>(currency: C): (name?: string) => CustomColumnBuilder<Money<C>>` (SQLite)

A NUMERIC/DECIMAL(precision, scale) column, (19, 4) by default, read back as `Money<C>`. On SQLite it is a TEXT column holding the exact decimal string, because SQLite's NUMERIC affinity would store some decimals as REAL and lose digits; so `/drizzle/sqlite`'s `moneyDecimal` takes no column size. The driver must return NUMERIC/DECIMAL as a string (node-postgres, postgres.js and mysql2's default; don't set `decimalNumbers`).

- **Throws** on write: `CurrencyMismatchError` for another currency; `RangeError` for a value the column would round or clamp (outside strict mode MySQL would clamp it). Where the column is declared: `RangeError` for an invalid size or a column scale below the currency's exponent. On read: `TypeError` for a number (it has been through a float), and an error for `NaN`, `Infinity` or more decimals than the currency has.

### moneyJson

`moneyJson<C extends CurrencyInput = CurrencyInput>(currency?: C): (name?: string) => CustomColumnBuilder<Money<C>>`

A JSONB (MySQL JSON, SQLite TEXT) column holding `{"amount":"12.34","currency":"EUR"}`, with the currency in each value. Pass a currency to fix it.

- **Throws:** with a fixed currency, `CurrencyMismatchError` for a value in another currency, on write and on read.

## Constants and types

- `DEFAULT_DECIMAL_SIZE` (`/drizzle/pg`, `/drizzle/mysql`): `{ precision: 19, scale: 4 }`, NUMERIC(19,4): 15 integer digits and 4 decimals, enough for every ISO 4217 exponent.
- `DecimalColumnSize`: `{ precision: number; scale: number }`: the total significant digits and the digits after the point.

## Limits

- **Currency per row:** a Drizzle column can't read a sibling column, so there is no "minor units plus a currency column" type. Use `moneyJson()`, which stores the currency in each value, or select both columns and build the Money with `fromMinor(row.amountMinor, row.currency)`.
- **Relational queries** (`db.query...findMany({ with: ... })`) return nested rows through JSON, where Postgres and MySQL turn NUMERIC and BIGINT values into JSON numbers. A nested `moneyDecimal` column then throws, and so does a nested `moneyMinor` beyond 2^53 minor units, rather than return a rounded amount. Top-level columns are not affected. For nested money, use `moneyJson`, or a join with `select`.
- **SQLite decimals are TEXT**, so in SQL they compare and sort as text (`'10.00' < '9.00'`), and `sum()` over them is a REAL. Use `moneyMinor` for columns you sort, compare or add up in SQL.
