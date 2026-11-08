import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
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
    'CREATE TABLE ducat_kysely_ledger (id INTEGER PRIMARY KEY, amount_minor INTEGER, currency TEXT)',
  ],
  canStream: true,
});

describe('MoneyResultPlugin', () => {
  const plugin = new MoneyResultPlugin();
  const convert = async (rows: Record<string, unknown>[]) =>
    (await plugin.transformResult({ queryId: { queryId: 'q' }, result: { rows } } as never)).rows;

  // the nonce appears only in query text, so the tests read it from a compiled query
  const compiled = new Kysely<{ t: { a: string; c: string } }>({
    dialect: new SqliteDialect({ database: new Database(':memory:') }),
  })
    .selectFrom('t')
    .select((eb) => moneyHelpers('sqlite').selectMoney(eb, 'a', 'c').as('m'))
    .compile().sql;
  const nonce = /'([0-9a-f]{32}):minor'/.exec(compiled)![1]!;
  const minor = (amount: unknown, currency: unknown) => ({
    $ducat: `${nonce}:minor`,
    amount,
    currency,
  });

  it("converts this process's markers, as objects and as text, at any depth", async () => {
    const [row] = await convert([
      {
        top: minor('1234', 'EUR'),
        text: JSON.stringify({ $ducat: `${nonce}:decimal`, amount: '1.234', currency: 'KWD' }),
        // MySQL orders JSON keys by length, so the marker key needn't come first
        reordered: JSON.stringify({
          mixed: 0,
          amount: '5',
          currency: 'JPY',
          $ducat: `${nonce}:minor`,
        }),
        nested: [{ inner: minor('1', 'EUR') }],
      },
    ]);
    expect(String(row!.top)).toBe('12.34 EUR');
    expect(String(row!.text)).toBe('1.234 KWD');
    expect(String(row!.reordered)).toBe('5 JPY');
    expect(String((row!.nested as { inner: unknown }[])[0]!.inner)).toBe('0.01 EUR');
  });

  it('leaves look-alikes as plain data, never throwing: wrong nonce, extra keys, broken text', async () => {
    const lookAlikes = [
      { $ducat: 'minor', amount: '100000', currency: 'USD' },
      { $ducat: `${'0'.repeat(32)}:minor`, amount: '1', currency: 'USD' },
      { ...minor('1', 'USD'), extra: true },
      { $ducat: `${nonce}:other`, amount: '1', currency: 'USD' },
      '{"$ducat":"minor","amount":"100000","currency":"USD"}',
      '{"$ducat"x',
      `{"$ducat":"${nonce}:minor"`,
      `{"$ducat":"${nonce}:minor","amount":"1","currency":"EUR","__proto__":{"x":1}}`,
    ];
    const rows = await convert(lookAlikes.map((value) => ({ value })));
    expect(rows.map((row) => row.value)).toEqual(lookAlikes);
  });

  it('copies objects safely and stops at a depth limit', async () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true},"m":null}') as Record<
      string,
      unknown
    >;
    parsed.m = minor('1', 'EUR');
    const [row] = await convert([{ value: parsed }]);
    const value = row!.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(String(value.m)).toBe('0.01 EUR');

    let deep: unknown = minor('1', 'EUR');
    for (let i = 0; i < 100; i++) {
      deep = [deep];
    }
    const [deepRow] = await convert([{ value: deep }]);
    expect(deepRow!.value).toBe(deep);
  });

  it('keeps the same result object when there is nothing to convert', async () => {
    const result = { rows: [{ a: 1 }] };
    const out = await plugin.transformResult({ queryId: { queryId: 'q' }, result } as never);
    expect(out).toBe(result);
  });

  it('validates a genuine marker strictly, and never lets the nonce out', async () => {
    for (const bad of [minor(12.5, 'EUR'), minor('1e3', 'EUR'), minor('1', null)]) {
      await expect(convert([{ value: bad }])).rejects.toBeInstanceOf(Error);
    }
    const decimal = { $ducat: `${nonce}:decimal`, amount: '1.2345', currency: 'EUR' };
    await expect(convert([{ value: decimal }])).rejects.toThrow(/decimal places/);
    await expect(convert([{ value: { ...minor('1', 'EUR'), mixed: 1 } }])).rejects.toThrow(
      CurrencyMismatchError,
    );

    const rows = await convert([{ value: minor('1234', 'EUR'), list: [minor('1', 'USD')] }]);
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(nonce);
    expect(serialised).toBe(
      '[{"value":{"amount":"12.34","currency":"EUR"},"list":[{"amount":"0.01","currency":"USD"}]}]',
    );
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
    // a column that would round or clamp the value
    expect(() =>
      setDecimalMoney(money('1.234', 'KWD'), 'p', 'c', { precision: 19, scale: 2 }),
    ).toThrow(/would round KWD/);
    expect(() => setDecimalMoney(money('1000000000000000', 'EUR'), 'p', 'c')).toThrow(
      /does not fit/,
    );
    expect(() => fixed('XXX1')).toThrow(/Unknown currency/);
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
