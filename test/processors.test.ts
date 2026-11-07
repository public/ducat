import { describe, expect, it } from 'vitest';
import { fromMinor, money, toDecimal, RoundingError, ISO_EXPONENTS } from '../src/index.js';
import { fromStripe, stripeExponent, toStripe, toStripeAmount, STRIPE_RULES } from '../src/stripe.js';
import { adyenExponent, fromAdyen, toAdyen, ADYEN_EXPONENTS } from '../src/adyen.js';

describe('Stripe', () => {
  it('standard and zero-decimal currencies', () => {
    expect(toStripe(money('10.99', 'USD'))).toEqual({ amount: 1099, currency: 'usd' });
    expect(toStripeAmount(money('1000', 'JPY'))).toBe(1000);
    expect(toStripeAmount(money('50000', 'KRW'))).toBe(50000);
    expect(toStripeAmount(money('100000', 'VND'))).toBe(100000);
    expect(toStripeAmount(money('5000', 'CLP'))).toBe(5000);
  });
  it('ISK and UGX: two-decimal values ending in 00', () => {
    expect(toStripeAmount(money('5', 'ISK'))).toBe(500);
    expect(toDecimal(fromStripe(500, 'isk'))).toBe('5');
    expect(toStripeAmount(money('5', 'UGX'))).toBe(500);
    // a fractional ISK from Stripe keeps its precision rather than being rounded away
    expect(fromStripe(1234, 'isk').scale).toBe(2);
  });
  it('MGA is zero-decimal on Stripe although ISO says 2', () => {
    expect(ISO_EXPONENTS.MGA).toBe(2);
    expect(stripeExponent('MGA')).toBe(0);
    expect(toStripeAmount(money('100', 'MGA'))).toBe(100);
    expect(() => toStripeAmount(money('100.50', 'MGA'))).toThrow(RoundingError);
    expect(toStripeAmount(money('100.50', 'MGA'), { rounding: 'halfEven' })).toBe(100);
  });
  it('HUF/TWD: payouts must be whole units', () => {
    expect(toStripeAmount(money('10.45', 'HUF'))).toBe(1045);
    expect(() => toStripeAmount(money('10.45', 'HUF'), { payout: true })).toThrow(/multiple of 100/);
    expect(toStripeAmount(money('10.45', 'HUF'), { payout: true, rounding: 'floor' })).toBe(1000);
    expect(toStripeAmount(money('800.45', 'TWD'), { payout: true, rounding: 'floor' })).toBe(80000);
  });
  it('three-decimal currencies: last digit must be 0', () => {
    expect(toStripeAmount(money('5.120', 'KWD'))).toBe(5120);
    expect(() => toStripeAmount(money('5.124', 'KWD'))).toThrow(RoundingError);
    expect(toStripeAmount(money('5.124', 'KWD'), { rounding: 'halfEven' })).toBe(5120);
    expect(toStripeAmount(money('5.125', 'KWD'), { rounding: 'halfExpand' })).toBe(5130);
  });
  it('unsupported currencies throw', () => {
    expect(() => toStripeAmount(money('1', 'IRR'))).toThrow(/not a Stripe/);
  });
  it('every Stripe rule is consistent', () => {
    for (const [code, [e, c, p]] of Object.entries(STRIPE_RULES)) {
      expect([0, 2, 3]).toContain(e);
      expect(c === 1 || c === 10 || c === 100).toBe(true);
      expect(p % c).toBe(0);
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });
});

describe('Adyen', () => {
  it('exponent differences from ISO: CLP, ISK (2), IDR, CVE (0)', () => {
    expect(toAdyen(money('5000', 'CLP'))).toEqual({ value: 500000, currency: 'CLP' });
    expect(toAdyen(money('5', 'ISK')).value).toBe(500);
    expect(toAdyen(money('15000', 'IDR')).value).toBe(15000);
    expect(() => toAdyen(money('15000.50', 'IDR'))).toThrow(RoundingError);
    expect(toAdyen(money('15000.50', 'IDR'), 'halfEven').value).toBe(15000);
    expect(toAdyen(money('100', 'CVE')).value).toBe(100);
    expect(toDecimal(fromAdyen({ value: 500000, currency: 'CLP' }))).toBe('5000');
    expect(toDecimal(fromAdyen({ value: 15000, currency: 'IDR' }))).toBe('15000.00');
  });
  it('agrees with ISO except for the documented exceptions', () => {
    const diff = Object.entries(ADYEN_EXPONENTS).filter(([c, e]) => c in ISO_EXPONENTS && ISO_EXPONENTS[c as keyof typeof ISO_EXPONENTS] !== e).map(([c]) => c);
    expect(diff.sort()).toEqual(['CLP', 'CVE', 'IDR', 'ISK']);
    expect(adyenExponent('KWD')).toBe(3);
  });
  it('same amount, different wire values', () => {
    const rows = (['USD', 'JPY', 'ISK', 'IDR', 'CLP', 'KWD'] as const).map((c) => {
      const m = fromMinor(10 ** (ISO_EXPONENTS[c] + 3), c); // 1000 major units
      return [c, toStripeAmount(m), toAdyen(m).value];
    });
    expect(rows).toEqual([
      ['USD', 100000, 100000],
      ['JPY', 1000, 1000],
      ['ISK', 100000, 100000],
      ['IDR', 100000, 1000],
      ['CLP', 1000, 100000],
      ['KWD', 1000000, 1000000],
    ]);
  });
});
