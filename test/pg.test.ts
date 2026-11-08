import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defineCurrency, fromMinor, money } from '../src/index.js';
import { identical } from '../src/fn.js';
import {
  exactTypes,
  moneyTypeSql,
  parseArray,
  parseBigInt,
  parseMoneyComposite,
  parseNumeric,
  toMoneyComposite,
  toNumeric,
  type TypeParserSource,
} from '../src/pg.js';
import { runs } from './fc-config.js';

const currencies = fc.constantFrom('EUR', 'JPY', 'KWD', 'CLF', 'USD');

describe('scalar parsers', () => {
  it('BIGINT text becomes an exact bigint', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }), (value) => {
        expect(parseBigInt(value.toString())).toBe(value);
      }),
      { numRuns: runs(500) },
    );
    for (const text of ['', '1.5', '1e3', 'abc']) {
      expect(() => parseBigInt(text)).toThrow(SyntaxError);
    }
  });

  it('NUMERIC text stays the exact string; NaN and Infinity throw', () => {
    expect(parseNumeric('12.3400')).toBe('12.3400');
    expect(parseNumeric('-0.000000000000000000000001')).toBe('-0.000000000000000000000001');
    for (const text of ['NaN', 'Infinity', '-Infinity', '', '1.', '.5']) {
      expect(() => parseNumeric(text)).toThrow(SyntaxError);
    }
  });
});

describe('array parsing', () => {
  it('handles NULL, nesting, empty arrays, bounds and quoted elements', () => {
    expect(parseArray('{}')).toEqual([]);
    expect(parseArray('{1,NULL,-2.50}')).toEqual(['1', null, '-2.50']);
    expect(parseArray('{{1,2},{3,4}}')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseArray('[0:1]={7,8}')).toEqual(['7', '8']);
    expect(parseArray('{"(1.00,EUR)","(2,\\"X\\")"}')).toEqual(['(1.00,EUR)', '(2,"X")']);
    for (const text of ['', '{1,2', '{1}}', '{"a}', '1,2']) {
      expect(() => parseArray(text)).toThrow(SyntaxError);
    }
  });

  it('round-trips any nested array of decimal strings and NULLs', () => {
    const element = fc.option(
      fc
        .bigInt({ min: -(10n ** 30n), max: 10n ** 30n })
        .map((value) => `${value}.${'0'.repeat(2)}`),
    );
    const level = fc.array(element, { maxLength: 6 });
    const print = (items: unknown[]): string =>
      `{${items.map((item) => (Array.isArray(item) ? print(item) : (item ?? 'NULL'))).join(',')}}`;
    fc.assert(
      fc.property(fc.oneof(level, fc.array(level, { minLength: 1, maxLength: 4 })), (items) => {
        const isNested = Array.isArray(items[0]);
        // Postgres has no empty inner arrays
        if (isNested && (items as unknown[][]).some((inner) => inner.length === 0)) {
          return;
        }
        expect(parseArray(print(items))).toEqual(items);
      }),
      { numRuns: runs(500) },
    );
  });
});

describe('the composite money type', () => {
  it('round-trips value, currency and scale', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
        currencies,
        fc.nat({ max: 6 }),
        (minor, currency, extraScale) => {
          const original = fromMinor(minor, currency, fromMinor(0, currency).scale + extraScale);
          expect(identical(parseMoneyComposite(toMoneyComposite(original)), original)).toBe(true);
        },
      ),
      { numRuns: runs(1000) },
    );
  });

  it('reads at least the currency exponent, and rejects NULL fields and special values', () => {
    expect(String(parseMoneyComposite('(12,EUR)'))).toBe('12.00 EUR');
    expect(String(parseMoneyComposite('(1.5000,EUR)'))).toBe('1.5000 EUR');
    expect(String(parseMoneyComposite('(5,"JPY")'))).toBe('5 JPY');
    for (const text of ['(1,"EUR)', '(1,EUR', '1,EUR)', '(1,EUR,X)', '(1)', '(1e3,EUR)']) {
      expect(() => parseMoneyComposite(text)).toThrow(SyntaxError);
    }
    expect(() => parseMoneyComposite('(,EUR)')).toThrow(TypeError);
    expect(() => parseMoneyComposite('(1.00,)')).toThrow(TypeError);
    expect(() => parseMoneyComposite('(NaN,EUR)')).toThrow(SyntaxError);
    expect(() => parseMoneyComposite('(Infinity,EUR)')).toThrow(SyntaxError);
    expect(() => parseMoneyComposite('(1.00,XXX1)')).toThrow(/Unknown currency/);
  });

  it('quotes and escapes custom currency codes, so any code round-trips', () => {
    for (const code of ['A\\B', 'Q"X', 'C,D', 'P)Q', '(E)']) {
      defineCurrency(code, 2);
      const original = money('12.34', code);
      const text = toMoneyComposite(original);
      expect(identical(parseMoneyComposite(text), original)).toBe(true);
    }
    expect(toMoneyComposite(money('1', 'A\\B'))).toBe('(1.00,"A\\\\B")');
    // Postgres's own output doubles quotes and backslashes inside quoted fields
    expect(parseMoneyComposite('(1.00,"Q""X")').currency).toBe('Q"X');
    expect(parseMoneyComposite('(1.00,"A\\\\B")').currency).toBe('A\\B');
  });

  it('has DDL with a currency-checking sum, under a validated name', () => {
    const [type, add, aggregate] = moneyTypeSql('billing.amount');
    expect(type).toBe('CREATE TYPE billing.amount AS (amount numeric, currency text)');
    expect(add).toContain('SET search_path FROM CURRENT');
    expect(add).toContain('::billing.amount');
    expect(aggregate).toMatch(/^CREATE AGGREGATE billing\.sum\(billing\.amount\)/);
    expect(() => moneyTypeSql('x'.repeat(60))).toThrow(/too long/);
    for (const name of ['Money', 'a; DROP TABLE x', 'a.b.c', '']) {
      expect(() => moneyTypeSql(name)).toThrow(RangeError);
    }
  });
});

describe('exactTypes', () => {
  const base: TypeParserSource = {
    getTypeParser: (oid, format) => (text) => `base ${oid} ${format ?? 'text'} ${text}`,
  };

  it('replaces the BIGINT and NUMERIC parsers and their arrays, and delegates the rest', () => {
    const types = exactTypes(base);
    expect(types.getTypeParser(20)('9223372036854775807')).toBe(9223372036854775807n);
    expect(types.getTypeParser(1700)('1.10')).toBe('1.10');
    expect(types.getTypeParser(1016)('{1,NULL}')).toEqual([1n, null]);
    expect(types.getTypeParser(1231)('{0.1,0.2}')).toEqual(['0.1', '0.2']);
    expect(() => types.getTypeParser(1231)('{1,NaN}')).toThrow(SyntaxError);
    expect(types.getTypeParser(25)('x')).toBe('base 25 text x');
    expect(types.getTypeParser(20, 'binary')('x')).toBe('base 20 binary x');
  });

  it("keeps BIGINT as pg's exact string when asked", () => {
    const types = exactTypes(base, { int8: 'string' });
    expect(types.getTypeParser(20)('-9223372036854775808')).toBe('-9223372036854775808');
    expect(types.getTypeParser(1016)('{1,NULL}')).toEqual(['1', null]);
    expect(() => types.getTypeParser(20)('1.5')).toThrow(SyntaxError);
  });

  it('parses the composite type and its array when given their OIDs', () => {
    const types = exactTypes(base, { money: { oid: 90001, arrayOid: 90002 } });
    expect(String(types.getTypeParser(90001)('(1.234,KWD)'))).toBe('1.234 KWD');
    const parsed = types.getTypeParser(90002)('{"(1.00,EUR)",NULL}') as unknown[];
    expect(parsed.map(String)).toEqual(['1.00 EUR', 'null']);
  });
});

describe('toNumeric: the NUMERIC(p, s) guard', () => {
  const size = { precision: 19, scale: 4 };

  it('passes every value the column holds unchanged, and nothing it would round', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 21n), max: 10n ** 21n }),
        fc.integer({ min: 2, max: 8 }),
        (minor, scale) => {
          const amount = fromMinor(minor, 'EUR', scale);
          // an independent model in integers: the value times 10^4 must be whole, and below 10^15
          const scaledUp = minor * 10n ** 4n;
          const divisor = 10n ** BigInt(scale);
          const magnitude = minor < 0n ? -minor : minor;
          const fits = scaledUp % divisor === 0n && magnitude < 10n ** BigInt(15 + scale);
          if (fits) {
            // the stored text means the same amount
            expect(money(toNumeric(amount, size), 'EUR', { scale: 4 }).equals(amount)).toBe(true);
          } else {
            expect(() => toNumeric(amount, size)).toThrow(RangeError);
          }
        },
      ),
      { numRuns: runs(2000) },
    );
  });

  it('drops only trailing zeros beyond the column scale', () => {
    const amount = money('1.230000', 'EUR', { scale: 6 });
    expect(toNumeric(amount, size)).toBe('1.2300');
    expect(toNumeric(money('5.00', 'EUR'), { precision: 3, scale: 2 })).toBe('5.00');
    expect(toNumeric(money('0.12', 'EUR'), { precision: 4, scale: 4 })).toBe('0.12');
    expect(() => toNumeric(money('1.23456', 'EUR', { scale: 5 }), size)).toThrow(/would round/);
    expect(() => toNumeric(money('1', 'KWD'), { precision: 19, scale: 2 })).toThrow(/round KWD/);
  });
});
