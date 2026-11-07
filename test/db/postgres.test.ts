// Postgres via node-postgres. Set DUCAT_PG_URL (CI runs a postgres service container).
// BIGINT (int8) is parsed to bigint: pg returns it as a string by default, which the helpers reject.
import pg from 'pg';
import { expect, it } from 'vitest';
import { fromDecimal, minorMoneyField } from '../../src/prisma.js';
import { databaseSuite, type DatabaseAdapter } from './suite.js';

const connectionString = process.env.DUCAT_PG_URL;
const INT8_TYPE_ID = 20;

/** bigint parameters as strings: node-postgres does not serialize bigint itself */
function bindable(parameters: unknown[]): unknown[] {
  return parameters.map((value) => (typeof value === 'bigint' ? value.toString() : value));
}

async function connectToPostgres(): Promise<DatabaseAdapter> {
  const typeParsers = {
    getTypeParser(typeId: number, format?: string) {
      if (typeId === INT8_TYPE_ID) {
        return (text: string) => BigInt(text);
      }
      return pg.types.getTypeParser(typeId, format as never);
    },
  };
  const client = new pg.Client({ connectionString, types: typeParsers as never });
  await client.connect();

  return {
    types: {
      bigint: 'BIGINT',
      numeric19: 'NUMERIC(19,4)',
      numeric38: 'NUMERIC(38,4)',
      json: 'JSONB',
      text: 'TEXT',
    },
    roundsToColumnScale: true,
    placeholder: (position) => `$${position}`,
    execute: async (sql) => {
      await client.query(sql);
    },
    run: async (sql, parameters) => {
      await client.query(sql, bindable(parameters));
    },
    query: async (sql, parameters = []) => {
      const result = await client.query(sql, bindable(parameters));
      return result.rows;
    },
    close: () => client.end(),
  };
}

// skipped unless DUCAT_PG_URL points at a server
databaseSuite('Postgres', {
  enabled: Boolean(connectionString),
  connect: connectToPostgres,
  extraTests: (database) => {
    it("NUMERIC 'NaN' and 'Infinity' are rejected on read", async () => {
      const [row] = await database().query(
        "SELECT 'NaN'::numeric AS a, 'Infinity'::numeric AS b, '-Infinity'::numeric AS c",
      );
      for (const value of Object.values(row!)) {
        expect(() => fromDecimal(String(value), 'EUR')).toThrow(SyntaxError);
      }
    });

    it('BIGINT with the default string parser is rejected, not misread', async () => {
      const defaultClient = new pg.Client({ connectionString });
      await defaultClient.connect();

      try {
        const result = await defaultClient.query("SELECT 9007199254740993::bigint AS amount_minor, 'EUR' AS currency");
        const row = result.rows[0];
        expect(typeof row.amount_minor).toBe('string');

        const field = minorMoneyField('amount_minor', 'currency');
        expect(() => field.compute(row)).toThrow(TypeError);
      } finally {
        await defaultClient.end();
      }
    });
  },
});
