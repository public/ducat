// Shared database integration suite for the SQL helpers, run against real Postgres, MySQL and
// SQLite. Each driver file supplies a small adapter; the suite covers the two storage layouts the
// helpers support (BIGINT minor units + currency, or a DECIMAL/NUMERIC column) and Money as JSON.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromJSON, fromMinor, money, toDecimal, type Money } from '../../src/index.js';
import {
  decimalMoneyField,
  fromDecimal,
  minorMoneyField,
  toMinorColumns,
  type DecimalLike,
} from '../../src/prisma.js';

export interface DatabaseAdapter {
  /** column types for this dialect */
  readonly types: {
    bigint: string;
    numeric19: string;
    numeric38: string;
    json: string;
    text: string;
  };
  /** whether a decimal column rounds to its declared scale (Postgres and MySQL; not SQLite TEXT) */
  readonly roundsToColumnScale: boolean;
  /** the bind placeholder for the 1-based parameter `position` */
  placeholder(position: number): string;
  execute(sql: string): Promise<void>;
  run(sql: string, parameters: unknown[]): Promise<void>;
  query(sql: string, parameters?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

type Row = Record<string, unknown>;

const AMOUNTS = [
  ['0.00', 'EUR'],
  ['12.34', 'EUR'],
  ['-0.01', 'EUR'],
  ['1000', 'JPY'],
  ['1.234', 'KWD'],
  ['90071992547409.91', 'EUR'], // 2^53 - 1 cents
  ['90071992547409.93', 'EUR'], // 2^53 + 1 cents
  ['-90071992547409.93', 'EUR'],
  ['125000000000000.01', 'USD'], // world GDP, in cents
  ['92233720368547758.07', 'EUR'], // BIGINT max
  ['-92233720368547758.08', 'EUR'], // BIGINT min
] as const;

/** NUMERIC(19,4) holds at most 15 integer digits */
function fitsNumeric19(decimal: string): boolean {
  const integerDigits = decimal.replace('-', '').split('.')[0]!;
  return integerDigits.length <= 15;
}

/** A driver's DECIMAL value (a string, or a number in SQLite) as the helpers' DecimalLike. */
function asDecimalLike(value: unknown): DecimalLike {
  return { toFixed: () => String(value) };
}

function tableName(suffix: string): string {
  return `ducat_${suffix}`;
}

export interface SuiteOptions {
  /** false skips the suite, e.g. when no server URL is configured */
  readonly enabled: boolean;
  readonly connect: () => Promise<DatabaseAdapter>;
  readonly extraTests?: (database: () => DatabaseAdapter) => void;
}

// CI sets DUCAT_REQUIRE_DB=1, so a lost connection URL fails the job instead of skipping it
const isDatabaseRequired = process.env.DUCAT_REQUIRE_DB === '1';

export function databaseSuite(name: string, options: SuiteOptions): void {
  const { enabled, connect, extraTests } = options;

  describe(`${name}: configuration`, () => {
    it.skipIf(enabled || !isDatabaseRequired)('has a server URL', () => {
      expect(enabled).toBe(true);
    });
  });

  describe.skipIf(!enabled)(`${name}: SQL helpers against a real database`, () => {
    let database: DatabaseAdapter;

    beforeAll(async () => {
      database = await connect();
      const { bigint, numeric19, numeric38, json, text } = database.types;

      for (const suffix of ['minor', 'decimal', 'json']) {
        await database.execute(`DROP TABLE IF EXISTS ${tableName(suffix)}`);
      }
      await database.execute(
        `CREATE TABLE ${tableName('minor')} ` +
          `(id INTEGER PRIMARY KEY, amount_minor ${bigint} NOT NULL, currency CHAR(3) NOT NULL)`,
      );
      await database.execute(
        `CREATE TABLE ${tableName('decimal')} ` +
          `(id INTEGER PRIMARY KEY, n19 ${numeric19}, n38 ${numeric38}, currency ${text})`,
      );
      await database.execute(
        `CREATE TABLE ${tableName('json')} (id INTEGER PRIMARY KEY, doc ${json})`,
      );
    });

    afterAll(async () => {
      await database?.close();
    });

    it('BIGINT minor units round-trip exactly, beyond 2^53 and at the BIGINT limits', async () => {
      const placeholders = [1, 2, 3].map((position) => database.placeholder(position)).join(', ');
      const insert = `INSERT INTO ${tableName('minor')} (id, amount_minor, currency) VALUES (${placeholders})`;

      for (const [index, [decimal, currency]] of AMOUNTS.entries()) {
        const columns = toMinorColumns(money(decimal, currency), 'amount_minor', 'currency');
        await database.run(insert, [index + 1, columns.amount_minor, columns.currency]);
      }

      const field = minorMoneyField('amount_minor', 'currency');
      const rows = await database.query(
        `SELECT amount_minor, currency FROM ${tableName('minor')} ORDER BY id`,
      );
      const readBack = rows.map((row) => toDecimal(field.compute(row as never)));
      expect(readBack).toEqual(AMOUNTS.map(([decimal]) => decimal));
    });

    it('NUMERIC(19,4) and NUMERIC(38,4) round-trip at currency scale (trailing zeros accepted)', async () => {
      await database.execute(`DELETE FROM ${tableName('decimal')}`);
      const placeholders = [1, 2, 3, 4]
        .map((position) => database.placeholder(position))
        .join(', ');
      const insert = `INSERT INTO ${tableName('decimal')} (id, n19, n38, currency) VALUES (${placeholders})`;

      for (const [index, [decimal, currency]] of AMOUNTS.entries()) {
        const narrowValue = fitsNumeric19(decimal) ? decimal : null;
        await database.run(insert, [index + 1, narrowValue, decimal, currency]);
      }

      const narrowField = decimalMoneyField('n19', { currencyField: 'currency' });
      const wideField = decimalMoneyField('n38', { currencyField: 'currency' });
      const rows = await database.query(
        `SELECT n19, n38, currency FROM ${tableName('decimal')} ORDER BY id`,
      );
      expect(rows).toHaveLength(AMOUNTS.length);

      for (const [index, row] of rows.entries()) {
        const [expected] = AMOUNTS[index]!;
        const currency = row.currency as string;

        const wide = wideField.compute({ n38: asDecimalLike(row.n38), currency });
        expect(toDecimal(wide)).toBe(expected);

        if (row.n19 !== null) {
          const narrow = narrowField.compute({ n19: asDecimalLike(row.n19), currency });
          expect(toDecimal(narrow)).toBe(expected);
        }
      }
    });

    it('a value the column rounded silently is rejected on read, not rounded again', async (context) => {
      if (!database.roundsToColumnScale) {
        context.skip();
      }

      // NUMERIC(19,4) stores 1.23456 EUR as 1.2346: more decimals than EUR has
      await database.execute(`DELETE FROM ${tableName('decimal')}`);
      const insert = `INSERT INTO ${tableName('decimal')} (id, n19, currency) VALUES (1, ${database.placeholder(1)}, 'EUR')`;
      await database.run(insert, ['1.23456']);

      const [row] = await database.query(`SELECT n19 FROM ${tableName('decimal')}`);
      const stored = String(row!.n19);
      expect(stored).toMatch(/^1\.2346/);
      expect(() => fromDecimal(stored, 'EUR')).toThrow(/more than 2 decimal places/);

      // still readable exactly at the column's own scale
      expect(toDecimal(fromDecimal(stored, 'EUR', { scale: 4 }))).toBe('1.2346');
    });

    it('Money as JSON round-trips, with the amount as a string so no precision is lost', async () => {
      await database.execute(`DELETE FROM ${tableName('json')}`);
      const insert = `INSERT INTO ${tableName('json')} (id, doc) VALUES (${database.placeholder(1)}, ${database.placeholder(2)})`;
      const amounts: Money[] = AMOUNTS.map(([decimal, currency]) => money(decimal, currency));

      for (const [index, amount] of amounts.entries()) {
        await database.run(insert, [index + 1, JSON.stringify(amount)]);
      }

      // JSON and JSONB columns come back parsed; SQLite TEXT comes back as the string
      const rows = await database.query(`SELECT doc FROM ${tableName('json')} ORDER BY id`);
      expect(rows).toHaveLength(AMOUNTS.length);
      const readBack = rows.map((row: Row) => fromJSON(row.doc as never));
      expect(readBack.map(String)).toEqual(amounts.map(String));
    });

    it('lossy driver values are rejected: unsafe numbers, strings as minor units, NaN, Infinity', () => {
      expect(() => fromMinor(2 ** 63, 'EUR')).toThrow(/safe integer/);
      expect(() => fromMinor('1234' as never, 'EUR')).toThrow(TypeError);

      for (const special of [NaN, Infinity, -Infinity]) {
        expect(() => fromMinor(special, 'EUR')).toThrow(RangeError);
      }
      for (const text of ['NaN', 'Infinity', '-Infinity', 'inf', '']) {
        expect(() => fromDecimal(text, 'EUR')).toThrow(SyntaxError);
      }
    });

    extraTests?.(() => database);
  });
}
