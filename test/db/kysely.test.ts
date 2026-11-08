// The Kysely plugin against real Postgres and MySQL, when DUCAT_PG_URL and DUCAT_MYSQL_URL are set
// (CI runs both as service containers). test/kysely.test.ts covers SQLite.
import { Kysely, MysqlDialect, PostgresDialect, sql } from 'kysely';
import { createPool } from 'mysql2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { money, type Money } from '../../src/index.js';
import {
  moneyDecimal,
  moneyJson,
  moneyMinor,
  MoneyPlugin,
  type MoneyColumn,
} from '../../src/kysely.js';

const pgUrl = process.env.DUCAT_PG_URL;
const mysqlUrl = process.env.DUCAT_MYSQL_URL;
const isDatabaseRequired = process.env.DUCAT_REQUIRE_DB === '1';

interface Schema {
  ducat_kysely_orders: {
    id: number;
    total_minor: MoneyColumn<'EUR'>;
    price: MoneyColumn<'EUR'> | null;
    refund: MoneyColumn | null;
    amount_minor: MoneyColumn | null;
    currency: string | null;
  };
}

const plugin = new MoneyPlugin<Schema>({
  ducat_kysely_orders: {
    total_minor: moneyMinor('EUR'),
    price: moneyDecimal('EUR', { precision: 19, scale: 4 }),
    refund: moneyJson(),
    amount_minor: moneyMinor({ currencyColumn: 'currency' }),
  },
});

const AMOUNTS = [
  '0.00',
  '12.34',
  '-0.01',
  '90071992547409.93',
  '92233720368547758.07',
  '-92233720368547758.08',
];

function suite(
  name: string,
  enabled: boolean,
  connect: () => Promise<Kysely<Schema>>,
  ddl: string,
) {
  describe(`Kysely on ${name}`, () => {
    it.skipIf(enabled || !isDatabaseRequired)('has a server URL', () => {
      expect(enabled).toBe(true);
    });

    describe.skipIf(!enabled)('against a server', () => {
      let db: Kysely<Schema>;

      beforeAll(async () => {
        db = await connect();
        await db.schema.dropTable('ducat_kysely_orders').ifExists().execute();
        await sql.raw(ddl).execute(db);
      });

      afterAll(async () => {
        await db?.destroy();
      });

      it('round-trips minor units, decimals, JSON and minor units with a currency column', async () => {
        const rows = AMOUNTS.map((amount, index) => ({
          id: index + 1,
          total_minor: money(amount, 'EUR'),
          price: amount.length <= 18 ? money(amount, 'EUR') : null,
          refund: money(amount, 'EUR'),
          amount_minor: index % 2 === 0 ? money('1000', 'JPY') : money('1.234', 'KWD'),
          currency: index % 2 === 0 ? 'JPY' : 'KWD',
        }));
        await db.insertInto('ducat_kysely_orders').values(rows).execute();

        const readBack = await db
          .selectFrom('ducat_kysely_orders')
          .selectAll()
          .orderBy('id')
          .execute();
        const show = (row: {
          total_minor: Money;
          price: Money | null;
          refund: Money | null;
          amount_minor: Money | null;
        }) => [row.total_minor, row.price, row.refund, row.amount_minor].map(String);
        expect(readBack.map(show)).toEqual(rows.map(show));

        const found = await db
          .selectFrom('ducat_kysely_orders')
          .select('id')
          .where('total_minor', '=', money('92233720368547758.07', 'EUR'))
          .execute();
        expect(found.map((row) => Number(row.id))).toEqual([5]);
      });
    });
  });
}

suite(
  'Postgres',
  Boolean(pgUrl),
  async () =>
    new Kysely<Schema>({
      // node-postgres defaults: int8 and numeric as strings, jsonb parsed
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: pgUrl }) }),
      plugins: [plugin],
    }),
  'CREATE TABLE ducat_kysely_orders (id INTEGER PRIMARY KEY, total_minor BIGINT NOT NULL, ' +
    'price NUMERIC(19,4), refund JSONB, amount_minor BIGINT, currency CHAR(3))',
);

suite(
  'MySQL',
  Boolean(mysqlUrl),
  async () =>
    new Kysely<Schema>({
      // BIGINT as strings: mysql2's default number loses digits beyond 2^53
      dialect: new MysqlDialect({
        pool: createPool({ uri: mysqlUrl!, supportBigNumbers: true, bigNumberStrings: true }),
      }),
      plugins: [plugin],
    }),
  'CREATE TABLE ducat_kysely_orders (id INT PRIMARY KEY, total_minor BIGINT NOT NULL, ' +
    'price DECIMAL(19,4), refund JSON, amount_minor BIGINT, currency CHAR(3))',
);
