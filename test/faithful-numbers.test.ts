import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { money, ratio } from '../src/index.js';
import { fixed } from '../src/fixed.js';
import { allocate } from '../src/allocate.js';

// 1 / 0.52 and 0.1 + 0.2 print with 17 significant digits: float artefacts, not decimals anyone
// wrote. Every place a number becomes an exact value refuses them unless told how to round.
const artefacts = [1 / 0.52, 0.1 + 0.2, 2 ** 53 + 2, 1 / 3, 1e-7 / 3];

describe('numbers beyond 15 significant digits', () => {
  it('ratio() refuses them, and suggests a string', () => {
    for (const value of artefacts) {
      expect(() => ratio(value)).toThrow(RangeError);
    }
    expect(() => ratio(1.9230769230769231)).toThrow(
      '1.9230769230769231 has more than 15 significant digits; pass it as a string',
    );
    expect(ratio('1.9230769230769231').den).toBe(10n ** 16n);
  });
  it('every Factor-taking function refuses them through ratio()', () => {
    const eur = money('100', 'EUR');
    expect(() => eur.multiply(1 / 0.52)).toThrow(/more than 15 significant digits/);
    expect(() => eur.divide(0.1 + 0.2)).toThrow(/more than 15 significant digits/);
  });
  it('money() and fixed() refuse them unless a rounding mode is given', () => {
    expect(() => money(1 / 0.52, 'EUR', { scale: 20 })).toThrow(/more than 15 significant digits/);
    expect(money(1 / 0.52, 'EUR', { rounding: 'halfEven' }).toString()).toBe('1.92 EUR');
    expect(() => fixed(1 / 0.52)).toThrow(/pass a string, or \{ scale, rounding \}/);
    expect(fixed(1 / 0.52, { scale: 4, rounding: 'halfEven' }).toString()).toBe('1.9231');
  });
  it('allocation weights refuse them', () => {
    expect(() => allocate(money('1', 'EUR'), [1 / 3, 2 / 3])).toThrow(/pass weights as strings/);
  });
  it('accepts numbers of up to 15 significant digits, in any notation', () => {
    expect(ratio(0.0725).den).toBe(400n); // 29/400
    expect(ratio(1e-7).den).toBe(10n ** 7n);
    expect(ratio(123456789012345.6 - 0.6).num).toBe(123456789012345n);
    expect(ratio(1e21).num).toBe(10n ** 21n);
    expect(ratio(-0.000123456789012345)).toEqual(ratio('-0.000123456789012345'));
    expect(money(12.34, 'EUR').toString()).toBe('12.34 EUR');
    expect(fixed(0.25).toString()).toBe('0.25');
  });
  it('safe integers are exact, whatever their digit count', () => {
    for (const value of [2 ** 53 - 1, 1234567890123456, 1000000000000001, -(2 ** 53 - 1)]) {
      expect(ratio(value).num).toBe(BigInt(value));
      expect(money(value, 'JPY').minor).toBe(value);
      expect(fixed(value).value).toBe(value);
      expect(money('10', 'EUR').multiply(value).toScaledUnits()).toBe(1000n * BigInt(value));
    }
    const parts = allocate(money('1', 'EUR'), [1234567890123456, 1]);
    expect(parts.map(String)).toEqual(['1.00 EUR', '0.00 EUR']);
    // beyond 2^53 an integer may not be the one typed: 2^53 + 2 has 16 digits
    expect(() => ratio(2 ** 53 + 2)).toThrow(/more than 15 significant digits/);
    expect(() => money(2 ** 53 + 2, 'JPY')).toThrow(/more than 15 significant digits/);
  });
  it('property: a number accepted by ratio() is exactly its shortest decimal form', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
        const text = String(value);
        const digits = text
          .replace(/e.*$/, '')
          .replace(/[-.]/g, '')
          .replace(/^0+/, '')
          .replace(/0+$/, '');
        if (digits.length > 15) {
          expect(() => ratio(value)).toThrow(RangeError);
        } else {
          const exact = ratio(value);
          expect(exact.num * ratio(text).den).toBe(ratio(text).num * exact.den);
        }
      }),
    );
  });
});
