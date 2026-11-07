import { describe, expect, it } from 'vitest';
import { add, money, multiply, toDecimal, RoundingError, ISO_EXPONENTS } from '../src/index.js';
import {
  fromPayPal,
  isPayPalCurrency,
  paypalExponent,
  toPayPal,
  toPayPalValue,
  PAYPAL_EXPONENTS,
} from '../src/paypal.js';

const read = (value: string) => fromPayPal({ currency_code: 'USD', value });

describe('PayPal', () => {
  // Orders v2 "Create Order - Minimal Request and Response"
  it('documented example: 100.00 USD', () => {
    expect(toPayPal(money('100', 'USD'))).toEqual({ currency_code: 'USD', value: '100.00' });
    expect(toDecimal(fromPayPal({ currency_code: 'USD', value: '100.00' }))).toBe('100.00');
  });
  // Orders v2 PayPal-wallet example: item_total + shipping = amount, unit_amount x quantity = item_total
  it('documented breakdown: 20.00 x 1 + 100.00 x 2 + 10.00 shipping = 230.00', () => {
    const items = add(multiply(read('20.00'), 1), multiply(read('100.00'), 2));
    expect(toPayPalValue(items)).toBe('220.00');
    expect(toPayPal(add(items, read('10.00')))).toEqual({ currency_code: 'USD', value: '230.00' });
  });
  it('HUF, JPY and TWD take no decimals (HUF and TWD have 2 in ISO 4217)', () => {
    expect(toPayPalValue(money('1000', 'JPY'))).toBe('1000');
    expect(toPayPalValue(money('1000', 'HUF'))).toBe('1000');
    expect(toPayPalValue(money('250', 'TWD'))).toBe('250');
    expect(() => toPayPalValue(money('1000.50', 'HUF'))).toThrow(RoundingError);
    expect(toPayPalValue(money('1000.50', 'HUF'), { rounding: 'halfEven' })).toBe('1000');
    expect(toPayPalValue(money('1000.50', 'TWD'), { rounding: 'ceiling' })).toBe('1001');
    for (const code of ['HUF', 'JPY', 'TWD']) {
      expect(paypalExponent(code)).toBe(0);
    }
  });
  it('more decimals than PayPal takes need a rounding mode', () => {
    const tooPrecise = money('10.005', 'EUR', { scale: 3 });
    expect(() => toPayPal(tooPrecise)).toThrow(RoundingError);
    expect(toPayPal(tooPrecise, { rounding: 'halfEven' }).value).toBe('10.00');
    expect(toPayPal(tooPrecise, { rounding: 'halfExpand' }).value).toBe('10.01');
  });
  it('values are exact strings, not floats', () => {
    expect(toPayPalValue(money('0.10', 'USD'))).toBe('0.10');
    expect(toPayPalValue(money('999999999999999.99', 'USD'))).toBe('999999999999999.99');
    expect(() => toPayPalValue(money('1000000000000000', 'USD'))).toThrow(/15 digits/);
    expect(toDecimal(fromPayPal({ currency_code: 'USD', value: '999999999999999.99' }))).toBe('999999999999999.99');
  });
  it('zero is allowed, negative amounts throw (checked after rounding)', () => {
    expect(toPayPalValue(money('0', 'USD'))).toBe('0.00');
    expect(toPayPalValue(money('0', 'JPY'))).toBe('0');
    expect(toDecimal(fromPayPal({ currency_code: 'USD', value: '0.00' }))).toBe('0.00');
    expect(toDecimal(fromPayPal({ currency_code: 'JPY', value: '0' }))).toBe('0');
    expect(() => toPayPalValue(money('-5.05', 'USD'))).toThrow(/can't be negative/);
    expect(toPayPalValue(money('-0.004', 'USD', { scale: 3 }), { rounding: 'halfEven' })).toBe('0.00');
  });
  it('values longer than the schema maxLength (32) are rejected', () => {
    const longest = '1.' + '0'.repeat(30);
    expect(toDecimal(fromPayPal({ currency_code: 'USD', value: longest }))).toBe('1.00');
    expect(() => fromPayPal({ currency_code: 'USD', value: longest + '0' })).toThrow(SyntaxError);
  });
  it('reading keeps the ISO scale when exact and extra precision otherwise', () => {
    expect(toDecimal(fromPayPal({ currency_code: 'HUF', value: '1000' }))).toBe('1000.00');
    expect(toDecimal(fromPayPal({ currency_code: 'usd', value: '10' }))).toBe('10.00');
    expect(toDecimal(fromPayPal({ currency_code: 'USD', value: '10.000' }))).toBe('10.00');
    expect(toDecimal(fromPayPal({ currency_code: 'USD', value: '.5' }))).toBe('0.50');
    expect(toDecimal(fromPayPal({ currency_code: 'JPY', value: '10.5' }))).toBe('10.5');
    expect(fromPayPal({ currency_code: 'usd', value: '1' }).currency).toBe('USD');
  });
  it('rejects strings outside the schema pattern', () => {
    for (const value of ['', '1,00', '1e3', '+1', '1.', ' 1', '0x10', '1.0.0'])
      expect(() => fromPayPal({ currency_code: 'USD', value })).toThrow(SyntaxError);
    expect(() => fromPayPal({ currency_code: 'USD', value: 1 as unknown as string })).toThrow(SyntaxError);
  });
  it('unlisted currencies throw', () => {
    expect(isPayPalCurrency('usd')).toBe(true);
    expect(isPayPalCurrency('TND')).toBe(false);
    expect(() => toPayPal(money('1', 'ISK'))).toThrow(/not a PayPal currency/);
    expect(() => fromPayPal({ currency_code: 'KWD', value: '1.000' })).toThrow(/not a PayPal currency/);
  });
  it('the table matches the documented list', () => {
    expect(Object.keys(PAYPAL_EXPONENTS)).toHaveLength(25);
    for (const [code, exponent] of Object.entries(PAYPAL_EXPONENTS)) {
      const expected = ['HUF', 'JPY', 'TWD'].includes(code) ? 0 : ISO_EXPONENTS[code];
      expect(exponent).toBe(expected);
    }
    expect(new Set(Object.values(PAYPAL_EXPONENTS))).toEqual(new Set([0, 2]));
  });
});
