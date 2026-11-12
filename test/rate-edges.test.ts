// Boundary and error-path tests for src/rate.ts: dates and instants, expiry at the instant,
// derived timing, metadata without undefined keys, published digits, and the errors users see.
import '../src/plugins/iso.js';
import { describe, expect, it } from 'vitest';
import { fromMinor, money } from '../src/fn.js';
import { roundingPolicy } from '../src/policy.js';
import { exchangeRate, hasEnded, RateExpiredError, toIsoString } from '../src/rate.js';

describe('dates and instants', () => {
  it('keeps a date, normalises an instant, and rejects anything else', () => {
    expect(toIsoString('2026-11-06')).toBe('2026-11-06');
    expect(toIsoString('2026-11-06T16:00:00+01:00')).toBe('2026-11-06T15:00:00.000Z');
    for (const text of ['x2026-11-06', '2026-11-06x', 'nope', '']) {
      expect(() => toIsoString(text)).toThrow(new RangeError(`Invalid date or time ${text}`));
    }
    expect(() => toIsoString(new Date(Number.NaN))).toThrow(RangeError);
  });

  it('an instant validUntil has not ended at that instant', () => {
    const until = '2026-11-06T15:00:00.000Z';
    expect(hasEnded(until, until)).toBe(false);
    expect(hasEnded(until, '2026-11-06T15:00:00.001Z')).toBe(true);
    expect(hasEnded('2026-11-06', '2026-11-06T23:59:59.999Z')).toBe(false);
    expect(hasEnded('2026-11-06', '2026-11-07')).toBe(true);
  });
});

describe('derived rates', () => {
  it('andThen is available once both inputs are', () => {
    const first = exchangeRate('EUR', 'USD', '1.1', { availableAt: '2026-11-06T16:00:00Z' });
    const second = exchangeRate('USD', 'JPY', '150', { availableAt: '2026-11-06T14:00:00Z' });
    expect(first.andThen(second).availableAt).toBe('2026-11-06T16:00:00.000Z');
    expect(second.inverse().andThen(first.inverse()).availableAt).toBe('2026-11-06T16:00:00.000Z');
  });
});

describe('metadata', () => {
  it('a rate has no keys for metadata it was not given', () => {
    expect(Object.keys(exchangeRate('EUR', 'USD', '1.1')).sort()).toEqual(['from', 'ratio', 'to']);
    expect(Object.keys(exchangeRate('EUR', 'USD', '1.1', { source: 'ECB' })).sort()).toEqual([
      'from',
      'ratio',
      'source',
      'to',
    ]);
    expect(Object.keys(exchangeRate('EUR', 'USD', '1.1', { type: 'mid' })).sort()).toEqual([
      'from',
      'ratio',
      'to',
      'type',
    ]);
  });

  it('keeps published digits only when the canonical form would drop them', () => {
    expect(exchangeRate('EUR', 'USD', '1.1650').quote).toEqual({ rate: '1.1650' });
    expect(exchangeRate('EUR', 'USD', '1.165').quote).toBeUndefined();
    expect(exchangeRate('EUR', 'USD', '1.10e10').quote).toBeUndefined();
    expect(exchangeRate('EUR', 'USD', '1.10/3').quote).toBeUndefined();
    const quote = { rate: '136.80', per: 100 };
    expect(exchangeRate('JPY', 'NOK', '1.3680', { quote }).quote).toEqual(quote);
  });
});

describe('conversion beyond 2^53', () => {
  it('a product of safe minor units and a safe numerator past 2^53 is still exact', () => {
    // (2^40 + 1) × 1000001 > 2^53: the float product would round
    const minor = 2n ** 40n + 1n;
    const rate = exchangeRate('EUR', 'USD', '1.000001');
    const exact = (shift: bigint) => {
      const numerator = minor * 1000001n * 10n ** shift;
      const denominator = 10n ** 6n;
      // half-even on a positive quotient
      const quotient = numerator / denominator;
      const twice = 2n * (numerator % denominator);
      return twice > denominator || (twice === denominator && quotient % 2n === 1n)
        ? quotient + 1n
        : quotient;
    };
    const amount = fromMinor(minor, 'EUR');
    expect(String(rate.convert(amount, 'halfEven').minor)).toBe(String(exact(0n)));
    expect(String(rate.convert(amount, 'halfEven', { scale: 4 }).minor)).toBe(String(exact(2n)));
  });
});

describe('errors name the problem', () => {
  it('a non-positive rate', () => {
    for (const rate of ['0', '-1.1']) {
      expect(() => exchangeRate('EUR', 'USD', rate)).toThrow(
        new RangeError('Exchange rate must be positive'),
      );
    }
  });

  it('a quote that is not the rate', () => {
    expect(() => exchangeRate('EUR', 'USD', '1.2', { quote: { rate: '1.3' } })).toThrow(
      new RangeError("Quote 1.3 isn't the rate EUR→USD"),
    );
    expect(exchangeRate('EUR', 'USD', '1.2', { quote: { rate: '1.20' } }).toString()).toBe('1.20');
  });

  it('RateExpiredError has its own name', () => {
    const rate = exchangeRate('EUR', 'USD', '1.1', { validUntil: '2020-01-01' });
    let caught: unknown;
    try {
      rate.convert(money('1', 'EUR'), 'halfEven', { strictValidity: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateExpiredError);
    expect((caught as Error).name).toBe('RateExpiredError');
    expect((caught as Error).message).toBe('Exchange rate EUR→USD expired at 2020-01-01');
  });

  it('a rounding policy brings its own scale', () => {
    const rate = exchangeRate('EUR', 'USD', '1.1');
    expect(() =>
      rate.convert(money('1', 'EUR'), roundingPolicy({ scale: 2 }), { scale: 3 }),
    ).toThrow(new TypeError('options.scale with a rounding policy'));
  });
});
