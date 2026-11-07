import { describe, expect, it } from 'vitest';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/library';
import DecimalJs from 'decimal.js';
import Big from 'big.js';
import { money, toDecimal } from '../src/index.js';
import { decimalMoneyField, fromDecimal, minorMoneyField, toDecimalValue, toMinorColumns } from '../src/prisma.js';

describe('Prisma / DB helpers', () => {
  it('Decimal round trips (Prisma.Decimal, decimal.js, big.js)', () => {
    for (const D of [PrismaDecimal, DecimalJs, Big] as unknown as (new (v: string) => { toFixed(): string })[]) {
      const m = money('1234567890123456789.12', 'EUR');
      const dv = toDecimalValue(m, D);
      expect(toDecimal(fromDecimal(dv, 'EUR'))).toBe('1234567890123456789.12');
      expect(toDecimal(fromDecimal(new D('0.0000001'), 'EUR', { scale: 7 }))).toBe('0.0000001'); // no exponent notation
    }
  });
  it('NUMERIC(19,4) style values with trailing zeros are accepted', () => {
    expect(toDecimal(fromDecimal(new PrismaDecimal('12.3400'), 'EUR'))).toBe('12.34');
    expect(() => fromDecimal(new PrismaDecimal('12.3456'), 'EUR')).toThrow();
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
    expect(toMinorColumns(money('12.34', 'EUR'), 'totalMinor', 'currency')).toEqual({ totalMinor: 1234n, currency: 'EUR' });
    expect(() => toMinorColumns(money('1.234', 'EUR', { scale: 3 }), 'a', 'c')).toThrow(/round/);
  });
});
