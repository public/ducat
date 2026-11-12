# How to store money with Drizzle ORM

This guide shows you how to declare Drizzle columns that select as Money and insert Money, with the currency in the column's type. The column types are in `@ducatjs/money/drizzle/pg`, `/drizzle/mysql` and `/drizzle/sqlite`; `drizzle-orm` is an optional peer dependency, imported only by these three entries.

## Pick a column type

| column                | Postgres         | MySQL            | SQLite    | value                                          |
| --------------------- | ---------------- | ---------------- | --------- | ---------------------------------------------- |
| `moneyMinor('EUR')`   | `bigint`         | `bigint`         | `integer` | minor units in a fixed currency                |
| `moneyDecimal('EUR')` | `numeric(19, 4)` | `decimal(19, 4)` | `text`    | the exact decimal; pass `{ precision, scale }` |
| `moneyJson()`         | `jsonb`          | `json`           | `text`    | `{"amount":"12.34","currency":"EUR"}`          |

If each row can have its own currency, use `moneyJson()`, which stores the currency in each value: a Drizzle column can't read a sibling column, so there is no "minor units plus a currency column" type. Or select both columns and build the Money with `fromMinor(row.amountMinor, row.currency)`.

If you sort, compare or add up amounts in SQL on SQLite, use `moneyMinor`. SQLite decimals are TEXT, so they compare and sort as text (`'10.00' < '9.00'`), and `sum()` over them is a REAL. For the same reason `/drizzle/sqlite`'s `moneyDecimal` takes no column size.

## Declare the table and configure the driver

Make the driver return BIGINT exactly: `defaultSafeIntegers(true)` in better-sqlite3, `supportBigNumbers` with `bigNumberStrings` in mysql2; node-postgres returns strings already. The columns refuse driver values that may have lost digits.

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';
import { money } from '@ducatjs/money';
import { moneyJson, moneyMinor } from '@ducatjs/money/drizzle/sqlite';

const orders = sqliteTable('orders', {
  id: integer('id').primaryKey(),
  total: moneyMinor('EUR')('total_minor').notNull(), // Money<'EUR'>
  refund: moneyJson()('refund'), // Money in any currency, or null
});

const client = new Database(':memory:');
client.defaultSafeIntegers(true); // integers as bigint, exact beyond 2^53
client.exec(
  'CREATE TABLE orders (id INTEGER PRIMARY KEY, total_minor INTEGER NOT NULL, refund TEXT)',
);
const db = drizzle({ client });

const huge = money('92233720368547758.07', 'EUR');
const dollar = money('1', 'USD');
db.insert(orders).values({ id: 1, total: huge }).run();
db.select().from(orders).get()?.total; // → 92233720368547758.07 EUR
db.insert(orders).values({ id: 2, total: dollar }).run(); // compile error, and throws
```

## Nest money in relational queries

Relational queries (`db.query...findMany({ with: ... })`) return nested rows through JSON, where Postgres and MySQL turn NUMERIC and BIGINT values into JSON numbers. A nested `moneyDecimal` column then throws, and so does a nested `moneyMinor` beyond 2^53 minor units, rather than return a rounded amount. Top-level columns are not affected. For nested money, use `moneyJson`, or a join with `select`.

## Related

- Reference: [`@ducatjs/money/drizzle/*`](../reference/drizzle.md) (what each column checks)
- How-to: [How to store money in a database](store-money-in-a-database.md)
