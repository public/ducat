import { describe, expect, it } from 'vitest';
import { fromMinor, money, toDecimal, RoundingError } from '../src/index.js';
import { fromKlarna, isKlarnaCurrency, klarnaExponent, toKlarna, KLARNA_EXPONENTS } from '../src/klarna.js';

describe('Klarna', () => {
  // the data-types page and the Payments API field descriptions
  it('documented examples: USD 1000, GBP 500, EUR 50, SEK 100, 25 EUR = 2500, 2000 = 20 EUR', () => {
    expect(toDecimal(fromKlarna(1000, 'USD'))).toBe('10.00');
    expect(toDecimal(fromKlarna(500, 'GBP'))).toBe('5.00');
    expect(toDecimal(fromKlarna(50, 'EUR'))).toBe('0.50');
    expect(toDecimal(fromKlarna(100, 'SEK'))).toBe('1.00');
    expect(toKlarna(money('25', 'EUR'))).toBe(2500);
    expect(toKlarna(money('20', 'EUR'))).toBe(2000);
  });
  it('HUF is in fillér, as ISO 4217 says', () => {
    expect(toKlarna(money('1000', 'HUF'))).toBe(100000);
    expect(toDecimal(fromKlarna(100000, 'HUF'))).toBe('1000.00');
  });
  it('more decimals than the currency has need a rounding mode', () => {
    const tooPrecise = money('10.005', 'EUR', { scale: 3 });
    expect(() => toKlarna(tooPrecise)).toThrow(RoundingError);
    expect(toKlarna(tooPrecise, { rounding: 'halfEven' })).toBe(1000);
  });
  it('discount order lines are negative; zero passes', () => {
    expect(toKlarna(money('-5', 'EUR'))).toBe(-500);
    expect(toDecimal(fromKlarna(-500, 'EUR'))).toBe('-5.00');
    expect(toKlarna(money('0', 'SEK'))).toBe(0);
    expect(toKlarna(money('-0.004', 'EUR', { scale: 3 }), { rounding: 'halfEven' })).toBe(0);
  });
  it('amounts beyond a safe integer throw', () => {
    expect(() => toKlarna(fromMinor(2n ** 60n, 'EUR'))).toThrow(/too large/);
    expect(() => fromKlarna(2 ** 53, 'EUR')).toThrow(RangeError);
  });
  it('only the local currencies of the purchase countries', () => {
    expect(isKlarnaCurrency('sek')).toBe(true);
    expect(isKlarnaCurrency('JPY')).toBe(false);
    expect(() => toKlarna(money('1', 'JPY'))).toThrow(/not a Klarna purchase currency/);
    expect(() => fromKlarna(1, 'BRL')).toThrow(/not a Klarna purchase currency/);
    expect(Object.keys(KLARNA_EXPONENTS).toSorted()).toEqual(
      'AUD CAD CHF CZK DKK EUR GBP HUF MXN NOK NZD PLN RON SEK USD'.split(' '),
    );
    expect(klarnaExponent('huf')).toBe(2);
  });
});
