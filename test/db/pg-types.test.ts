// The node-postgres parsers, the composite money type and the NUMERIC guard against a real Postgres
// server. Set DUCAT_PG_URL (CI runs a postgres service container).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { money, type Money } from '../../src/index.js';
import { identical } from '../../src/fn.js';
import {
  exactTypes,
  moneyTypeOids,
  moneyTypeSql,
  toMoneyComposite,
  toNumeric,
} from '../../src/pg.js';

const connectionString = process.env.DUCAT_PG_URL;
const isDatabaseRequired = process.env.DUCAT_REQUIRE_DB === '1';

describe('node-postgres parsers and the money composite type', () => {
  it.skipIf(Boolean(connectionString) || !isDatabaseRequired)('has a server URL', () => {
    expect(connectionString).toBeDefined();
  });

  describe.skipIf(!connectionString)('against a server', () => {
    let client: pg.Client;

    beforeAll(async () => {
      const setup = new pg.Client({ connectionString });
      await setup.connect();
      await setup.query('DROP TABLE IF EXISTS ducat_pg_items');
      // CASCADE: the add function and the aggregate depend on the type
      await setup.query('DROP TYPE IF EXISTS ducat_money CASCADE');
      for (const statement of moneyTypeSql()) {
        await setup.query(statement);
      }
      await setup.query(
        'CREATE TABLE ducat_pg_items (id INTEGER PRIMARY KEY, price ducat_money, ' +
          'n19 NUMERIC(19,4), minor BIGINT)',
      );
      const oids = await moneyTypeOids(setup);
      await setup.end();

      client = new pg.Client({ connectionString, types: exactTypes(pg.types, { money: oids }) });
      await client.connect();
    });

    afterAll(async () => {
      await client?.end();
    });

    it('BIGINT comes back as bigint and NUMERIC as the exact string, arrays included', async () => {
      const result = await client.query(
        "SELECT 9223372036854775807::bigint AS big, '12.3400'::numeric AS amount, " +
          'ARRAY[0.1, 0.2, NULL]::numeric[] AS amounts, ARRAY[9007199254740993]::bigint[] AS bigs',
      );
      expect(result.rows[0]).toEqual({
        big: 9223372036854775807n,
        amount: '12.3400',
        amounts: ['0.1', '0.2', null],
        bigs: [9007199254740993n],
      });
    });

    it('BIGINT limits, nested arrays, and string mode', async () => {
      const result = await client.query(
        'SELECT (-9223372036854775808)::bigint AS low, ' +
          "'{{1.50,2},{NULL,-0.01}}'::numeric[] AS grid",
      );
      expect(result.rows[0]).toEqual({
        low: -9223372036854775808n,
        grid: [
          ['1.50', '2'],
          [null, '-0.01'],
        ],
      });

      const strings = new pg.Client({
        connectionString,
        types: exactTypes(pg.types, { int8: 'string' }),
      });
      await strings.connect();
      try {
        const counted = await strings.query(
          'SELECT count(*) AS n, 9223372036854775807::bigint AS big',
        );
        expect(counted.rows[0]).toEqual({ n: '1', big: '9223372036854775807' });
      } finally {
        await strings.end();
      }
    });

    it("rejects NUMERIC 'NaN' and 'Infinity'", async () => {
      for (const special of ['NaN', 'Infinity', '-Infinity']) {
        await expect(client.query(`SELECT '${special}'::numeric AS amount`)).rejects.toThrow(
          SyntaxError,
        );
      }
    });

    it('stores Money in the composite type exactly, keeping currency and scale', async () => {
      const prices: Money[] = [
        money('12.34', 'EUR'),
        money('7.50', 'EUR'),
        money('0.0001', 'EUR', { scale: 4 }),
        money('1000', 'JPY'),
        money('1.234', 'KWD'),
        money('92233720368547758070000.01', 'EUR'),
      ];
      for (const [index, price] of prices.entries()) {
        await client.query('INSERT INTO ducat_pg_items (id, price) VALUES ($1, $2::ducat_money)', [
          index + 1,
          toMoneyComposite(price),
        ]);
      }

      const result = await client.query('SELECT price FROM ducat_pg_items ORDER BY id');
      const readBack = result.rows.map((row) => row.price as Money);
      expect(readBack.every((price, index) => identical(price, prices[index]!))).toBe(true);

      const arrays = await client.query(
        'SELECT array_agg(price ORDER BY id) AS prices FROM ducat_pg_items WHERE id <= 2',
      );
      expect((arrays.rows[0].prices as Money[]).map(String)).toEqual(['12.34 EUR', '7.50 EUR']);
    });

    it('NaN in a composite or a NUMERIC array is rejected on read', async () => {
      await expect(client.query("SELECT ARRAY[1, 'NaN']::numeric[] AS amounts")).rejects.toThrow(
        SyntaxError,
      );
      await expect(
        client.query("SELECT ROW('NaN'::numeric, 'EUR')::ducat_money AS price"),
      ).rejects.toThrow(SyntaxError);
      await expect(client.query("SELECT ROW(NULL, 'EUR')::ducat_money AS price")).rejects.toThrow(
        TypeError,
      );
    });

    it('sum() adds amounts in one currency, and refuses to add two currencies', async () => {
      const euros = await client.query(
        "SELECT sum(price) AS total FROM ducat_pg_items WHERE (price).currency = 'EUR'",
      );
      expect(String(euros.rows[0].total)).toBe('92233720368547758070019.8501 EUR');

      const empty = await client.query(
        'SELECT sum(price) AS total FROM ducat_pg_items WHERE false',
      );
      expect(empty.rows[0].total).toBeNull();

      await expect(client.query('SELECT sum(price) FROM ducat_pg_items')).rejects.toThrow(
        /cannot add EUR and JPY amounts/,
      );
    });

    it('toNumeric refuses what NUMERIC(19,4) would round silently or reject', async () => {
      // what the guard prevents: Postgres rounds the extra decimal on insert, without an error
      await client.query("INSERT INTO ducat_pg_items (id, n19) VALUES (100, '1.23456')");
      const stored = await client.query('SELECT n19 FROM ducat_pg_items WHERE id = 100');
      expect(stored.rows[0].n19).toBe('1.2346');

      const size = { precision: 19, scale: 4 };
      expect(() => toNumeric(money('1.23456', 'EUR', { scale: 5 }), size)).toThrow(/would round/);
      expect(() => toNumeric(money('1000000000000000', 'EUR'), size)).toThrow(/does not fit/);

      const exact = money('123456789012345.6789', 'EUR', { scale: 4 });
      await client.query('INSERT INTO ducat_pg_items (id, n19) VALUES (101, $1)', [
        toNumeric(exact, size),
      ]);
      const back = await client.query('SELECT n19 FROM ducat_pg_items WHERE id = 101');
      expect(back.rows[0].n19).toBe('123456789012345.6789');
    });

    it('a schema-qualified type works with an empty search_path', async () => {
      await client.query('DROP SCHEMA IF EXISTS ducat_billing CASCADE');
      await client.query('CREATE SCHEMA ducat_billing');
      for (const statement of moneyTypeSql('ducat_billing.amount')) {
        await client.query(statement);
      }
      const oids = await moneyTypeOids(client, 'ducat_billing.amount');
      const scoped = new pg.Client({
        connectionString,
        types: exactTypes(pg.types, { money: oids }),
      });
      await scoped.connect();
      try {
        await scoped.query("SET search_path = ''");
        const result = await scoped.query(
          "SELECT ducat_billing.sum(price) AS total FROM (VALUES ('(1.234,KWD)'::ducat_billing.amount), " +
            "('(0.766,KWD)'::ducat_billing.amount)) AS prices (price)",
        );
        expect(String(result.rows[0].total)).toBe('2.000 KWD');
      } finally {
        await scoped.end();
      }
    });
  });
});
