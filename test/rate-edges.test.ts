// Boundary and error-path tests for src/rate.ts: dates and instants, expiry at the instant,
// derived timing, metadata without undefined keys, published digits, and the errors users see.
import '../src/plugins/iso.js';
import { describe, expect, it } from 'vitest';
import { fromMinor, money } from '../src/fn.js';
import { roundingPolicy } from '../src/policy.js';
import {
  exchangeRate,
  hasEnded,
  rateFromJSON,
  RateExpiredError,
  toIsoString,
} from '../src/rate.js';

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

  // A date validUntil is valid all day (UTC), through 23:59:59.999Z, as hasEnded reads it; an
  // instant through itself. A chain keeps whichever ends first, compared as times.
  it('andThen keeps the validUntil that ends first, a date and an instant compared as times', () => {
    const eurUsd = exchangeRate('EUR', 'USD', '1.10', { validUntil: '2026-11-06' });
    const usdJpy = exchangeRate('USD', 'JPY', '150', { validUntil: '2026-11-06T15:00:00Z' });
    const jpyKrw = exchangeRate('JPY', 'KRW', '9', { validUntil: '2026-11-06' });
    const eurJpy = eurUsd.andThen(usdJpy);
    expect(eurJpy.validUntil).toBe('2026-11-06T15:00:00.000Z');
    expect(usdJpy.andThen(jpyKrw).validUntil).toBe('2026-11-06T15:00:00.000Z');
    // the composite expires with its leg
    expect(usdJpy.isExpired('2026-11-06T16:00:00Z')).toBe(true);
    expect(eurJpy.isExpired('2026-11-06T16:00:00Z')).toBe(true);
  });

  it('a date validUntil ends 1 ms before an instant at the next midnight, and ties 23:59:59.999Z', () => {
    const day = exchangeRate('EUR', 'USD', '1.10', { validUntil: '2026-11-06' });
    // the date has ended at 00:00:00.000Z on the 7th; the instant hasn't, so the date is earlier
    const midnight = exchangeRate('USD', 'JPY', '150', { validUntil: '2026-11-07T00:00:00Z' });
    expect(hasEnded('2026-11-06', '2026-11-07T00:00:00Z')).toBe(true);
    expect(hasEnded('2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00Z')).toBe(false);
    expect(day.andThen(midnight).validUntil).toBe('2026-11-06');
    expect(midnight.inverse().andThen(day.inverse()).validUntil).toBe('2026-11-06');
    // the date's last valid instant is a tie, which keeps the instant form
    const last = exchangeRate('USD', 'JPY', '150', { validUntil: '2026-11-06T23:59:59.999Z' });
    expect(day.andThen(last).validUntil).toBe('2026-11-06T23:59:59.999Z');
    expect(last.inverse().andThen(day.inverse()).validUntil).toBe('2026-11-06T23:59:59.999Z');
  });

  it('asOf and availableAt still read a date as the start of its day', () => {
    const dated = exchangeRate('EUR', 'USD', '1.10', {
      asOf: '2026-11-06',
      availableAt: '2026-11-06',
    });
    const timed = exchangeRate('USD', 'JPY', '150', {
      asOf: '2026-11-06T15:00:00Z',
      availableAt: '2026-11-06T09:00:00Z',
    });
    for (const chained of [dated.andThen(timed), timed.inverse().andThen(dated.inverse())]) {
      expect(chained.asOf).toBe('2026-11-06');
      expect(chained.availableAt).toBe('2026-11-06T09:00:00.000Z');
    }
  });
});

describe('metadata', () => {
  // A quote must describe its rate exactly, or the inverse (which flips `inverted`) would print a
  // number that isn't the rate.
  it('refuses a quote whose rate or per is not positive, whatever the signs', () => {
    // -136.80 per -100 would describe 1.368, but a quote is a positive price per positive units
    const both = { quote: { rate: '-136.80', per: -100 } };
    expect(() => exchangeRate('JPY', 'NOK', '1.368', both)).toThrow(
      new RangeError("Quote -136.80 isn't a positive rate"),
    );
    expect(() => rateFromJSON({ from: 'JPY', to: 'NOK', rate: '1.368', ...both })).toThrow(
      RangeError,
    );
    expect(() => exchangeRate('EUR', 'USD', '1', { quote: { rate: '0', inverted: true } })).toThrow(
      new RangeError("Quote 0 isn't a positive rate"),
    );
    expect(() => exchangeRate('EUR', 'USD', '1', { quote: { rate: '-1' } })).toThrow(RangeError);
    const fractional = { quote: { rate: '136.80', per: 1.5 } };
    expect(() => exchangeRate('JPY', 'NOK', '91.2', fractional)).toThrow(
      new RangeError("A quote's per is a positive integer, got 1.5"),
    );
    expect(() =>
      exchangeRate('JPY', 'NOK', '-1.368', { quote: { rate: '136.80', per: -100 } }),
    ).toThrow(RangeError);
  });

  it('refuses an inverted or scaled quote that is not the rate, so inverse() cannot fail', () => {
    const wrong = { quote: { rate: '0.9100', inverted: true } } as const;
    expect(() => exchangeRate('EUR', 'USD', '290', wrong)).toThrow(
      new RangeError("Quote 0.9100 isn't the rate EUR→USD"),
    );
    expect(() => rateFromJSON({ from: 'EUR', to: 'USD', rate: '290', ...wrong })).toThrow(
      RangeError,
    );
    const cad = exchangeRate('CAD', 'USD', '200/273', {
      quote: { rate: '1.3650', inverted: true },
    });
    expect(cad.inverse().toString()).toBe('1.3650');
    expect(rateFromJSON(cad.toJSON()).inverse().toString()).toBe('1.3650');
    // NOK per 100 JPY: 136.80 / 100
    const per = { rate: '136.80', per: 100 };
    expect(exchangeRate('JPY', 'NOK', '1.368', { quote: per }).toString()).toBe('1.368');
    expect(() => exchangeRate('JPY', 'NOK', '136.80', { quote: per })).toThrow(RangeError);
    // inverted and per together: JPY per 100 NOK is 100 / 6.50 NOK→JPY
    const both = { quote: { rate: '6.50', per: 100, inverted: true } };
    expect(exchangeRate('NOK', 'JPY', '200/13', both).inverse().toString()).toBe('0.065');
    expect(() => exchangeRate('NOK', 'JPY', '6.50', both)).toThrow(RangeError);
  });

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
