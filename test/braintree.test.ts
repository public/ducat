// every ISO 4217 code: this file builds Money from /fn-level modules, which don't register them
import '../src/plugins/iso.js';
import { describe, expect, it } from 'vitest';
import { money, toDecimal, RoundingError, ISO_EXPONENTS } from '../src/fn.js';
import {
  braintreeExponent,
  fromBraintree,
  isBraintreeCurrency,
  toBraintree,
  BRAINTREE_EXPONENTS,
} from '../src/braintree.js';

// the codes marked with an asterisk on the currencies page, copied from the page
const ASTERISKED = 'BIF CLP DJF GNF ISK JPY KMF KRW LAK PYG RWF UGX VND VUV XAF XOF XPF'.split(' ');

describe('Braintree', () => {
  // the transaction.sale example, and 81503 "formatted like '10' or '10.00'"
  it('documented examples: "10.00", and "10" for zero-decimal currencies', () => {
    expect(toBraintree(money('10', 'USD'))).toBe('10.00');
    expect(toDecimal(fromBraintree('10.00', 'USD'))).toBe('10.00');
    expect(toDecimal(fromBraintree('10', 'USD'))).toBe('10.00');
    expect(toBraintree(money('10', 'JPY'))).toBe('10');
  });
  it('zero-decimal currencies follow Braintree, not ISO: LAK takes none', () => {
    expect(braintreeExponent('LAK')).toBe(0);
    expect(ISO_EXPONENTS.LAK).toBe(2);
    expect(toBraintree(money('5000', 'LAK'))).toBe('5000');
    expect(() => toBraintree(money('5000.50', 'LAK'))).toThrow(RoundingError);
    expect(toBraintree(money('5000.50', 'LAK'), { rounding: 'halfEven' })).toBe('5000');
    expect(toDecimal(fromBraintree('5000', 'LAK'))).toBe('5000.00');
    expect(toDecimal(fromBraintree('12.5', 'LAK'))).toBe('12.50');
  });
  it('CLP, ISK and UGX are zero-decimal as in ISO (unlike Adyen and Stripe)', () => {
    expect(toBraintree(money('5000', 'CLP'))).toBe('5000');
    expect(toBraintree(money('5', 'ISK'))).toBe('5');
    expect(toBraintree(money('5', 'UGX'))).toBe('5');
    // a fractional amount read back keeps its precision
    expect(toDecimal(fromBraintree('5.25', 'JPY'))).toBe('5.25');
  });
  it('81531 and 81501: amounts must be greater than zero, credits included', () => {
    expect(() => toBraintree(money('-5', 'USD'))).toThrow(/can't be negative/);
    expect(() => toBraintree(money('0', 'USD'))).toThrow(/greater than zero/);
    // checked after rounding: -0.004 rounds to zero, which is rejected as zero
    expect(() =>
      toBraintree(money('-0.004', 'USD', { scale: 3 }), { rounding: 'halfEven' }),
    ).toThrow(/greater than zero/);
    expect(toBraintree(money('0.01', 'USD'))).toBe('0.01');
    expect(() => fromBraintree('-5.00', 'USD')).toThrow(SyntaxError);
  });
  it('more decimals than Braintree takes need a rounding mode', () => {
    const tooPrecise = money('10.005', 'EUR', { scale: 3 });
    expect(() => toBraintree(tooPrecise)).toThrow(RoundingError);
    expect(toBraintree(tooPrecise, { rounding: 'halfExpand' })).toBe('10.01');
  });
  it('only numbers and one decimal point', () => {
    for (const invalid of ['', '1,00', '1e3', '+1', '1.', '.5', ' 1', '1.0.0']) {
      expect(() => fromBraintree(invalid, 'USD')).toThrow(SyntaxError);
    }
    expect(toDecimal(fromBraintree('123456789012345678.90', 'USD'))).toBe('123456789012345678.90');
  });
  it('unlisted currencies throw', () => {
    expect(isBraintreeCurrency('usd')).toBe(true);
    expect(isBraintreeCurrency('KWD')).toBe(false);
    expect(isBraintreeCurrency('BGN')).toBe(false);
    expect(() => toBraintree(money('1', 'KWD'))).toThrow(/not a Braintree currency/);
    expect(() => fromBraintree('1.000', 'BHD')).toThrow(/not a Braintree currency/);
  });
  it('the table matches the documented list', () => {
    expect(Object.keys(BRAINTREE_EXPONENTS)).toHaveLength(134);

    // exactly the asterisked codes are zero-decimal; the page lists no three-decimal currency
    const zeroDecimal = Object.keys(BRAINTREE_EXPONENTS).filter(
      (code) => BRAINTREE_EXPONENTS[code] === 0,
    );
    expect(zeroDecimal.toSorted()).toEqual(ASTERISKED);
    const others = Object.entries(BRAINTREE_EXPONENTS).filter(
      ([code]) => !ASTERISKED.includes(code),
    );
    for (const [code, exponent] of others) {
      expect([code, exponent]).toEqual([code, 2]);
    }
    expect(braintreeExponent('ZWD')).toBe(2);
  });
});
