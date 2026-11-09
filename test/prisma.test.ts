// every ISO 4217 code: this file builds Money from /fn-level modules, which don't register them
import '../src/plugins/iso.js';
import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/library';
import DecimalJs from 'decimal.js';
import Big from 'big.js';
import { RoundingError, fromMinor, identical, money, toDecimal } from '../src/fn.js';
import { runs } from './fc-config.js';
import {
  decimalMoneyField,
  fromDecimal,
  minorMoneyField,
  toDecimalValue,
  toMinorColumns,
} from '../src/prisma.js';

describe('Prisma / DB helpers', () => {
  it('Decimal round trips (Prisma.Decimal, decimal.js, big.js)', () => {
    for (const D of [PrismaDecimal, DecimalJs, Big] as unknown as (new (v: string) => {
      toFixed(): string;
    })[]) {
      const m = money('1234567890123456789.12', 'EUR');
      const dv = toDecimalValue(m, D);
      expect(toDecimal(fromDecimal(dv, 'EUR'))).toBe('1234567890123456789.12');
      expect(toDecimal(fromDecimal(new D('0.0000001'), 'EUR', { scale: 7 }))).toBe('0.0000001'); // no exponent notation
    }
  });
  it('NUMERIC(19,4) style values with trailing zeros are accepted', () => {
    expect(toDecimal(fromDecimal(new PrismaDecimal('12.3400'), 'EUR'))).toBe('12.34');
    expect(() => fromDecimal(new PrismaDecimal('12.3456'), 'EUR')).toThrow(RoundingError);
  });
  it('result-extension fields', () => {
    const f = minorMoneyField('totalMinor', 'currency');
    expect(f.needs).toEqual({ totalMinor: true, currency: true });
    expect(f.compute({ totalMinor: 1234n, currency: 'EUR' }).toString()).toBe('12.34 EUR');
    const g = decimalMoneyField('price', { currency: 'GBP' });
    expect(g.compute({ price: new PrismaDecimal('9.99') }).toString()).toBe('9.99 GBP');
    const h = decimalMoneyField('price', { currencyField: 'cur' });
    expect(h.needs).toEqual({ price: true, cur: true });
  });
  it('write columns', () => {
    expect(toMinorColumns(money('12.34', 'EUR'), 'totalMinor', 'currency')).toEqual({
      totalMinor: 1234n,
      currency: 'EUR',
    });
    expect(() => toMinorColumns(money('1.234', 'EUR', { scale: 3 }), 'a', 'c')).toThrow(/round/);
  });
  it('a scale column round-trips any scale, and records it next to the minor units', () => {
    const field = minorMoneyField('amountMinor', 'currency', { scale: 'amountScale' });
    expect(field.needs).toEqual({ amountMinor: true, currency: true, amountScale: true });

    fc.assert(
      fc.property(
        fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }),
        fc.constantFrom('EUR', 'JPY', 'KWD', 'CLF'),
        fc.nat({ max: 12 }),
        (minor, currency, scale) => {
          const original = fromMinor(minor, currency, scale);
          const columns = toMinorColumns(original, 'amountMinor', 'currency', {
            scale: 'amountScale',
          });
          expect(columns).toEqual({ amountMinor: minor, currency, amountScale: scale });
          expect(identical(field.compute(columns), original)).toBe(true);
          // drivers may return a SMALLINT as a bigint (SQLite with safe integers)
          const asBigInt = { ...columns, amountScale: BigInt(scale) };
          expect(identical(field.compute(asBigInt), original)).toBe(true);
        },
      ),
      { numRuns: runs(1000) },
    );

    const subMinor = money('1.234', 'EUR', { scale: 3 });
    expect(toMinorColumns(subMinor, 'a', 'c', { scale: 's' })).toEqual({
      a: 1234n,
      c: 'EUR',
      s: 3,
    });
  });

  it('rejects a scale that is missing, negative, not an integer or beyond 1000', () => {
    const atLimit = { amountMinor: 1n, currency: 'EUR', amountScale: 1000 };
    expect(
      minorMoneyField('amountMinor', 'currency', { scale: 'amountScale' }).compute(atLimit).scale,
    ).toBe(1000);
    const field = minorMoneyField('amountMinor', 'currency', { scale: 'amountScale' });
    for (const amountScale of [null, undefined, -1, 1.5, '2', NaN, 1001, 10 ** 9, 2n ** 70n]) {
      const row = { amountMinor: 1234n, currency: 'EUR', amountScale } as never;
      expect(() => field.compute(row)).toThrow(/integer scale from 0 to 1000 in "amountScale"/);
    }
  });

  it('types the scale column in needs, rows and written columns', () => {
    const columns = toMinorColumns(money('1', 'EUR'), 'amountMinor', 'currency', {
      scale: 'amountScale',
    });
    expectTypeOf(columns).toEqualTypeOf<
      { amountMinor: bigint } & { currency: string } & { amountScale: number }
    >();
    const field = minorMoneyField('amountMinor', 'currency', { scale: 'amountScale' });
    expectTypeOf(field.needs).toEqualTypeOf<{
      amountMinor: true;
      currency: true;
      amountScale: true;
    }>();
  });
});

// Values a database driver can hand back; checking them needs no database.
describe('driver values', () => {
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
});
