// Boundary and error-path tests for src/exact.ts: sums whose float parts would overflow, −0,
// comparisons at equality, equality across denominators, the rounding of toNumber beyond 2^53,
// and the errors users see.
import '../src/plugins/iso.js';
import { describe, expect, it } from 'vitest';
import { exact, sumExact, type ExactMoney } from '../src/exact.js';
import { CurrencyMismatchError, fromMinor, money } from '../src/fn.js';

const MAX = Number.MAX_SAFE_INTEGER;
const parts = (value: ExactMoney) => [String(value.num), String(value.den)];
const yen = (minor: number | bigint) => exact(fromMinor(minor, 'JPY'));

describe('add', () => {
  it('a same-denominator sum past 2^53 is exact', () => {
    expect(parts(yen(MAX).add(yen(1)))).toEqual([String(2n ** 53n), '1']);
    expect(parts(yen(-MAX).add(yen(-1)))).toEqual([String(-(2n ** 53n)), '1']);
  });

  it('cross products past 2^53 are not trusted, even when their sum would be safe', () => {
    // a/2 − a/3 = a/6, with 3a and 2a beyond 2^53 for a = 2^52 + 1
    const a = 2 ** 52 + 1;
    const half = yen(a).divide(2);
    const third = yen(a).divide(3);
    expect(parts(half.subtract(third))).toEqual([String(a), '6']);
    expect(parts(half.add(third.negate()))).toEqual([String(a), '6']);
  });
});

describe('zero has no sign', () => {
  it('negating zero gives +0', () => {
    const zero = exact(money('0', 'EUR'));
    expect(Object.is(zero.negate().toNumber(), 0)).toBe(true);
    expect(Object.is(zero.multiply(-5).toNumber(), 0)).toBe(true);
  });
});

describe('comparisons', () => {
  const half = exact(money('1', 'EUR')).divide(2);
  const halfAgain = exact(money('0.50', 'EUR'));
  const third = exact(money('1', 'EUR')).divide(3);

  it('at equality and either side of it', () => {
    expect([half.lessThan(halfAgain), half.lessThanOrEqual(halfAgain)]).toEqual([false, true]);
    expect([half.greaterThan(halfAgain), half.greaterThanOrEqual(halfAgain)]).toEqual([
      false,
      true,
    ]);
    expect([third.lessThan(half), third.lessThanOrEqual(half)]).toEqual([true, true]);
    expect([third.greaterThan(half), third.greaterThanOrEqual(half)]).toEqual([false, false]);
    expect([half.lessThan(third), half.lessThanOrEqual(third)]).toEqual([false, false]);
    expect([half.greaterThan(third), half.greaterThanOrEqual(third)]).toEqual([true, true]);
  });

  it('close fractions whose cross products pass 2^53 compare exactly', () => {
    // a/7 and b/11 differ by 1/77: a × 11 − b × 7 = 1, but both products round to the same double
    const left = yen(5731854068998871).divide(7);
    const right = yen(9007199251283940).divide(11);
    expect([left.compare(right), right.compare(left)]).toEqual([1, -1]);
    expect([left.greaterThan(right), left.equals(right)]).toEqual([true, false]);
  });

  it('equals compares numerator and denominator', () => {
    expect(half.equals(halfAgain)).toBe(true);
    // 1/2 and 1/3: the same numerator, another value
    expect(half.equals(third)).toBe(false);
    expect(half.equals(exact(money('0.50', 'USD')))).toBe(false);
  });

  it('min and max keep the first of equal values; clamp takes lo = hi', () => {
    expect(half.min(halfAgain)).toBe(half);
    expect(halfAgain.min(half)).toBe(halfAgain);
    expect(half.max(halfAgain)).toBe(half);
    expect(third.clamp(half, halfAgain).equals(half)).toBe(true);
    expect(() => third.clamp(halfAgain, third)).toThrow(new RangeError('clamp: lo > hi'));
  });
});

describe('toNumber beyond 2^53', () => {
  // (2^53 + 1) × 2^11 lies exactly halfway between two doubles near 2^64
  const tie = (2n ** 53n + 1n) * 2n ** 11n;

  it('an exact tie rounds to even', () => {
    expect(yen(tie).toNumber()).toBe(2 ** 64);
  });

  it('a value just above the tie rounds up', () => {
    expect(
      yen(3n * tie + 1n)
        .divide(3)
        .toNumber(),
    ).toBe(2 ** 64 + 2 ** 12);
    expect(
      yen(-(3n * tie + 1n))
        .divide(3)
        .toNumber(),
    ).toBe(-(2 ** 64 + 2 ** 12));
  });
});

describe('errors name the problem', () => {
  it('division by zero, and ratioOf across currencies', () => {
    expect(() => yen(1).divide(0)).toThrow(new RangeError('Division by zero'));
    expect(() => exact(money('1', 'EUR')).ratioOf(money('1', 'USD') as never)).toThrow(
      CurrencyMismatchError,
    );
  });

  it('ExactMoney refuses JSON and numbers, saying to round first', () => {
    const third = exact(money('1', 'EUR')).divide(3);
    expect(() => JSON.stringify(third)).toThrow(
      new TypeError('ExactMoney has no JSON form; round() it to Money first'),
    );
    expect(() => +third).toThrow(
      new TypeError('ExactMoney cannot be converted to a number; round() it first'),
    );
    expect(`${third}`).toBe('1/3 EUR');
  });

  it('sumExact of an empty list needs a currency', () => {
    expect(() => sumExact([])).toThrow(
      new RangeError('sumExact of an empty list needs a currency'),
    );
    expect(sumExact([], 'EUR').isZero()).toBe(true);
  });
});
