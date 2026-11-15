// Drizzle ORM columns against real databases: SQLite (better-sqlite3) always, Postgres and MySQL
// when DUCAT_PG_URL and DUCAT_MYSQL_URL are set (CI runs both as service containers).
import Database from 'better-sqlite3';
import { and, asc, eq, gt, lt, relations, sql, type SQL } from 'drizzle-orm';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleMysql, type MySql2Database } from 'drizzle-orm/mysql2';
import { int, mysqlTable, smallint as mysqlSmallint } from 'drizzle-orm/mysql-core';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { integer as pgInteger, pgTable, smallint as pgSmallint } from 'drizzle-orm/pg-core';
import { integer as sqliteInteger, sqliteTable } from 'drizzle-orm/sqlite-core';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { CurrencyMismatchError, money, type CurrencyInput, type Money } from '../../src/index.js';
import * as mysqlColumns from '../../src/drizzle/mysql.js';
import * as pgColumns from '../../src/drizzle/pg.js';
import * as sqliteColumns from '../../src/drizzle/sqlite.js';

const pgUrl = process.env.DUCAT_PG_URL;
const mysqlUrl = process.env.DUCAT_MYSQL_URL;
const isDatabaseRequired = process.env.DUCAT_REQUIRE_DB === '1';

// EUR amounts, including beyond 2^53 cents and at the BIGINT limits
const EURO_AMOUNTS = [
  '0.00',
  '12.34',
  '-0.01',
  '90071992547409.91',
  '90071992547409.93',
  '-90071992547409.93',
  '92233720368547758.07',
  '-92233720368547758.08',
];
// what fits NUMERIC(19,4): 15 integer digits
const DECIMAL_AMOUNTS = EURO_AMOUNTS.filter((amount) => amount.replace('-', '').indexOf('.') <= 15);

const pgOrders = pgTable('ducat_drizzle_orders', {
  id: pgInteger('id').primaryKey(),
  total: pgColumns.moneyMinor('EUR')('total_minor').notNull(),
  price: pgColumns.moneyDecimal('EUR')('price'),
  refund: pgColumns.moneyJson()('refund'),
});
const mysqlOrders = mysqlTable('ducat_drizzle_orders', {
  id: int('id').primaryKey(),
  total: mysqlColumns.moneyMinor('EUR')('total_minor').notNull(),
  price: mysqlColumns.moneyDecimal('EUR')('price'),
  refund: mysqlColumns.moneyJson()('refund'),
});
const sqliteOrders = sqliteTable('ducat_drizzle_orders', {
  id: sqliteInteger('id').primaryKey(),
  total: sqliteColumns.moneyMinor('EUR')('total_minor').notNull(),
  price: sqliteColumns.moneyDecimal('EUR')('price'),
  refund: sqliteColumns.moneyJson()('refund'),
});

// a scale column: amounts above, at and below EUR's scale, beyond 2^53 units too
const pgScaled = pgTable('ducat_drizzle_scaled', {
  id: pgInteger('id').primaryKey(),
  amount: pgColumns.moneyMinor('EUR', { scale: 'amountScale' })('amount_minor'),
  amountScale: pgSmallint('amount_scale'),
});
const mysqlScaled = mysqlTable('ducat_drizzle_scaled', {
  id: int('id').primaryKey(),
  amount: mysqlColumns.moneyMinor('EUR', { scale: 'amountScale' })('amount_minor'),
  amountScale: mysqlSmallint('amount_scale'),
});
const sqliteScaled = sqliteTable('ducat_drizzle_scaled', {
  id: sqliteInteger('id').primaryKey(),
  amount: sqliteColumns.moneyMinor('EUR', { scale: 'amountScale' })('amount_minor'),
  amountScale: sqliteInteger('amount_scale'),
});
const SCALED_EUROS = [
  money('1.005', 'EUR', { scale: 3 }),
  money('0.000000000000000001', 'EUR', { scale: 18 }),
  money('12.34', 'EUR'),
  money('-92233720368547758.08', 'EUR'),
  money('12', 'EUR', { scale: 0 }),
  money('-0.1', 'EUR', { scale: 1 }),
  money('9223372036.854775807', 'EUR', { scale: 9 }),
];

/** The rows of the scaled table: one per amount, then a NULL amount. */
function scaledRows(): { id: number; amount: Money<'EUR'> | null; amountScale: number | null }[] {
  return [
    ...SCALED_EUROS.map((amount, index) => ({ id: index + 1, amount, amountScale: amount.scale })),
    { id: 100, amount: null, amountScale: null },
  ];
}

/** Rows as strings with each amount's scale, so values compare by amount, currency and scale. */
function showScaled(rows: { id: number; amount: Money<'EUR'> | null }[]): string[] {
  return rows.map((row) =>
    row.amount === null
      ? `${row.id}: null`
      : `${row.id}: ${row.amount} at scale ${row.amount.scale}`,
  );
}

// payments in the currencies at the ends of the exponent range, for the relational queries
const pgPayments = pgTable('ducat_drizzle_payments', {
  id: pgInteger('id').primaryKey(),
  orderId: pgInteger('order_id').notNull(),
  amount: pgColumns.moneyMinor('KWD')('amount_minor').notNull(),
  fee: pgColumns.moneyDecimal('JPY')('fee'),
});
const sqlitePayments = sqliteTable('ducat_drizzle_payments', {
  id: sqliteInteger('id').primaryKey(),
  orderId: sqliteInteger('order_id').notNull(),
  amount: sqliteColumns.moneyMinor('KWD')('amount_minor').notNull(),
  fee: sqliteColumns.moneyDecimal('JPY')('fee'),
});
const pgSchema = {
  orders: pgOrders,
  payments: pgPayments,
  orderPayments: relations(pgOrders, ({ many }) => ({ payments: many(pgPayments) })),
  paymentOrder: relations(pgPayments, ({ one }) => ({
    order: one(pgOrders, { fields: [pgPayments.orderId], references: [pgOrders.id] }),
  })),
};
const sqliteSchema = {
  orders: sqliteOrders,
  payments: sqlitePayments,
  orderPayments: relations(sqliteOrders, ({ many }) => ({ payments: many(sqlitePayments) })),
  paymentOrder: relations(sqlitePayments, ({ one }) => ({
    order: one(sqliteOrders, { fields: [sqlitePayments.orderId], references: [sqliteOrders.id] }),
  })),
};
// 1.234 KWD, and 2^53 + 1 fils, which a JSON number can't hold
const PAYMENTS = [
  { id: 1, orderId: 1, amount: money('1.234', 'KWD'), fee: money('100', 'JPY') },
  { id: 2, orderId: 2, amount: money('9007199254740.993', 'KWD'), fee: null },
];

type Row = { id: number; total: Money<'EUR'>; price: Money<'EUR'> | null; refund: Money | null };

/** The rows every dialect inserts: one per amount, with a decimal and a JSON value where they fit. */
function sampleRows(): Row[] {
  return EURO_AMOUNTS.map((amount, index) => ({
    id: index + 1,
    total: money(amount, 'EUR'),
    price: DECIMAL_AMOUNTS.includes(amount) ? money(amount, 'EUR') : null,
    refund: index % 2 === 0 ? money(amount, 'EUR') : money('1.234', 'KWD'),
  }));
}

/** Rows as strings, so values compare by amount, currency and scale. */
function show(rows: Row[]): string[][] {
  return rows.map((row) => [
    String(row.id),
    String(row.total),
    String(row.price),
    String(row.refund),
  ]);
}

type OrdersTable = typeof pgOrders | typeof mysqlOrders | typeof sqliteOrders;

/**
 * Comparisons in SQL beyond 2^53 minor units and 15 significant digits, on the sample rows (id 5 is
 * 2^53 + 1 cents). As doubles, 2^53 + 1 and 2^53 cents are the same number, so a driver or server
 * that compares through doubles matches the wrong rows (#258).
 */
async function expectExactComparisons(
  orders: OrdersTable,
  ids: (where: SQL | undefined) => Promise<number[]>,
): Promise<void> {
  const { total, price } = orders as typeof pgOrders;
  const above = money('90071992547409.93', 'EUR'); // 2^53 + 1 cents, row 5
  const between = money('90071992547409.92', 'EUR'); // 2^53 cents, no row
  expect(await ids(eq(total, above))).toEqual([5]);
  expect(await ids(eq(total, between))).toEqual([]);
  expect(await ids(and(gt(total, money('90071992547409.91', 'EUR')), lt(total, above)))).toEqual(
    [],
  );
  expect(await ids(and(gt(total, between), lt(total, money('1e15', 'EUR'))))).toEqual([5]);
  expect(await ids(eq(price, above))).toEqual([5]);
  expect(await ids(eq(price, between))).toEqual([]);
}

describe('Drizzle column types', () => {
  it('declare the SQL types each dialect needs', () => {
    expect(pgOrders.total.getSQLType()).toBe('bigint');
    expect(pgOrders.price.getSQLType()).toBe('numeric(19, 4)');
    expect(pgOrders.refund.getSQLType()).toBe('jsonb');
    expect(mysqlOrders.price.getSQLType()).toBe('decimal(19, 4)');
    expect(mysqlOrders.refund.getSQLType()).toBe('json');
    expect(sqliteOrders.total.getSQLType()).toBe('integer');
    expect(sqliteOrders.price.getSQLType()).toBe('text');
    expect(sqliteOrders.refund.getSQLType()).toBe('text');
  });

  // type-level assertions only
  // oxlint-disable-next-line vitest/expect-expect
  it('carry the currency in the type: selects are Money<C>, inserts need Money<C>', () => {
    type Selected = typeof pgOrders.$inferSelect;
    type Inserted = typeof pgOrders.$inferInsert;
    expectTypeOf<Selected['total']>().toEqualTypeOf<Money<'EUR'>>();
    expectTypeOf<Selected['refund']>().toEqualTypeOf<Money<CurrencyInput> | null>();
    expectTypeOf(money('1', 'EUR')).toExtend<Inserted['total']>();
    expectTypeOf(money('1', 'USD')).not.toExtend<Inserted['total']>();
    expectTypeOf<(typeof sqliteOrders.$inferSelect)['total']>().toEqualTypeOf<Money<'EUR'>>();
    expectTypeOf<(typeof mysqlOrders.$inferSelect)['price']>().toEqualTypeOf<Money<'EUR'> | null>();
  });

  // oxlint-disable-next-line vitest/expect-expect
  it('type a scaled column and its read expression as Money<C>', () => {
    expectTypeOf<(typeof pgScaled.$inferSelect)['amount']>().toEqualTypeOf<Money<'EUR'> | null>();
    expectTypeOf(pgColumns.scaledMoney(pgScaled.amount)).toEqualTypeOf<SQL<Money<'EUR'> | null>>();
    // a NOT NULL amount column reads as Money<C>
    type NotNullRead = ReturnType<typeof sqliteColumns.scaledMoney<typeof sqliteOrders.total>>;
    expectTypeOf<NotNullRead>().toEqualTypeOf<SQL<Money<'EUR'>>>();
    expectTypeOf(money('1', 'USD')).not.toExtend<(typeof mysqlScaled.$inferInsert)['amount']>();
  });

  it('scaledMoney needs a moneyMinor column with a scale column in its table', () => {
    expect(pgScaled.amount.getSQLType()).toBe('bigint');
    expect(sqliteScaled.amount.getSQLType()).toBe('integer');
    expect(() => pgColumns.scaledMoney(pgOrders.total)).toThrow(/needs a moneyMinor column/);
    expect(() => sqliteColumns.scaledMoney(sqliteOrders.id)).toThrow(/needs a moneyMinor column/);
    const misnamed = sqliteTable('ducat_drizzle_misnamed', {
      amount: sqliteColumns.moneyMinor('EUR', { scale: 'scale' })('amount_minor'),
      amountScale: sqliteInteger('amount_scale'),
    });
    expect(() => sqliteColumns.scaledMoney(misnamed.amount)).toThrow(/no column "scale"/);
    expect(() => mysqlColumns.moneyMinor('XXX1', { scale: 's' })).toThrow(/Unknown currency/);
  });

  it('reject a decimal column that would round the currency, or an unknown currency', () => {
    expect(() => pgColumns.moneyDecimal('KWD', { precision: 19, scale: 2 })).toThrow(/round KWD/);
    expect(() => mysqlColumns.moneyDecimal('CLF', { precision: 19, scale: 3 })).toThrow(RangeError);
    expect(() => sqliteColumns.moneyDecimal('XXX1')).toThrow(/Unknown currency/);
  });
});

describe('Drizzle on SQLite (better-sqlite3)', () => {
  let connection: Database.Database;
  let db: ReturnType<typeof drizzleSqlite<typeof sqliteSchema>>;

  beforeAll(() => {
    connection = new Database(':memory:');
    // integers as bigint: the default (number) would lose digits beyond 2^53
    connection.defaultSafeIntegers(true);
    connection.exec(
      'CREATE TABLE ducat_drizzle_orders ' +
        '(id INTEGER PRIMARY KEY, total_minor INTEGER NOT NULL, price TEXT, refund TEXT);' +
        'CREATE TABLE ducat_drizzle_payments ' +
        '(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, amount_minor INTEGER NOT NULL, fee TEXT);' +
        'CREATE TABLE ducat_drizzle_scaled ' +
        '(id INTEGER PRIMARY KEY, amount_minor INTEGER, amount_scale SMALLINT)',
    );
    db = drizzleSqlite({ client: connection, schema: sqliteSchema });
  });

  afterAll(() => {
    connection.close();
  });

  it('round-trips minor units, decimals and JSON exactly', async () => {
    const rows = sampleRows();
    await db.insert(sqliteOrders).values(rows);
    const readBack = await db.select().from(sqliteOrders).orderBy(asc(sqliteOrders.id));
    expect(show(readBack)).toEqual(show(rows));
  });

  it("a scale column round-trips amounts above, at and below the currency's scale", async () => {
    await db.insert(sqliteScaled).values(scaledRows());
    const readBack = await db
      .select({ id: sqliteScaled.id, amount: sqliteColumns.scaledMoney(sqliteScaled.amount) })
      .from(sqliteScaled)
      .orderBy(asc(sqliteScaled.id));
    expect(showScaled(readBack)).toEqual(showScaled(scaledRows()));
  });

  it('a scale column: a NULL scale throws, and so does the column read by itself', () => {
    connection.exec('INSERT INTO ducat_drizzle_scaled VALUES (101, 5, NULL)');
    const read = () =>
      db
        .select({ amount: sqliteColumns.scaledMoney(sqliteScaled.amount) })
        .from(sqliteScaled)
        .where(eq(sqliteScaled.id, 101))
        .all();
    expect(read).toThrow(/integer scale from 0 to 1000 in "amountScale", got null/);
    expect(() => db.select().from(sqliteScaled).where(eq(sqliteScaled.id, 1)).all()).toThrow(
      /select it with scaledMoney/,
    );
    expect(() =>
      db
        .insert(sqliteScaled)
        .values({ id: 102, amount: money('1', 'USD') as never, amountScale: 2 })
        .run(),
    ).toThrow(CurrencyMismatchError);
  });

  it('round-trips JPY and KWD, the ends of the exponent range', async () => {
    await db.insert(sqlitePayments).values(PAYMENTS);
    const readBack = await db.select().from(sqlitePayments).orderBy(asc(sqlitePayments.id));
    expect(readBack.map((row) => [String(row.amount), String(row.fee)])).toEqual([
      ['1.234 KWD', '100 JPY'],
      ['9007199254740.993 KWD', 'null'],
    ]);
  });

  it('relational queries: nested columns come through JSON, so big minor units throw', async () => {
    // nested rows arrive as JSON: TEXT decimals stay strings, integers become JSON numbers
    const small = await db.query.orders.findFirst({
      where: eq(sqliteOrders.id, 1),
      with: { payments: true },
    });
    expect(small!.payments.map((row) => [String(row.amount), String(row.fee)])).toEqual([
      ['1.234 KWD', '100 JPY'],
    ]);
    const huge = db.query.orders.findFirst({
      where: eq(sqliteOrders.id, 2),
      with: { payments: true },
    });
    // a Drizzle query is a lazy thenable, not a Promise; Bun's `rejects` needs a real Promise
    await expect((async () => await huge)()).rejects.toThrow(/safe integer/);
  });

  // the assertions are in expectExactComparisons
  // oxlint-disable-next-line vitest/expect-expect
  it('compares beyond 2^53 exactly in SQL', async () => {
    await expectExactComparisons(sqliteOrders, async (where) =>
      (
        await db
          .select({ id: sqliteOrders.id })
          .from(sqliteOrders)
          .where(where)
          .orderBy(asc(sqliteOrders.id))
      ).map((row) => Number(row.id)),
    );
  });

  it('filters by a Money value through the column mapping', async () => {
    const found = await db
      .select({ id: sqliteOrders.id })
      .from(sqliteOrders)
      .where(eq(sqliteOrders.total, money('12.34', 'EUR')));
    expect(found.map((row) => Number(row.id))).toEqual([2]);
  });

  it('refuses another currency at run time, before anything is written', () => {
    const dollars = money('1', 'USD') as unknown as Money<'EUR'>;
    expect(() => db.insert(sqliteOrders).values({ id: 100, total: dollars }).run()).toThrow(
      CurrencyMismatchError,
    );
    expect(() =>
      db
        .insert(sqliteOrders)
        .values({ id: 101, total: money('1.001', 'EUR', { scale: 3 }) })
        .run(),
    ).toThrow(/round\(\)/);
  });

  it('with the default number integers, a value beyond 2^53 throws instead of losing digits', () => {
    const plain = new Database(':memory:');
    plain.exec('CREATE TABLE ducat_drizzle_orders (id INTEGER PRIMARY KEY, total_minor INTEGER)');
    plain.exec('INSERT INTO ducat_drizzle_orders VALUES (1, 1234), (2, 9007199254740993)');
    const plainDb = drizzleSqlite({ client: plain });
    const small = plainDb
      .select({ total: sqliteOrders.total })
      .from(sqliteOrders)
      .where(sql`id = 1`)
      .all();
    expect(String(small[0]!.total)).toBe('12.34 EUR');
    expect(() => plainDb.select({ total: sqliteOrders.total }).from(sqliteOrders).all()).toThrow(
      /safe integer/,
    );
    plain.close();
  });
});

describe('Drizzle on Postgres (node-postgres)', () => {
  it.skipIf(Boolean(pgUrl) || !isDatabaseRequired)('has a server URL', () => {
    expect(pgUrl).toBeDefined();
  });

  describe.skipIf(!pgUrl)('against a server', () => {
    let client: pg.Client;
    let db: NodePgDatabase<typeof pgSchema>;

    beforeAll(async () => {
      // the default type parsers: int8 and numeric come back as strings, jsonb parsed
      client = new pg.Client({ connectionString: pgUrl });
      await client.connect();
      await client.query('DROP TABLE IF EXISTS ducat_drizzle_orders');
      await client.query(
        'CREATE TABLE ducat_drizzle_orders ' +
          '(id INTEGER PRIMARY KEY, total_minor BIGINT NOT NULL, price NUMERIC(19,4), refund JSONB)',
      );
      await client.query('DROP TABLE IF EXISTS ducat_drizzle_payments');
      await client.query(
        'CREATE TABLE ducat_drizzle_payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, ' +
          'amount_minor BIGINT NOT NULL, fee NUMERIC(19,4))',
      );
      await client.query('DROP TABLE IF EXISTS ducat_drizzle_scaled');
      await client.query(
        'CREATE TABLE ducat_drizzle_scaled ' +
          '(id INTEGER PRIMARY KEY, amount_minor BIGINT, amount_scale SMALLINT)',
      );
      db = drizzlePg({ client, schema: pgSchema });
    });

    afterAll(async () => {
      await client?.end();
    });

    it('round-trips minor units, decimals and JSON exactly', async () => {
      const rows = sampleRows();
      await db.insert(pgOrders).values(rows);
      const readBack = await db.select().from(pgOrders).orderBy(asc(pgOrders.id));
      expect(show(readBack)).toEqual(show(rows));
    });

    // the assertions are in expectExactComparisons
    // oxlint-disable-next-line vitest/expect-expect
    it('compares beyond 2^53 exactly in SQL', async () => {
      await expectExactComparisons(pgOrders, async (where) =>
        (
          await db.select({ id: pgOrders.id }).from(pgOrders).where(where).orderBy(asc(pgOrders.id))
        ).map((row) => Number(row.id)),
      );
    });

    it("a scale column round-trips amounts above, at and below the currency's scale", async () => {
      await db.insert(pgScaled).values(scaledRows());
      const readBack = await db
        .select({ id: pgScaled.id, amount: pgColumns.scaledMoney(pgScaled.amount) })
        .from(pgScaled)
        .orderBy(asc(pgScaled.id));
      expect(showScaled(readBack)).toEqual(showScaled(scaledRows()));

      await client.query('INSERT INTO ducat_drizzle_scaled VALUES (101, 5, NULL)');
      const nullScale = db
        .select({ amount: pgColumns.scaledMoney(pgScaled.amount) })
        .from(pgScaled)
        .where(eq(pgScaled.id, 101));
      await expect(nullScale).rejects.toThrow(/integer scale from 0 to 1000/);
      await expect(db.select().from(pgScaled).where(eq(pgScaled.id, 1))).rejects.toThrow(
        /select it with scaledMoney/,
      );
    });

    it('round-trips JPY and KWD, the ends of the exponent range', async () => {
      await db.insert(pgPayments).values(PAYMENTS);
      const readBack = await db.select().from(pgPayments).orderBy(asc(pgPayments.id));
      expect(readBack.map((row) => [String(row.amount), String(row.fee)])).toEqual([
        ['1.234 KWD', '100 JPY'],
        ['9007199254740.993 KWD', 'null'],
      ]);
    });

    it('relational queries: nested NUMERIC and big BIGINT arrive as JSON numbers and throw', async () => {
      const small = await db.query.orders.findFirst({
        where: eq(pgOrders.id, 1),
        with: { payments: { columns: { amount: true } } },
      });
      expect(small!.payments.map((row) => String(row.amount))).toEqual(['1.234 KWD']);

      const withFee = db.query.orders.findFirst({
        where: eq(pgOrders.id, 1),
        with: { payments: true },
      });
      await expect(withFee).rejects.toThrow(/as strings/);
      const huge = db.query.orders.findFirst({
        where: eq(pgOrders.id, 2),
        with: { payments: { columns: { amount: true } } },
      });
      // a Drizzle query is a lazy thenable, not a Promise; Bun's `rejects` needs a real Promise
      await expect((async () => await huge)()).rejects.toThrow(/safe integer/);
    });

    it('sums in SQL and reads the result back as Money', async () => {
      const [result] = await db
        .select({ total: sql`sum(${pgOrders.total})`.mapWith(pgOrders.total) })
        .from(pgOrders)
        .where(sql`${pgOrders.id} <= 3`);
      expect(String(result!.total)).toBe('12.33 EUR');
    });

    it("rejects NUMERIC 'NaN' on read", async () => {
      await client.query("INSERT INTO ducat_drizzle_orders VALUES (99, 0, 'NaN', NULL)");
      const query = db
        .select()
        .from(pgOrders)
        .where(sql`${pgOrders.id} = 99`);
      await expect(query).rejects.toThrow(SyntaxError);
    });
  });
});

describe('Drizzle on MySQL (mysql2)', () => {
  it.skipIf(Boolean(mysqlUrl) || !isDatabaseRequired)('has a server URL', () => {
    expect(mysqlUrl).toBeDefined();
  });

  describe.skipIf(!mysqlUrl)('against a server', () => {
    let connection: mysql.Connection;
    let db: MySql2Database;

    beforeAll(async () => {
      // BIGINT as strings: mysql2's default number loses digits beyond 2^53
      connection = await mysql.createConnection({
        uri: mysqlUrl!,
        supportBigNumbers: true,
        bigNumberStrings: true,
      });
      await connection.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES'");
      await connection.query('DROP TABLE IF EXISTS ducat_drizzle_orders');
      await connection.query(
        'CREATE TABLE ducat_drizzle_orders ' +
          '(id INT PRIMARY KEY, total_minor BIGINT NOT NULL, price DECIMAL(19,4), refund JSON)',
      );
      await connection.query('DROP TABLE IF EXISTS ducat_drizzle_scaled');
      await connection.query(
        'CREATE TABLE ducat_drizzle_scaled ' +
          '(id INT PRIMARY KEY, amount_minor BIGINT, amount_scale SMALLINT)',
      );
      db = drizzleMysql({ client: connection });
    });

    afterAll(async () => {
      await connection?.end();
    });

    it('round-trips minor units, decimals and JSON exactly', async () => {
      const rows = sampleRows();
      await db.insert(mysqlOrders).values(rows);
      const readBack = await db.select().from(mysqlOrders).orderBy(asc(mysqlOrders.id));
      expect(show(readBack)).toEqual(show(rows));
    });

    it("a scale column round-trips amounts above, at and below the currency's scale", async () => {
      await db.insert(mysqlScaled).values(scaledRows());
      const readBack = await db
        .select({ id: mysqlScaled.id, amount: mysqlColumns.scaledMoney(mysqlScaled.amount) })
        .from(mysqlScaled)
        .orderBy(asc(mysqlScaled.id));
      expect(showScaled(readBack)).toEqual(showScaled(scaledRows()));

      await connection.query('INSERT INTO ducat_drizzle_scaled VALUES (101, 5, NULL)');
      const nullScale = db
        .select({ amount: mysqlColumns.scaledMoney(mysqlScaled.amount) })
        .from(mysqlScaled)
        .where(eq(mysqlScaled.id, 101));
      // a Drizzle query is a lazy thenable, not a Promise; Bun's `rejects` needs a real Promise
      await expect((async () => await nullScale)()).rejects.toThrow(/integer scale from 0 to 1000/);
      const plain = db.select().from(mysqlScaled).where(eq(mysqlScaled.id, 1));
      await expect((async () => await plain)()).rejects.toThrow(/select it with scaledMoney/);
    });

    it('how MySQL compares string parameters beyond 2^53 (#258)', async () => {
      // 2^53 cents, which no row holds; as a double it equals row 5's 2^53 + 1
      const between = '9007199254740992';
      const decimal = '90071992547409.92';
      const ids = (rows: unknown) => (rows as { id: number }[]).map((row) => Number(row.id));
      const where = 'SELECT id FROM ducat_drizzle_orders WHERE';
      const results = {
        // mysql2 query(): the client interpolates a quoted literal
        queryMinor: ids((await connection.query(`${where} total_minor = ?`, [between]))[0]),
        queryDecimal: ids((await connection.query(`${where} price = ?`, [decimal]))[0]),
        // mysql2 execute(): a server-side prepared statement with a string parameter
        executeMinor: ids((await connection.execute(`${where} total_minor = ?`, [between]))[0]),
        executeDecimal: ids((await connection.execute(`${where} price = ?`, [decimal]))[0]),
        executeRange: ids(
          (
            await connection.execute(`${where} total_minor > ? AND total_minor < ?`, [
              '9007199254740991',
              '9007199254740993',
            ])
          )[0],
        ),
      };
      expect(results).toEqual({
        queryMinor: [],
        queryDecimal: [],
        executeMinor: [],
        executeDecimal: [],
        executeRange: [],
      });
    });

    // the assertions are in expectExactComparisons
    // oxlint-disable-next-line vitest/expect-expect
    it('compares beyond 2^53 exactly in SQL', async () => {
      await expectExactComparisons(mysqlOrders, async (where) =>
        (
          await db
            .select({ id: mysqlOrders.id })
            .from(mysqlOrders)
            .where(where)
            .orderBy(asc(mysqlOrders.id))
        ).map((row) => Number(row.id)),
      );
    });

    it('outside strict mode, where MySQL clips a BIGINT, an out-of-range amount still throws', async () => {
      const lenient = await mysql.createConnection({
        uri: mysqlUrl!,
        bigNumberStrings: true,
        supportBigNumbers: true,
      });
      try {
        await lenient.query("SET SESSION sql_mode = ''");
        // what the guard prevents: the server stores the limit, with only a warning
        await lenient.query('INSERT INTO ducat_drizzle_orders (id, total_minor) VALUES (90, 1e22)');
        const [clipped] = await lenient.query(
          'SELECT total_minor FROM ducat_drizzle_orders WHERE id = 90',
        );
        expect((clipped as { total_minor: string }[])[0]!.total_minor).toBe('9223372036854775807');

        const lenientDb = drizzleMysql({ client: lenient });
        const insert = lenientDb
          .insert(mysqlOrders)
          .values({ id: 91, total: money('1e20', 'EUR') });
        await expect(insert).rejects.toThrow(/range of a BIGINT/);
      } finally {
        await lenient.end();
      }
    });

    it("with mysql2's default number BIGINTs, a value beyond 2^53 throws instead of losing digits", async () => {
      const defaults = await mysql.createConnection({ uri: mysqlUrl! });
      try {
        const defaultDb = drizzleMysql({ client: defaults });
        const small = await defaultDb
          .select({ total: mysqlOrders.total })
          .from(mysqlOrders)
          .where(eq(mysqlOrders.id, 2));
        expect(String(small[0]!.total)).toBe('12.34 EUR');
        const huge = defaultDb
          .select({ total: mysqlOrders.total })
          .from(mysqlOrders)
          .where(eq(mysqlOrders.id, 5));
        // a Drizzle query is a lazy thenable, not a Promise; Bun's `rejects` needs a real Promise
        await expect((async () => await huge)()).rejects.toThrow(/safe integer/);
      } finally {
        await defaults.end();
      }
    });
  });
});
