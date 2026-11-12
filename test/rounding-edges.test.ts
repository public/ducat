// divideAndRound and divideSafeByRatio at the edges of the safe-integer range, checked against
// the proved bigint kernel: the float quotient must be exact there, so if the number path's guards
// are ever widened, these cases recheck the claim.
import { describe, expect, it } from 'vitest';
import { ratio } from '../src/decimal.js';
import { divideAndRound, divideAndRoundBigint, divideSafeByRatio } from '../src/rounding.js';
import { MODES } from './oracle.js';

const MAX = Number.MAX_SAFE_INTEGER;
const MAXN = BigInt(MAX);
const P52 = 2 ** 52;

/** the kernel's answer, or the error class it throws */
const viaKernel = (dividend: number, divisor: number, mode: (typeof MODES)[number]) => {
  try {
    return Number(divideAndRoundBigint(BigInt(dividend), BigInt(divisor), mode));
  } catch (error) {
    return (error as Error).name;
  }
};
const viaNumber = (dividend: number, divisor: number, mode: (typeof MODES)[number]) => {
  try {
    return divideAndRound(dividend, divisor, mode);
  } catch (error) {
    return (error as Error).name;
  }
};

const DIVISORS = [1, 2, 3, 7, 10, 100, 10 ** 15, P52 - 1, P52, P52 + 1, MAX - 1, MAX];

/** dividends where the quotient is largest, or the remainder is one away from 0 or the divisor */
const dividendsFor = (divisor: number): number[] => {
  const top = Math.floor(MAX / divisor) * divisor; // the largest safe multiple
  const atGuard = MAX - divisor; // |dividend| + divisor = 2^53 - 1
  const candidates = [MAX, MAX - 1, top, top - 1, top + 1, atGuard, atGuard - 1, atGuard + 1];
  for (const half of [Math.floor(divisor / 2), Math.ceil(divisor / 2)]) {
    candidates.push(top - divisor + half, atGuard - half);
  }
  return candidates.filter((d) => Number.isSafeInteger(d) && d >= 0).flatMap((d) => [d, -d]);
};

describe('divideAndRound at the top of the safe range', () => {
  it('matches the bigint kernel in every mode', () => {
    for (const divisor of DIVISORS) {
      for (const dividend of dividendsFor(divisor)) {
        for (const mode of MODES) {
          const expected = viaKernel(dividend, divisor, mode);
          expect([dividend, divisor, mode, viaNumber(dividend, divisor, mode)]).toEqual([
            dividend,
            divisor,
            mode,
            expected,
          ]);
        }
      }
    }
  });

  it('never returns -0', () => {
    for (const mode of ['trunc', 'ceil', 'halfExpand', 'halfEven'] as const) {
      expect(Object.is(divideAndRound(-1, 3, mode), 0)).toBe(true);
      expect(Object.is(divideAndRound(-0, 1, mode), 0)).toBe(true);
      expect(Object.is(divideAndRound(-0, 7, mode), 0)).toBe(true);
    }
  });
});

describe('divideSafeByRatio', () => {
  it('gives the kernel quotient on the number path, up to |value × denominator| = 2^53 - 1', () => {
    // value / (n/d) = value·d / n
    const cases: Array<[number, string, number, number]> = [
      [MAX, '1', MAX, 1],
      [-MAX, '1', -MAX, 1],
      [MAX, '3', MAX, 3],
      [MAX, '-3', -MAX, 3],
      [MAX, '1/2', MAX * 2, 1], // value·d beyond 2^53: not the number path
      [(MAX - 1) / 2, '1/2', MAX - 1, 1],
      [-(MAX - 1) / 2, '-7/2', MAX - 1, 7],
    ];
    for (const [value, divisor, dividend, positiveDivisor] of cases) {
      const result = divideSafeByRatio(value, ratio(divisor), 'halfEven');
      if (Number.isSafeInteger(dividend)) {
        expect([value, divisor, result]).toEqual([
          value,
          divisor,
          viaKernel(dividend, positiveDivisor, 'halfEven'),
        ]);
      } else {
        expect([value, divisor, result]).toEqual([value, divisor, NaN]);
      }
    }
  });

  it('returns NaN, for the bigint path, exactly when a part or the product is not safe', () => {
    expect(divideSafeByRatio(MAX, ratio(MAX), 'trunc')).toBe(1);
    expect(divideSafeByRatio(-MAX, ratio(1), 'trunc')).toBe(-MAX);
    expect(divideSafeByRatio(MAX, ratio(1n, 2n), 'trunc')).toBeNaN();
    expect(divideSafeByRatio(-MAX, ratio(1n, 2n), 'trunc')).toBeNaN();
    expect(divideSafeByRatio(1, ratio(2n ** 53n), 'trunc')).toBeNaN();
    expect(divideSafeByRatio(1, ratio(1n, 2n ** 53n), 'trunc')).toBeNaN();
    expect(divideSafeByRatio(1, ratio(1n, MAXN), 'trunc')).toBe(MAX);
    expect(divideSafeByRatio(-1, ratio(1n, MAXN), 'trunc')).toBe(-MAX);
  });
});
