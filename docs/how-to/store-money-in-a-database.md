# How to store money in Postgres, MySQL or SQLite

This guide shows you how to choose a column layout for amounts, and how to write a Money to it and read it back without losing a digit. For a specific library, follow up with the guide for it: [Prisma](prisma.md), [Drizzle](drizzle.md), [Kysely](kysely.md), [TypeORM](typeorm.md) or [node-postgres](node-postgres.md).

## Choose a column layout

| storage                              | Postgres                                                      | MySQL             | SQLite                                                                          | helpers                                                                                |
| ------------------------------------ | ------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **minor units + code** (recommended) | `amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL`     | `BIGINT, CHAR(3)` | `INTEGER, TEXT`                                                                 | `toMinorColumns(m, 'amountMinor', 'currency')`, `minorMoneyField(...)`, `fromMinor`    |
| **decimal**                          | `NUMERIC(19,4)` for most cases; `NUMERIC(38,8)` for crypto/FX | `DECIMAL(19,4)`   | **avoid** (NUMERIC affinity may store REAL); use TEXT + `toDecimal` if you must | `toDecimalValue(m, Prisma.Decimal)`, `fromDecimal(d, 'EUR')`, `decimalMoneyField(...)` |
| **JSON**                             | `jsonb` `{amount: "12.34", currency}`                         | `JSON`            | `TEXT`                                                                          | `JSON.stringify(m)`, `fromJSON`                                                        |

- BIGINT holds ±9.2·10^18 minor units, which is 92 quadrillion EUR. Postgres's `money` type is locale-dependent; don't use it.
- Name the unit in the column (`amount_minor`, not `amount`): a bare number can be read as euros or as cents, and code that reads it into a JavaScript number past 2⁵³ loses digits. See [minor and major units mixed up](../explanation/footguns.md#minor-and-major-units-mixed-up) and [amounts past 2⁵³ minor units](../explanation/footguns.md#amounts-past-2⁵³-minor-units).
- If you choose a decimal column, choose a NUMERIC scale of at least the largest exponent you store: 4 covers CLF/UYW, and 3 covers BHD/KWD.

## Write and read a BIGINT minor-units column

Write with `toMinorColumns(m, 'amountMinor', 'currency')` (or `m.toMinor()` for the amount alone), and read with `fromMinor(row.amountMinor, row.currency)`. Both use the currency's ISO exponent. A value with digits below the minor unit throws, so `round()` it first:

```ts
import { money } from '@ducatjs/money';

money('12.340', 'EUR', { scale: 3 }).toMinor(); // → 1234n
money('1.5', 'EUR', { scale: 1 }).toMinor(); // → 150n
money('12.345', 'EUR', { scale: 3 }).toMinor(); // throws RoundingError: round() first
money('12.345', 'EUR', { scale: 3 }).toScaledUnits(); // → 12345n (pair it with scale 3)
```

If you keep a scale column, write `m.toScaledUnits()` and `m.scale` instead, as in the last line.

If your driver returns BIGINT as a JS `bigint` (Prisma maps `BigInt` to `bigint`), pass it straight in: the helpers accept it, and `fromMinor` normalises it back to a number when it is safe.

## Store a scale column if amounts can be finer than the currency

A scale column (the Prisma helpers) makes minor units self-describing: `amount_scale SMALLINT NOT NULL` next to `amount_minor` and `currency`. Write with `toMinorColumns(m, 'amountMinor', 'currency', { scale: 'amountScale' })` and read with `minorMoneyField('amountMinor', 'currency', { scale: 'amountScale' })`. Any scale then round-trips, sub-minor amounts included, which `toMinorColumns` alone refuses. Stored rows also keep their meaning if a currency's exponent changes (see below).

To add the column to existing rows, backfill each currency's current exponent in the migration; a missing (NULL) scale throws on read.

Only the Prisma helpers have a scale column. Elsewhere, store `m.toScaledUnits()` and `m.scale` yourself, or use a decimal, JSON or the node-postgres composite column, which keep the scale.

## Read a decimal column

`fromDecimal` rejects values with more decimals than the currency allows (e.g. `12.3456` in NUMERIC(19,4) for EUR) unless you pass `{ scale }` or `{ rounding }`. Trailing zeros are fine.

## Prepare for an exponent change

Minor units stored without a scale are read at the currency's exponent in the installed version of ducat, so a changed exponent would silently change what old rows mean: 1234 stored as 12.34 would read as 1.234 or 123.4. So an exponent change is a breaking change, listed under **Changed** in the changelog with the currencies affected. Before upgrading across one, migrate the affected rows, or store a scale column (or a decimal) so the question never arises. Custom currencies keep the exponent given to `defineCurrency`.

## Related

- Reference: [Prisma helpers](../reference/prisma.md), [`@ducatjs/money`](../reference/money.md) (`toMinor`, `toScaledUnits`, `fromMinor`)
- Explanation: [About storing amounts](../explanation/storage.md), [Decisions](../explanation/decisions.md)
