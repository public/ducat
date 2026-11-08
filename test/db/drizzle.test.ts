// Drizzle ORM columns against real databases: SQLite (better-sqlite3) always, Postgres and MySQL
// when DUCAT_PG_URL and DUCAT_MYSQL_URL are set (CI runs both as service containers).
import Database from 'better-sqlite3';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleMysql, type MySql2Database } from 'drizzle-orm/mysql2';
import { int, mysqlTable } from 'drizzle-orm/mysql-core';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { integer as pgInteger, pgTable } from 'drizzle-orm/pg-core';
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

  it('reject a decimal column that would round the currency, or an unknown currency', () => {
    expect(() => pgColumns.moneyDecimal('KWD', { precision: 19, scale: 2 })).toThrow(/round KWD/);
    expect(() => mysqlColumns.moneyDecimal('CLF', { precision: 19, scale: 3 })).toThrow(RangeError);
    expect(() => sqliteColumns.moneyDecimal('XXX1')).toThrow(/Unknown currency/);
  });
});

describe('Drizzle on SQLite (better-sqlite3)', () => {
  let connection: Database.Database;
  let db: ReturnType<typeof drizzleSqlite>;

  beforeAll(() => {
    connection = new Database(':memory:');
    // integers as bigint: the default (number) would lose digits beyond 2^53
    connection.defaultSafeIntegers(true);
    connection.exec(
      'CREATE TABLE ducat_drizzle_orders ' +
        '(id INTEGER PRIMARY KEY, total_minor INTEGER NOT NULL, price TEXT, refund TEXT)',
    );
    db = drizzleSqlite({ client: connection });
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
    let db: NodePgDatabase;

    beforeAll(async () => {
      // the default type parsers: int8 and numeric come back as strings, jsonb parsed
      client = new pg.Client({ connectionString: pgUrl });
      await client.connect();
      await client.query('DROP TABLE IF EXISTS ducat_drizzle_orders');
      await client.query(
        'CREATE TABLE ducat_drizzle_orders ' +
          '(id INTEGER PRIMARY KEY, total_minor BIGINT NOT NULL, price NUMERIC(19,4), refund JSONB)',
      );
      db = drizzlePg({ client });
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
  });
});
