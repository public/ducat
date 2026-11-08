import Database from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, money } from '../src/index.js';
import {
  moneyHelpers,
  MoneyResultPlugin,
  setDecimalMoney,
  setMoney,
  fixed,
} from '../src/kysely.js';
import { kyselyScenario } from './kysely-scenario.js';

const databaseFile = join(mkdtempSync(join(tmpdir(), 'ducat-kysely-')), 'test.db');

kyselyScenario('SQLite (better-sqlite3)', true, {
  dialect: 'sqlite',
  makeDialect: () => {
    // a file, so the CamelCasePlugin instance sees the same tables
    const database = new Database(databaseFile);
    // integers as bigint: the default (number) would lose digits beyond 2^53
    database.defaultSafeIntegers(true);
    return new SqliteDialect({ database });
  },
  ddl: [
    'CREATE TABLE ducat_kysely_payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, ' +
      'amount_minor INTEGER NOT NULL, currency TEXT)',
    'CREATE TABLE ducat_kysely_orders (id INTEGER PRIMARY KEY, total_minor INTEGER NOT NULL, price TEXT)',
  ],
  canStream: true,
});

describe('MoneyResultPlugin', () => {
  const plugin = new MoneyResultPlugin();
  const convert = async (rows: Record<string, unknown>[]) =>
    (await plugin.transformResult({ queryId: { queryId: 'q' }, result: { rows } } as never)).rows;

  it('converts marker objects and marker text anywhere in a row, and nothing else', async () => {
    const marker = { $ducat: 'minor', amount: '1234', currency: 'EUR' };
    const [row] = await convert([
      {
        top: marker,
        text: JSON.stringify({ $ducat: 'decimal', amount: '1.234', currency: 'KWD' }),
        nested: [{ inner: marker }],
        plain: { amount: '1', currency: 'EUR' },
        other: '{"a":1}',
      },
    ]);
    expect(String(row!.top)).toBe('12.34 EUR');
    expect(String(row!.text)).toBe('1.234 KWD');
    expect(String((row!.nested as { inner: unknown }[])[0]!.inner)).toBe('12.34 EUR');
    expect(row!.plain).toEqual({ amount: '1', currency: 'EUR' });
    expect(row!.other).toBe('{"a":1}');
  });

  it('keeps the same result object when there is nothing to convert', async () => {
    const result = { rows: [{ a: 1 }] };
    const out = await plugin.transformResult({ queryId: { queryId: 'q' }, result } as never);
    expect(out).toBe(result);
  });

  it('validates every marker field', async () => {
    const bad = [
      { $ducat: 'minor', amount: 12.5, currency: 'EUR' },
      { $ducat: 'minor', amount: '1e3', currency: 'EUR' },
      { $ducat: 'minor', amount: '1', currency: null },
      { $ducat: 'decimal', amount: '1.2345', currency: 'EUR' },
      { $ducat: 'decimal', amount: 1.5, currency: 'EUR' },
      { $ducat: 'other', amount: '1', currency: 'EUR' },
    ];
    for (const marker of bad) {
      await expect(convert([{ value: marker }])).rejects.toBeInstanceOf(Error);
    }
    await expect(
      convert([{ value: { $ducat: 'minor', amount: '1', currency: 'EUR', mixed: 1 } }]),
    ).rejects.toThrow(CurrencyMismatchError);
  });
});

describe('helpers outside a query', () => {
  it('setMoney and setDecimalMoney write both columns, or check a fixed currency', () => {
    expect(setMoney(money('12.34', 'EUR'), 'amount_minor', 'currency')).toEqual({
      amount_minor: '1234',
      currency: 'EUR',
    });
    expect(setDecimalMoney(money('1.234', 'KWD'), 'price', fixed('KWD'))).toEqual({
      price: '1.234',
    });
    expect(() => setMoney(money('1.001', 'EUR', { scale: 3 }), 'a', 'c')).toThrow(/round\(\)/);
    expect(() => setMoney(money('1e20', 'EUR'), 'a', 'c')).toThrow(/range of a BIGINT/);
    expect(() =>
      // @ts-expect-error a fixed column needs Money in its currency
      setMoney(money('1', 'USD'), 'total_minor', fixed('EUR')),
    ).toThrow(CurrencyMismatchError);
  });

  it('refuses what a dialect cannot do exactly', () => {
    const sqlite = moneyHelpers('sqlite');
    const builder = {} as never;
    expect(() => sqlite.sumDecimalMoney(builder, 'price' as never, fixed('EUR'))).toThrow(/REAL/);
    expect(() =>
      sqlite.compareDecimalMoney(builder, 'price' as never, fixed('EUR'), '<', money('1', 'EUR')),
    ).toThrow(/orders as text/);
    expect(() => moneyHelpers('oracle' as never)).toThrow(/Unknown dialect/);
  });
});
