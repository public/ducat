// SQLite through Node's built-in node:sqlite. Decimals are stored as TEXT: SQLite's NUMERIC
// affinity converts them to REAL or INTEGER, which loses digits (see the last test).
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { money, toDecimal } from '../../src/index.js';
import { fromDecimal } from '../../src/prisma.js';
import { databaseSuite, type DatabaseAdapter } from './suite.js';

async function connectToSqlite(): Promise<DatabaseAdapter> {
  const connection = new DatabaseSync(':memory:');

  return {
    types: { bigint: 'INTEGER', numeric19: 'TEXT', numeric38: 'TEXT', json: 'TEXT', text: 'TEXT' },
    roundsToColumnScale: false,
    placeholder: () => '?',
    execute: async (sql) => {
      connection.exec(sql);
    },
    run: async (sql, parameters) => {
      connection.prepare(sql).run(...(parameters as never[]));
    },
    query: async (sql, parameters = []) => {
      const statement = connection.prepare(sql);
      // INTEGER columns as bigint: the default (number) would lose precision beyond 2^53
      statement.setReadBigInts(true);
      return statement.all(...(parameters as never[])) as Record<string, unknown>[];
    },
    close: async () => {
      connection.close();
    },
  };
}

databaseSuite('SQLite', {
  enabled: true,
  connect: connectToSqlite,
  extraTests: (database) => {
    it('NUMERIC affinity is lossy, so decimals belong in TEXT columns', async () => {
      await database().execute('CREATE TABLE ducat_affinity (n NUMERIC)');
      const bigintMax = toDecimal(money('92233720368547758.07', 'EUR'));
      await database().run('INSERT INTO ducat_affinity (n) VALUES (?)', [bigintMax]);

      const [row] = await database().query('SELECT n, typeof(n) AS storage FROM ducat_affinity');

      // the cents are gone before the helpers ever see the value
      expect(row!.storage).toBe('integer');
      expect(toDecimal(fromDecimal(String(row!.n), 'EUR'))).not.toBe('92233720368547758.07');
    });
  },
});
