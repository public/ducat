import { describe, expect, it } from 'vitest';
import {
  defineCurrency,
  fromMinor,
  money,
  toDecimal,
  RoundingError,
  ISO_EXPONENTS,
} from '../src/fn.js';
import {
  checkoutExponent,
  fromCheckout,
  isCheckoutCurrency,
  toCheckout,
  toCheckoutAmount,
  CHECKOUT_RULES,
} from '../src/checkout.js';

describe('Checkout.com', () => {
  // the request examples on the "Format the amount value" page
  it('documented examples: 100 JPY, 100 BHD, 100 USD', () => {
    expect(toCheckout(money('100', 'JPY'))).toEqual({ amount: 100, currency: 'JPY' });
    expect(toCheckout(money('100', 'BHD'))).toEqual({ amount: 100000, currency: 'BHD' });
    expect(toCheckout(money('100', 'USD'))).toEqual({ amount: 10000, currency: 'USD' });
    expect(toDecimal(fromCheckout(100, 'JPY'))).toBe('100');
    expect(toDecimal(fromCheckout(100000, 'BHD'))).toBe('100.000');
    expect(toDecimal(fromCheckout(10000, 'usd'))).toBe('100.00');
  });
  it('three-decimal currencies: last digit must be 0 ("1001 is invalid")', () => {
    expect(() => toCheckoutAmount(money('1.001', 'BHD'))).toThrow(/multiple of 10/);
    expect(toCheckoutAmount(money('1.001', 'BHD'), { rounding: 'halfEven' })).toBe(1000);
    expect(toCheckoutAmount(money('1.005', 'KWD'), { rounding: 'halfExpand' })).toBe(1010);
    // IQD and LYD are three-decimal here too (Stripe lists neither)
    expect(toCheckoutAmount(money('2.5', 'IQD'))).toBe(2500);
    expect(toCheckoutAmount(money('2.5', 'LYD'))).toBe(2500);
  });
  it('CLP: two decimals, last two digits 00 for payments ("100010 is invalid")', () => {
    expect(ISO_EXPONENTS.CLP).toBe(0);
    expect(checkoutExponent('CLP')).toBe(2);
    expect(toCheckoutAmount(money('5000', 'CLP'))).toBe(500000);
    expect(toDecimal(fromCheckout(500000, 'CLP'))).toBe('5000');
    const odd = money('1000.10', 'CLP', { scale: 2 });
    expect(() => toCheckoutAmount(odd)).toThrow(/multiple of 100/);
    expect(toCheckoutAmount(odd, { rounding: 'floor' })).toBe(100000);
    // the Standalone API (authentication) is exempt
    expect(toCheckoutAmount(odd, { standalone: true })).toBe(100010);
    // a fractional CLP coming back keeps its precision
    expect(toDecimal(fromCheckout(100010, 'CLP'))).toBe('1000.10');
  });
  it('full-amount currencies include ISK and UGX at 0 (Stripe sends them x100)', () => {
    expect(toCheckoutAmount(money('5', 'ISK'))).toBe(5);
    expect(toCheckoutAmount(money('5', 'UGX'))).toBe(5);
  });
  it('MGA follows ISO (2) on Checkout.com', () => {
    expect(toCheckoutAmount(money('100.50', 'MGA'))).toBe(10050);
  });
  it('more precision than the API takes needs a rounding mode', () => {
    const tooPrecise = money('10.005', 'USD', { scale: 3 });
    expect(() => toCheckoutAmount(tooPrecise)).toThrow(RoundingError);
    expect(toCheckoutAmount(tooPrecise, { rounding: 'halfEven' })).toBe(1000);
  });
  it('zero (card verification) is allowed; negative amounts throw', () => {
    expect(toCheckoutAmount(money('0', 'USD'))).toBe(0);
    expect(() => toCheckoutAmount(money('-5', 'USD'))).toThrow(/can't be negative/);
    // the sign is checked after rounding: -0.004 rounds to zero
    expect(toCheckoutAmount(money('-0.004', 'USD', { scale: 3 }), { rounding: 'halfEven' })).toBe(
      0,
    );
  });
  it('amounts beyond a safe integer throw', () => {
    expect(() => toCheckoutAmount(fromMinor(2n ** 60n, 'USD'))).toThrow(/too large/);
    expect(() => fromCheckout(2 ** 53, 'USD')).toThrow(RangeError);
  });
  it('SLL and XDR are listed but need defineCurrency (not active ISO 4217 currencies)', () => {
    expect(isCheckoutCurrency('SLL')).toBe(true);
    expect(() => fromCheckout(100, 'XDR')).toThrow(/Unknown currency/);
    defineCurrency('SLL', 2);
    defineCurrency('XDR', 2);
    expect(toCheckout(money('1', 'SLL'))).toEqual({ amount: 100, currency: 'SLL' });
    expect(toDecimal(fromCheckout(250, 'XDR'))).toBe('2.50');
  });
  it('unlisted currencies throw', () => {
    expect(isCheckoutCurrency('usd')).toBe(true);
    expect(isCheckoutCurrency('CLF')).toBe(false);
    expect(() => toCheckoutAmount(money('1', 'CLF'))).toThrow(/not a Checkout.com currency/);
    expect(() => fromCheckout(1, 'UYI')).toThrow(/not a Checkout.com currency/);
  });
  it('every rule is consistent with the documented lists', () => {
    const zero = 'BIF DJF GNF ISK JPY KMF KRW PYG RWF UGX VUV VND XAF XOF XPF'.split(' ');
    const three = 'BHD IQD JOD KWD LYD OMR TND'.split(' ');
    const expectedExponent = (code: string) => {
      if (zero.includes(code)) {
        return 0;
      }
      return three.includes(code) ? 3 : 2;
    };
    const expectedMultiple = (code: string) => {
      if (three.includes(code)) {
        return 10;
      }
      return code === 'CLP' ? 100 : 1;
    };
    for (const [code, [exponent, multiple, standaloneMultiple]] of Object.entries(CHECKOUT_RULES)) {
      expect(exponent).toBe(expectedExponent(code));
      expect(multiple).toBe(expectedMultiple(code));
      expect(standaloneMultiple).toBe(code === 'CLP' ? 1 : multiple);
    }
    expect(Object.keys(CHECKOUT_RULES)).toHaveLength(145);
  });
});
