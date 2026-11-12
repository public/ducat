// Boundary tests for the float-quotient paths that have no correction step. Each takes a double
// quotient of two non-negative safe integers a / b (or the sign-symmetric truncation) as the exact
// integer quotient, which holds while a + b <= 2^53 - 1: rounding up to the next integer k + 1
// would need (k + 1) * b >= 2^53, but (k + 1) * b <= a + b. The tests sit on each path's guard of
// that bound, its neighbours on either side, and the largest quotients inside it, and check every
// result against a bigint computation. A change to a guard that breaks the bound fails here.
import '../src/plugins/all.js';
import { describe, expect, it } from 'vitest';
import { divideAndRoundBigint } from '../src/generated/kernel.js';
import { allocate, fromMinor, type RoundingMode } from '../src/fn.js';
import { formatScaled } from '../src/decimal.js';
import { divideAndRound, RoundingError } from '../src/rounding.js';

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

describe('divideAndRound at |dividend| + divisor = 2^53 - 1', () => {
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
