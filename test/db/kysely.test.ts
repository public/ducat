// The Kysely money helpers against real Postgres and MySQL, when DUCAT_PG_URL and DUCAT_MYSQL_URL
// are set (CI runs both as service containers). test/kysely.test.ts runs the same scenario on SQLite.
import { MysqlDialect, PostgresDialect } from 'kysely';
import { createPool } from 'mysql2';
import pg from 'pg';
import Cursor from 'pg-cursor';
import { describe, expect, it } from 'vitest';
import { kyselyScenario } from '../kysely-scenario.js';

const pgUrl = process.env.DUCAT_PG_URL;
const mysqlUrl = process.env.DUCAT_MYSQL_URL;
const isDatabaseRequired = process.env.DUCAT_REQUIRE_DB === '1';

describe('Kysely database configuration', () => {
  it.skipIf((Boolean(pgUrl) && Boolean(mysqlUrl)) || !isDatabaseRequired)('has both URLs', () => {
    expect([pgUrl, mysqlUrl]).not.toContain(undefined);
  });
});

kyselyScenario('Postgres (node-postgres)', Boolean(pgUrl), {
  dialect: 'postgres',
  // node-postgres defaults: int8 and numeric as strings, json parsed
  // pg-cursor gives stream() real server-side chunks
  makeDialect: () =>
    new PostgresDialect({ pool: new pg.Pool({ connectionString: pgUrl }), cursor: Cursor }),
  ddl: [
    'CREATE TABLE ducat_kysely_payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, ' +
      'amount_minor BIGINT NOT NULL, currency CHAR(3))',
    'CREATE TABLE ducat_kysely_orders (id INTEGER PRIMARY KEY, total_minor BIGINT NOT NULL, ' +
      'price NUMERIC(19,4))',
    'CREATE TABLE ducat_kysely_ledger (id INTEGER PRIMARY KEY, amount_minor BIGINT, currency CHAR(3))',
  ],
  canStream: true,
});

kyselyScenario('MySQL (mysql2)', Boolean(mysqlUrl), {
  dialect: 'mysql',
  // BIGINT as strings: mysql2's default number loses digits beyond 2^53
  makeDialect: () =>
    new MysqlDialect({
      pool: createPool({ uri: mysqlUrl!, supportBigNumbers: true, bigNumberStrings: true }),
    }),
  ddl: [
    'CREATE TABLE ducat_kysely_payments (id INT PRIMARY KEY, order_id INT NOT NULL, ' +
      'amount_minor BIGINT NOT NULL, currency CHAR(3))',
    'CREATE TABLE ducat_kysely_orders (id INT PRIMARY KEY, total_minor BIGINT NOT NULL, price DECIMAL(19,4))',
    'CREATE TABLE ducat_kysely_ledger (id INT PRIMARY KEY, amount_minor BIGINT, currency CHAR(3))',
  ],
  canStream: true,
});
