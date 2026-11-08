import Database from 'better-sqlite3';
import fc from 'fast-check';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/sqlite';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import {
  CurrencyMismatchError,
  fromMinor,
  money,
  type CurrencyInput,
  type Money,
} from '../src/index.js';
import {
  moneyDecimal,
  moneyJson,
  moneyMinor,
  MoneyPlugin,
  type MoneyColumn,
  type MoneyPluginConfig,
} from '../src/kysely.js';
import { runs } from './fc-config.js';

interface Schema {
  orders: {
    id: number;
    total_minor: MoneyColumn<'EUR'>;
    price: MoneyColumn<'EUR'> | null;
    refund: MoneyColumn | null;
    note: string | null;
  };
  payments: {
    id: number;
    order_id: number;
    amount_minor: MoneyColumn;
    currency: string;
  };
}

const config: MoneyPluginConfig<Schema> = {
  orders: { total_minor: moneyMinor('EUR'), price: moneyDecimal('EUR'), refund: moneyJson() },
  payments: { amount_minor: moneyMinor({ currencyColumn: 'currency' }) },
};

let connection: Database.Database;
let db: Kysely<Schema>;

beforeAll(async () => {
  connection = new Database(':memory:');
  // integers as bigint: the default (number) would lose digits beyond 2^53
  connection.defaultSafeIntegers(true);
  connection.exec(
    'CREATE TABLE orders (id INTEGER PRIMARY KEY, total_minor INTEGER NOT NULL, price TEXT, ' +
      'refund TEXT, note TEXT);' +
      'CREATE TABLE payments (id INTEGER PRIMARY KEY, order_id INTEGER, ' +
      'amount_minor INTEGER NOT NULL, currency TEXT NOT NULL)',
  );
  db = new Kysely<Schema>({
    dialect: new SqliteDialect({ database: connection }),
    plugins: [new MoneyPlugin<Schema>(config)],
  });
  await db
    .insertInto('orders')
    .values([
      { id: 1, total_minor: money('12.34', 'EUR'), price: money('9.99', 'EUR'), refund: null },
      {
        id: 2,
        total_minor: money('92233720368547758.07', 'EUR'),
        price: null,
        refund: money('1.234', 'KWD'),
      },
    ])
    .execute();
  await db
    .insertInto('payments')
    .values([
      { id: 1, order_id: 1, amount_minor: money('5', 'USD'), currency: 'USD' },
      { id: 2, order_id: 1, amount_minor: money('1000', 'JPY'), currency: 'JPY' },
    ])
    .execute();
});

afterAll(async () => {
  await db.destroy();
});

describe('Kysely MoneyPlugin', () => {
  it('selects Money from every storage, typed with the column currency', async () => {
    const rows = await db.selectFrom('orders').selectAll().orderBy('id').execute();
    expectTypeOf(rows[0]!.total_minor).toEqualTypeOf<Money<'EUR'>>();
    expectTypeOf(rows[0]!.refund).toEqualTypeOf<Money<CurrencyInput> | null>();
    expect(
      rows.map((row) => [String(row.total_minor), String(row.price), String(row.refund)]),
    ).toEqual([
      ['12.34 EUR', '9.99 EUR', 'null'],
      ['92233720368547758.07 EUR', 'null', '1.234 KWD'],
    ]);
  });

  it('follows aliases, qualified names, joins and subqueries', async () => {
    const joined = await db
      .selectFrom('orders as o')
      .innerJoin('payments as p', 'p.order_id', 'o.id')
      .select(['o.total_minor as total', 'p.amount_minor as paid', 'p.currency'])
      .orderBy('p.id')
      .execute();
    expect(joined.map((row) => [String(row.total), String(row.paid)])).toEqual([
      ['12.34 EUR', '5.00 USD'],
      ['12.34 EUR', '1000 JPY'],
    ]);

    const derived = await db
      .selectFrom((eb) => eb.selectFrom('orders').select(['id', 'total_minor']).as('inner_orders'))
      .select('inner_orders.total_minor as amount')
      .where('inner_orders.id', '=', 1)
      .execute();
    expect(String(derived[0]!.amount)).toBe('12.34 EUR');

    const viaCte = await db
      .with('recent', (cte) => cte.selectFrom('orders').select(['id', 'refund']))
      .selectFrom('recent')
      .select('refund')
      .where('id', '=', 2)
      .executeTakeFirstOrThrow();
    expect(String(viaCte.refund)).toBe('1.234 KWD');
  });

  it('maps a scalar money subquery, and refuses money nested in JSON', async () => {
    const scalar = await db
      .selectFrom('orders as outer_orders')
      .select((eb) => [
        'outer_orders.id',
        eb
          .selectFrom('orders')
          .select('total_minor')
          .whereRef('orders.id', '=', 'outer_orders.id')
          .as('same_total'),
      ])
      .where('outer_orders.id', '=', 1)
      .executeTakeFirstOrThrow();
    expect(String(scalar.same_total)).toBe('12.34 EUR');

    const nested = db
      .selectFrom('orders')
      .select((eb) => [
        'id',
        jsonArrayFrom(
          eb
            .selectFrom('payments')
            .select('amount_minor')
            .whereRef('payments.order_id', '=', 'orders.id'),
        ).as('payments'),
      ]);
    expect(() => nested.compile()).toThrow(/inside a subquery in the select list/);
  });

  it('stores Money in comparisons, in lists and in updates, with returning', async () => {
    const found = await db
      .selectFrom('orders')
      .select('id')
      .where('total_minor', '=', money('12.34', 'EUR'))
      .execute();
    expect(found.map((row) => Number(row.id))).toEqual([1]);

    const listed = await db
      .selectFrom('orders')
      .select('id')
      .where('total_minor', 'in', [money('12.34', 'EUR'), money('1', 'EUR')])
      .execute();
    expect(listed).toHaveLength(1);

    const updated = await db
      .updateTable('orders')
      .set({ price: money('10.00', 'EUR') })
      .where('id', '=', 1)
      .returning(['price', 'total_minor'])
      .executeTakeFirstOrThrow();
    expect(String(updated.price)).toBe('10.00 EUR');
    expect(String(updated.total_minor)).toBe('12.34 EUR');
  });

  it('needs the currency column next to minor units, and checks it on insert', async () => {
    expect(() => db.selectFrom('payments').select('amount_minor').compile()).toThrow(
      /currency column "currency"/,
    );
    const insert = db
      .insertInto('payments')
      .values({ id: 9, order_id: 1, amount_minor: money('1', 'USD'), currency: 'EUR' });
    expect(() => insert.compile()).toThrow(CurrencyMismatchError);
  });

  it('refuses a wrong currency, a scale the column can not hold, and Money it can not place', () => {
    const dollars = money('1', 'USD') as unknown as Money<'EUR'>;
    const wrongCurrency = db.insertInto('orders').values({ id: 7, total_minor: dollars });
    expect(() => wrongCurrency.compile()).toThrow(CurrencyMismatchError);

    const subMinor = money('1.001', 'EUR', { scale: 3 });
    expect(() =>
      db.insertInto('orders').values({ id: 8, total_minor: subMinor }).compile(),
    ).toThrow(/round\(\)/);

    const unplaced = db
      .selectFrom('orders')
      .select(sql<string>`upper(${money('1', 'EUR')})`.as('text'));
    expect(() => unplaced.compile()).toThrow(/no money column/);
  });

  it('round-trips any BIGINT amount exactly through SQLite', async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }), async (minor) => {
        const original = fromMinor(minor, 'EUR');
        await db.deleteFrom('orders').where('id', '=', 100).execute();
        await db.insertInto('orders').values({ id: 100, total_minor: original }).execute();
        const row = await db
          .selectFrom('orders')
          .select('total_minor')
          .where('id', '=', 100)
          .executeTakeFirstOrThrow();
        expect(row.total_minor.equals(original)).toBe(true);
      }),
      { numRuns: runs(200) },
    );
  });

  it('type-checks the configuration against the database type', () => {
    const wrongCurrency: MoneyPluginConfig<Schema>['orders'] = {
      ...config.orders,
      // @ts-expect-error a fixed-currency column needs a spec in that currency
      total_minor: moneyMinor('USD'),
    };
    // @ts-expect-error every money column needs an entry
    const missing: MoneyPluginConfig<Schema>['orders'] = { total_minor: moneyMinor('EUR') };
    expect([wrongCurrency, missing]).toHaveLength(2);
  });
});
