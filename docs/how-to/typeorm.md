# How to store money with TypeORM

This guide shows you how to give TypeORM entities Money fields, so repositories, `save()` and `find()` take and return Money. `@ducatjs/money/typeorm` gives plain `ValueTransformer` objects for a column's `transformer` option, with decorators or with `EntitySchema`; it doesn't import `typeorm` (an optional peer dependency, 0.3 or later).

## Pick a transformer

| transformer                 | Postgres         | MySQL            | SQLite        | value                                                      |
| --------------------------- | ---------------- | ---------------- | ------------- | ---------------------------------------------------------- |
| `minorTransformer('EUR')`   | `bigint`         | `bigint`         | `bigint`      | minor units; `{ scale: 4 }` for ten-thousandths            |
| `decimalTransformer('EUR')` | `numeric(19, 4)` | `decimal(19, 4)` | `text`        | the exact decimal; pass `{ precision, scale }` to check it |
| `jsonTransformer()`         | `jsonb`          | `json`           | `simple-json` | `{"amount":"12.34","currency":"EUR"}`, any currency        |

If you use `decimalTransformer`, give it the column's size, as in `{ type: 'decimal', precision: 19, scale: 4, transformer: decimalTransformer('EUR', { precision: 19, scale: 4 }) }`: without it, MySQL outside strict mode clamps a value that doesn't fit instead of failing.

## Declare the entity and save, find and sum

If you use better-sqlite3, turn on safe integers in `prepareDatabase`: its default returns BIGINT as a number, which the transformer refuses beyond 2^53. TypeORM's MySQL driver and node-postgres return strings.

```ts
import Database from 'better-sqlite3';
import { DataSource, EntitySchema, MoreThan } from 'typeorm';
import { money, type Money } from '@ducatjs/money';
import { fromRawMinor, jsonTransformer, minorTransformer } from '@ducatjs/money/typeorm';

interface Order {
  id: number;
  total: Money<'EUR'>;
  refund: Money | null;
}

const Orders = new EntitySchema<Order>({
  name: 'Order',
  columns: {
    id: { type: 'int', primary: true },
    total: { type: 'bigint', transformer: minorTransformer('EUR') },
    refund: { type: 'simple-json', nullable: true, transformer: jsonTransformer() },
  },
});

const dataSource = new DataSource({
  type: 'better-sqlite3',
  database: ':memory:',
  driver: Database,
  // integers as bigint, exact beyond 2^53
  prepareDatabase: (db: Database.Database) => {
    db.defaultSafeIntegers(true);
  },
  entities: [Orders],
  synchronize: true,
});
await dataSource.initialize();
const orders = dataSource.getRepository(Orders);

await orders.save([
  { id: 1, total: money('92233720368547758.07', 'EUR'), refund: null },
  { id: 2, total: money('12.34', 'EUR'), refund: money('1.234', 'KWD') },
]);
(await orders.findOneByOrFail({ id: 1 })).total; // → 92233720368547758.07 EUR
(await orders.findBy({ total: MoreThan(money('100', 'EUR')) })).length; // → 1
const { cents } = await orders
  .createQueryBuilder('o')
  .select('SUM(o.total)', 'cents')
  .where('o.id = 2')
  .getRawOne();
fromRawMinor(cents, 'EUR'); // → 12.34 EUR
await dataSource.destroy();
```

## Filter with find operators

Find operators (`MoreThan(m)`, `In([...])`, `Between(a, b)`) and plain `where` values take Money, exactly on Postgres, SQLite and MySQL 8.4, beyond 2^53 minor units and 15 significant digits too. If you're on an older MySQL or on MariaDB (untested), compare large amounts in SQL with a cast (`CAST(:total AS SIGNED)`).

## Read raw query results

No transformer sees what `getRawOne()` and `query()` return, so read those with `fromRawMinor(value, currency, { scale? })` and `fromRawDecimal(value, currency)`. Over no rows `SUM()` returns NULL, which throws: `COALESCE(SUM(...), 0)` it. On SQLite, sum minor units: SQLite sums TEXT decimals as floats, and `fromRawDecimal` refuses those.

## Restrict a JSON column to one currency

Pass the currency, `jsonTransformer('EUR')`, to refuse others on write and on read.

## Related

- Reference: [`@ducatjs/money/typeorm`](../reference/typeorm.md) (every check the transformers make)
- How-to: [How to store money in a database](store-money-in-a-database.md)
