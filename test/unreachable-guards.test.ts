// Boundary tests for the float-quotient paths that have no correction step. Each takes a double
// quotient of two non-negative safe integers a / b (or the sign-symmetric truncation) as the exact
// integer quotient. That holds for every safe a and b >= 1: rounding up to the next integer k + 1
// would need P = (k + 1) * b with P - a <= P * 2^-53 and P - a >= 1, so P = 2^53, where k + 1 and
// b are powers of two and the quotient is exact. The paths below also keep a + b <= 2^53 - 1
// (divideAndRound no longer does). The tests sit on each guard, its neighbours on either side, the
// largest quotients inside it, and (for divideAndRound) the top of the safe range, and check every
// result against a bigint computation.
import '../src/plugins/all.js';
import { describe, expect, it } from 'vitest';
import { divideAndRoundBigint } from '../src/generated/kernel.js';
import { allocate, fromMinor, type RoundingMode } from '../src/fn.js';
import { formatScaled } from '../src/decimal.js';
import { divideAndRound, RoundingError } from '../src/rounding.js';
import { fixed, fromScaled } from '../src/fixed.js';

const MAX = Number.MAX_SAFE_INTEGER;

const MODES: RoundingMode[] = [
  'halfEven',
  'halfExpand',
  'halfTrunc',
  'halfCeil',
  'halfFloor',
  'expand',
  'trunc',
  'ceil',
  'floor',
];

/** Non-negative dividends on and around the bound a + b <= MAX for divisor b. */
function dividendsAtBound(b: number): number[] {
  const atBound = MAX - b;
  // the largest multiple of b inside the bound, and its neighbours
  const multiple = Math.floor(atBound / b) * b;
  return [atBound, atBound - 1, atBound + 1, multiple - 1, multiple, multiple + 1, b - 1, b, b + 1]
    .filter((a) => a >= 0 && a <= MAX)
    .filter((a, i, all) => all.indexOf(a) === i);
}

const DIVISORS = [
  1,
  2,
  3,
  7,
  10,
  100,
  2 ** 26 + 1,
  10 ** 15,
  2 ** 52 - 1,
  2 ** 52,
  2 ** 52 + 1,
  MAX - 1,
  MAX,
];

describe('divideAndRound around |dividend| + divisor = 2^53 - 1, its former bigint bound', () => {
  it('matches the bigint kernel on, inside and beyond the bound, for both signs', () => {
    for (const b of DIVISORS) {
      for (const magnitude of dividendsAtBound(b)) {
        for (const a of [magnitude, -magnitude]) {
          for (const mode of MODES) {
            const expected = Number(divideAndRoundBigint(BigInt(a), BigInt(b), mode));
            expect([a, b, mode, divideAndRound(a, b, mode)]).toEqual([a, b, mode, expected]);
          }
          const isExact = BigInt(a) % BigInt(b) === 0n;
          if (isExact) {
            expect(divideAndRound(a, b, 'unnecessary')).toBe(Number(BigInt(a) / BigInt(b)));
          } else {
            expect(() => divideAndRound(a, b, 'unnecessary')).toThrow(RoundingError);
          }
        }
      }
    }
  });

  it('never returns -0', () => {
    expect(Object.is(divideAndRound(-1, 3, 'trunc'), 0)).toBe(true);
    expect(Object.is(divideAndRound(-(MAX - 3), MAX - 2, 'ceil'), 0)).toBe(true);
  });
});

describe('divideAndRound at the top of the safe range, with no bigint fallback', () => {
  // every power of two and its neighbours (P = 2^53 is the only case the argument has to rule
  // out), and the divisors above
  const divisors = new Set(DIVISORS);
  for (let m = 1; m <= 53; m++) {
    for (const b of [2 ** m - 1, 2 ** m, 2 ** m + 1]) {
      if (b <= MAX) {
        divisors.add(b);
      }
    }
  }

  it('matches the bigint kernel for dividends up to 2^53 - 1, both signs, every mode', () => {
    for (const b of divisors) {
      const top = Math.floor(MAX / b) * b;
      const dividends = [MAX, MAX - 1, MAX - 2, top, top - 1, top + 1].filter((a) => a <= MAX);
      for (const magnitude of dividends) {
        for (const a of [magnitude, -magnitude]) {
          for (const mode of MODES) {
            const expected = Number(divideAndRoundBigint(BigInt(a), BigInt(b), mode));
            expect([a, b, mode, divideAndRound(a, b, mode)]).toEqual([a, b, mode, expected]);
          }
        }
      }
    }
  });
});

describe("divideAndRound's generated switch where 2|remainder| leaves the safe range, and at ties", () => {
  /** Every mode against the proved kernel, for a and -a. */
  const expectKernel = (magnitude: number, b: number) => {
    for (const a of [magnitude, -magnitude]) {
      for (const mode of MODES) {
        const expected = Number(divideAndRoundBigint(BigInt(a), BigInt(b), mode));
        expect([a, b, mode, divideAndRound(a, b, mode)]).toEqual([a, b, mode, expected]);
      }
    }
  };

  it('2|r| > 2^53 - 1 (only with a quotient of 0): exact, and never a tie', () => {
    for (const b of [2 ** 52 + 1, 2 ** 52 + 2, 2 ** 53 - 2, MAX]) {
      // the region the proof's second case covers: |a| < b, so the quotient is 0 and r = a
      for (const magnitude of [2 ** 52, 2 ** 52 + 1, b - 1].filter((m) => m < b)) {
        expect(2 * magnitude > MAX).toBe(true);
        expectKernel(magnitude, b);
      }
    }
  });

  it('ties and near-ties, on inputs the old |a| + b bound sent to the bigint kernel', () => {
    let ties = 0;
    // b even: r = b / 2 is a tie; with quotient 0 (even) and 1 (odd), and r = b / 2 +- 1
    for (const b of [2 ** 53 - 2, 2 ** 52 + 2, 2 ** 52 + 6]) {
      for (const q of [0, 1]) {
        for (const r of [b / 2 - 1, b / 2, b / 2 + 1]) {
          const magnitude = q * b + r;
          if (magnitude <= MAX) {
            ties += 2 * r === b ? 1 : 0;
            expectKernel(magnitude, b);
          }
        }
      }
    }
    // every even b has a tie at quotient 0, and 2^52 + 2 and 2^52 + 6 at quotient 1 too
    expect(ties).toBe(5);
    // b odd: no exact tie; r = (b - 1) / 2 and (b + 1) / 2 sit either side of it
    for (const b of [MAX, 2 ** 52 + 1, 2 ** 52 + 3]) {
      for (const q of [0, 1]) {
        for (const r of [(b - 1) / 2, (b + 1) / 2]) {
          const magnitude = q * b + r;
          if (magnitude <= MAX) {
            expectKernel(magnitude, b);
          }
        }
      }
    }
  });
});

describe("allocate's number path at minor * max weight = 2^53 - 1 - total", () => {
  const WEIGHT_SETS = [
    [1],
    [1, 1, 1],
    [1, 2],
    [7, 3, 5],
    [1, 2 ** 20],
    [0, 3, 0, 1],
    [2 ** 30, 1, 2 ** 30],
  ];
  // The bigint weights take allocate's bigint path, which is the reference here.
  const reference = (minor: number, weights: number[]) =>
    allocate(fromMinor(minor, 'EUR'), weights.map(BigInt)).map((part) => part.minor);

  it('matches the bigint path on, inside and beyond the bound, for both signs', () => {
    for (const weights of WEIGHT_SETS) {
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const maxWeight = Math.max(...weights);
      const atBound = Math.floor((MAX - total) / maxWeight);
      for (const magnitude of [atBound, atBound - 1, atBound + 1, total - 1, total, total + 1]) {
        for (const minor of [magnitude, -magnitude]) {
          const parts = allocate(fromMinor(minor, 'EUR'), weights).map((part) => part.minor);
          expect([weights, minor, parts]).toEqual([weights, minor, reference(minor, weights)]);
        }
      }
    }
  });
});

describe('formatScaled at magnitude + 10^scale = 2^53 - 1', () => {
  it('matches the string path (bigint input) on, inside and beyond the bound', () => {
    for (let scale = 1; scale <= 15; scale++) {
      for (const magnitude of dividendsAtBound(10 ** scale)) {
        for (const minor of [magnitude, -magnitude]) {
          expect([scale, minor, formatScaled(minor, scale)]).toEqual([
            scale,
            minor,
            formatScaled(BigInt(minor), scale),
          ]);
        }
      }
    }
  });
});

describe("fixed()'s scale limit, which parseDecimal enforces", () => {
  // fixed() relies on parseDecimal (MAX_DECIMAL_SCALE) for its own limit of 1000 decimal places
  const fraction = (digits: number) => `0.${'0'.repeat(digits - 1)}1`;

  it('accepts 1000 decimal places and refuses 1001, written out or through an exponent', () => {
    expect(fixed(fraction(1000)).scale).toBe(1000);
    expect(fixed('1e-1000').scale).toBe(1000);
    expect(fixed(`-${fraction(1000)}`).toString()).toBe(`-${fraction(1000)}`);
    expect(() => fixed(fraction(1001))).toThrow(RangeError);
    expect(() => fixed('0.5e-1000')).toThrow(RangeError);
    expect(() => fixed('1e-1001')).toThrow(RangeError);
  });
});

describe("Fixed's constructor is the one place -0 becomes 0", () => {
  const isNegativeZero = (value: number | bigint) => Object.is(value, -0);

  it('normalises -0 from every number path that used to add its own + 0', () => {
    expect(isNegativeZero(fixed(-0).toScaled().value)).toBe(false);
    expect(isNegativeZero(fixed(-0, { scale: 2 }).toScaled().value)).toBe(false);
    expect(isNegativeZero(fromScaled(-0, 3).toScaled().value)).toBe(false);
    expect(isNegativeZero(fixed('0').multiply(-1).toScaled().value)).toBe(false);
    expect(isNegativeZero(fixed('0.00').multiply(-5).toScaled().value)).toBe(false);
    expect(isNegativeZero(fixed('-0').add(fixed('0')).toScaled().value)).toBe(false);
    expect(isNegativeZero(fixed('0').subtract(fixed('0')).toScaled().value)).toBe(false);
  });
});
