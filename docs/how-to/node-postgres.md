# How to keep amounts exact with node-postgres

This guide shows you how to make node-postgres (`pg`) read BIGINT and NUMERIC exactly, how to store Money in a composite column, and how to guard NUMERIC parameters. `@ducatjs/money/pg` doesn't import `pg`; you pass `pg.types` in.

## Read BIGINT and NUMERIC exactly

Pass `exactTypes(pg.types)` as the client's `types`. BIGINT then comes back as a bigint and NUMERIC as its exact string, arrays included (pg's default parses `numeric[]` as floats).

The bigint applies to every BIGINT on that client, `count(*)` and bigserial ids included, and `JSON.stringify` throws on a bigint. If that breaks other code, pass `{ int8: 'string' }` to keep pg's exact strings, or give the money parsers their own pool.

## Store Money in a composite column

1. Run the DDL from `moneyTypeSql()` once, in a migration (it isn't idempotent). It creates the `(amount numeric, currency text)` type plus a `sum` aggregate that throws on mixed currencies. For a schema, pass a qualified name: `moneyTypeSql('billing.amount')`.
2. Look the type's OIDs up with `moneyTypeOids(client)`, and pass them to `exactTypes` as `{ money: oids }`.
3. Write values with `toMoneyComposite(m)`.

<!-- doctest: skip (needs a Postgres server; test/db/pg-types.test.ts runs the same steps) -->

```ts
import pg from 'pg';
import { money } from '@ducatjs/money';
import {
  exactTypes,
  moneyTypeOids,
  moneyTypeSql,
  toMoneyComposite,
  toNumeric,
} from '@ducatjs/money/pg';

const setup = new pg.Client();
await setup.connect();
for (const statement of moneyTypeSql()) await setup.query(statement); // once, in a migration
const oids = await moneyTypeOids(setup);

const client = new pg.Client({ types: exactTypes(pg.types, { money: oids }) });
await client.connect();
await client.query('INSERT INTO items (price) VALUES ($1::ducat_money)', [
  toMoneyComposite(money('12.34', 'EUR')),
]);
(await client.query('SELECT sum(price) AS total FROM items')).rows[0].total; // Money
toNumeric(money('1.23456', 'EUR', { scale: 5 }), { precision: 19, scale: 4 }); // throws RangeError
```

If you recreate the type, or keep one type per tenant schema, pass the new OIDs: they are looked up once, and a type `exactTypes` doesn't know comes back as pg's raw text.

## Guard NUMERIC parameters

Postgres rounds extra decimals silently on insert. Pass amounts for a `NUMERIC(p, s)` parameter through `toNumeric(m, { precision, scale })`, which throws where Postgres would change the value, as the last line above shows.

## Related

- Reference: [`@ducatjs/money/pg`](../reference/pg.md)
- How-to: [How to store money in a database](store-money-in-a-database.md)
