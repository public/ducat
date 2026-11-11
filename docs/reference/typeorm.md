# `@ducatjs/money/typeorm`

TypeORM column transformers, so entities hold `Money` and repositories, `save()` and `find()` take it, and readers for raw query results. **Installs:** nothing. The entry doesn't import `typeorm`, an optional peer dependency (0.3 or later).

Related: [How to store money with TypeORM](../how-to/typeorm.md) · [How to store money in a database](../how-to/store-money-in-a-database.md)

The transformers are plain `ValueTransformer` objects for a column's `transformer` option, with decorators or with `EntitySchema`. `null` and `undefined` pass through, for nullable columns.

| transformer                 | Postgres         | MySQL            | SQLite        | value                                                      |
| --------------------------- | ---------------- | ---------------- | ------------- | ---------------------------------------------------------- |
| `minorTransformer('EUR')`   | `bigint`         | `bigint`         | `bigint`      | minor units; `{ scale: 4 }` for ten-thousandths            |
| `decimalTransformer('EUR')` | `numeric(19, 4)` | `decimal(19, 4)` | `text`        | the exact decimal; pass `{ precision, scale }` to check it |
| `jsonTransformer()`         | `jsonb`          | `json`           | `simple-json` | `{"amount":"12.34","currency":"EUR"}`, any currency        |

## Transformers

### minorTransformer

`minorTransformer<C extends CurrencyInput>(currency: C, options?: MinorTransformerOptions): MoneyTransformer<C, string>`

A BIGINT column of minor units in a fixed currency (`1234` is 12.34 EUR), exact up to the column's ±9.2·10^18. It writes an integer string, which node-postgres, mysql2 and SQLite all bind exactly, and reads a string, bigint or safe-integer number. TypeORM's MySQL driver and node-postgres return BIGINT as a string; better-sqlite3 returns a number (call `db.defaultSafeIntegers(true)` in `prepareDatabase` for bigints).

- **Throws:** on write, `CurrencyMismatchError` for another currency and `RangeError` for another scale (`round()` it first); on read, `RangeError` for a number beyond 2^53 − 1. An unknown currency or a bad `scale` throws where the column is declared.

### decimalTransformer

`decimalTransformer<C extends CurrencyInput>(currency: C, size?: DecimalColumnSize): MoneyTransformer<C, string>`

A NUMERIC/DECIMAL column (TEXT in SQLite) holding the exact decimal as a string. Trailing zeros (`12.3400` from NUMERIC(19,4)) are fine. Give it the column's size, as in `{ type: 'decimal', precision: 19, scale: 4, transformer: decimalTransformer('EUR', { precision: 19, scale: 4 }) }`: without it, MySQL outside strict mode clamps a value that doesn't fit instead of failing.

- **Throws:** on write, `CurrencyMismatchError` for another currency, and `RangeError` for Money not at the currency's exponent (`round()` it first; this applies even when the column could hold it) or a value the size would round or clamp; on read, `TypeError` for a number (it has been through a float), and an error for `NaN`, `Infinity` or more decimals than the currency has.

### jsonTransformer

`jsonTransformer<C extends CurrencyInput = CurrencyInput>(currency?: C): MoneyTransformer<C, MoneyJSON<C>>`

A `json`/`jsonb` column (`simple-json` in SQLite) holding `{"amount":"12.34","currency":"EUR"}`, with the currency in each value. `to` returns the object, not its text, because TypeORM serialises those column types itself. Pass a currency (`jsonTransformer('EUR')`) to refuse others on write and on read.

- **Throws:** on write, `RangeError` for Money at a scale other than its currency's (`round()` it first); with a currency, `CurrencyMismatchError` for another one.

## Find operators

Find operators (`MoreThan(m)`, `In([...])`, `Between(a, b)`) and plain `where` values take Money, which goes through the same checks. The amounts go to the driver as strings, and Postgres, SQLite and MySQL 8.4 compare them with BIGINT and DECIMAL columns exactly, beyond 2^53 minor units and 15 significant digits too (tested in CI). Older MySQL versions and MariaDB are untested; there, compare large amounts in SQL with a cast (`CAST(:total AS SIGNED)`).

## Raw queries

No transformer sees what `getRawOne()` and `query()` return: Postgres sums BIGINT and NUMERIC to NUMERIC text, MySQL to DECIMAL text, SQLite to an integer.

### fromRawMinor

`fromRawMinor<C extends CurrencyInput>(value: unknown, currency: C, options?: MinorTransformerOptions): Money<C>`

Money from an integer a raw query returns, such as `SUM(total_minor)`.

- **Throws:** for NULL, which `SUM()` returns over no rows (`COALESCE(SUM(...), 0)` it); for a number beyond 2^53 − 1, which has already lost digits; and for a non-integer (`AVG()`).

### fromRawDecimal

`fromRawDecimal<C extends CurrencyInput>(value: unknown, currency: C): Money<C>`

Money from a decimal a raw query returns, such as `SUM(price)` over a NUMERIC column. It must be a string, as Postgres and MySQL return it, with no more decimals than the currency has (trailing zeros are fine).

- **Throws:** for NULL, and for a number: SQLite sums TEXT decimals as floats, so sum minor units instead there.

## Constants and types

- `DEFAULT_DECIMAL_SIZE`: `{ precision: 19, scale: 4 }`.
- `DecimalColumnSize`: `{ precision: number; scale: number }`.
- `MoneyTransformer<C, D>`: `{ to(value: Money<C> | null | undefined): D | null | undefined; from(value: unknown): Money<C> | null }`, a TypeORM `ValueTransformer` between `Money<C>` and what the driver sends and receives.
- `MinorTransformerOptions`: `{ scale?: number }`: the scale the column's integers count in (default the currency's ISO exponent). A column of ten-thousandths of a euro is `{ scale: 4 }`: `12340` is 1.2340 EUR.
