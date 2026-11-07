// MySQL via mysql2. Set DUCAT_MYSQL_URL (CI runs a mysql service container).
// BIGINT is read as bigint through typeCast: mysql2's default turns it into a JS number, which
// loses precision beyond 2^53 (and the helpers reject such numbers).
import mysql from 'mysql2/promise';
import { expect, it } from 'vitest';
import { fromMinor } from '../../src/index.js';
import { databaseSuite, type DatabaseAdapter } from './suite.js';

// empty when unset, so the suite is skipped (mysql2's options need a string)
const connectionUrl = process.env.DUCAT_MYSQL_URL ?? '';

/** The parameters these tests bind: integers, decimal strings, JSON text and NULL. */
type BindValue = string | number | null;

/** bigint parameters as strings, which MySQL converts exactly */
function bindable(parameters: unknown[]): BindValue[] {
  return parameters.map((value) => (typeof value === 'bigint' ? value.toString() : (value as BindValue)));
}

async function connectToMysql(): Promise<DatabaseAdapter> {
  const connection = await mysql.createConnection({
    uri: connectionUrl,
    // DECIMAL as strings, never numbers
    decimalNumbers: false,
    typeCast(field, next) {
      if (field.type !== 'LONGLONG') {
        return next();
      }
      const text = field.string();
      return text === null ? null : BigInt(text);
    },
  });
  await connection.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES'");

  return {
    types: {
      bigint: 'BIGINT',
      numeric19: 'DECIMAL(19,4)',
      numeric38: 'DECIMAL(38,4)',
      json: 'JSON',
      text: 'VARCHAR(8)',
    },
    roundsToColumnScale: true,
    placeholder: () => '?',
    execute: async (sql) => {
      await connection.query(sql);
    },
    run: async (sql, parameters) => {
      await connection.execute(sql, bindable(parameters));
    },
    query: async (sql, parameters = []) => {
      const [rows] = await connection.query(sql, bindable(parameters));
      return rows as Record<string, unknown>[];
    },
    close: () => connection.end(),
  };
}

// skipped unless DUCAT_MYSQL_URL points at a server
databaseSuite('MySQL', {
  enabled: connectionUrl !== '',
  connect: connectToMysql,
  extraTests: () => {
    it('BIGINT read as a plain number (the driver default) is rejected beyond 2^53', async () => {
      const defaultConnection = await mysql.createConnection({ uri: connectionUrl });

      try {
        const [rows] = await defaultConnection.query('SELECT CAST(9007199254740993 AS SIGNED) AS v');
        const value = (rows as { v: unknown }[])[0]!.v;
        expect(typeof value).toBe('number');
        expect(() => fromMinor(value as number, 'EUR')).toThrow(/safe integer/);
      } finally {
        await defaultConnection.end();
      }
    });
  },
});
