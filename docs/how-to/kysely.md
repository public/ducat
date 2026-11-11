# How to store and query money with Kysely

This guide shows you how to select, insert, compare and sum Money with Kysely, so every amount stays exact. `@ducatjs/money/kysely` selects a money value as a JSON object built in SQL, which carries a marker, the amount as exact text and the currency, and `MoneyResultPlugin` turns exactly those objects into Money wherever they appear: unions, CTEs, subqueries, nested `jsonArrayFrom` rows, every `stream()` chunk, and with `CamelCasePlugin`. A raw column keeps its driver type and is never typed as Money.

## Set up the plugin and helpers

1. Install `kysely` (an optional peer dependency).
2. If you use better-sqlite3, turn on safe integers, so integers come back as bigint, exact beyond 2^53.
3. Add `MoneyResultPlugin` to the Kysely instance, and build the helpers for your dialect with `moneyHelpers('postgres' | 'mysql' | 'sqlite')`.

```ts
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { money } from '@ducatjs/money';
import {
  moneyHelpers,
  MoneyResultPlugin,
  setMoney,
  type MinorUnitsColumn,
} from '@ducatjs/money/kysely';

interface Schema {
  payments: { id: number; amount_minor: MinorUnitsColumn; currency: string };
}

const client = new Database(':memory:');
client.defaultSafeIntegers(true); // integers as bigint, exact beyond 2^53
client.exec('CREATE TABLE payments (id INTEGER, amount_minor INTEGER, currency TEXT)');
const db = new Kysely<Schema>({
  dialect: new SqliteDialect({ database: client }),
  plugins: [new MoneyResultPlugin()],
});
const { selectMoney, compareMoney, sumMoney } = moneyHelpers('sqlite');

const fee = money('1.234', 'KWD');
await db
  .insertInto('payments')
  .values({ id: 1, ...setMoney(fee, 'amount_minor', 'currency') })
  .execute();
const row = await db
  .selectFrom('payments')
  .select((eb) => selectMoney(eb, 'amount_minor', 'currency').as('fee'))
  .where((eb) => compareMoney(eb, 'amount_minor', 'currency', '>=', money('1', 'KWD')))
  .executeTakeFirstOrThrow();
row.fee; // → 1.234 KWD
```

## Read, write, filter and sum

- **Read** minor units with `selectMoney(eb, amount, currency)`, and a NUMERIC/DECIMAL (SQLite TEXT) column with `selectDecimalMoney`. Take the currency from a column, or fix it with `fixed('EUR')`, which types the result `Money<'EUR'>`.
- **Write** with `setMoney(m, 'amount_minor', 'currency')` or `setDecimalMoney`, in `values()`, `set()` and upserts. Give `setDecimalMoney` and `compareDecimalMoney` the column's size (`{ precision, scale }`) so they throw where the column would round or clamp the value.
- **Filter** with `compareMoney(eb, amount, currency, op, m)`, which compares currency and amount together, so 5 USD never matches 500 JPY. There is no `in`-list form; combine comparisons with `eb.or`.
- **Sum** with `sumMoney` or `sumDecimalMoney`. If rows can be in more than one currency, group by the currency column: mixed currencies make the result throw.

If you're on SQLite, compare and sum minor units, not decimals. Decimals are TEXT there: `sumDecimalMoney` and ordering comparisons on them throw, and `=` and `<>` compare the text, so they only match values written with `setDecimalMoney` (`'5.0'` is not `'5.00'`).

## Order the plugins for nested JSON

If SQLite returns nested JSON as text, put `ParseJSONResultsPlugin` before `MoneyResultPlugin`. Don't use `min`, `max` or `coalesce` over a money expression: they would compare the JSON objects.

## Related

- Reference: [`@ducatjs/money/kysely`](../reference/kysely.md) (every helper, the markers, NULL handling)
- How-to: [How to store money in a database](store-money-in-a-database.md)
