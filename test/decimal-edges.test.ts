// Boundary and error-path tests for src/decimal.ts: the safe-integer edge of a Ratio's `n` and `d`
// and of normalizeMinor, mixed-type ratio(a, b), hand-made ratios, Fixed lookalikes and the
// factor errors.
import { describe, expect, it } from 'vitest';
import { normalizeMinor, ratio, type Ratio } from '../src/decimal.js';

const MAX = Number.MAX_SAFE_INTEGER;
const MAXN = BigInt(MAX);
const parts = (r: Ratio) => [r.num, r.den, r.n, r.d];

describe('the safe-integer edge', () => {
  it('normalizeMinor gives a number exactly from -(2^53 - 1) to 2^53 - 1', () => {
    expect(normalizeMinor(MAXN)).toBe(MAX);
    expect(normalizeMinor(-MAXN)).toBe(-MAX);
    expect(normalizeMinor(MAXN + 1n)).toBe(MAXN + 1n);
    expect(normalizeMinor(-MAXN - 1n)).toBe(-MAXN - 1n);
  });

  it("a Ratio's n and d are the parts as numbers while safe, NaN beyond", () => {
    expect(parts(ratio(MAXN))).toEqual([MAXN, 1n, MAX, 1]);
    expect(parts(ratio(-MAXN))).toEqual([-MAXN, 1n, -MAX, 1]);
    expect(parts(ratio(MAXN + 1n))).toEqual([MAXN + 1n, 1n, NaN, 1]);
    expect(parts(ratio(-MAXN - 1n))).toEqual([-MAXN - 1n, 1n, NaN, 1]);
    expect(parts(ratio(1n, MAXN))).toEqual([1n, MAXN, 1, MAX]);
    expect(parts(ratio(1n, MAXN + 2n))).toEqual([1n, MAXN + 2n, 1, NaN]);
  });
});

describe('ratio(a, b)', () => {
  it('mixes bigints with numbers and strings', () => {
    expect(parts(ratio(1n, 2))).toEqual([1n, 2n, 1, 2]);
    expect(parts(ratio(3, 4n))).toEqual([3n, 4n, 3, 4]);
    expect(parts(ratio(1n, '2'))).toEqual([1n, 2n, 1, 2]);
    expect(parts(ratio('1.5', 3n))).toEqual([1n, 2n, 1, 2]);
    expect(parts(ratio(6n, -4n))).toEqual([-3n, 2n, -3, 2]);
  });

  it('rebuilds a hand-made { num, den }: reduced, with n and d', () => {
    expect(parts(ratio({ num: 2n, den: 4n } as Ratio))).toEqual([1n, 2n, 1, 2]);
    expect(parts(ratio({ num: 3n, den: -6n } as Ratio))).toEqual([-1n, 2n, -1, 2]);
    // a ratio from ratio() passes through as it is
    const built = ratio(3, 4);
    expect(ratio(built)).toBe(built);
  });

  it('rejects objects that are neither a Ratio nor a Fixed', () => {
    const notAFactor = /Expected a number, bigint, decimal string, Ratio or Fixed/;
    for (const value of [
      { num: 1n, den: 2 },
      { num: 1, den: 2n },
      { value: 1n, scale: 1001 },
      { value: 1n, scale: -1 },
      { value: 1n, scale: '2' },
      { value: 1.5, scale: 2 },
      null,
    ]) {
      expect(() => ratio(value as never)).toThrow(notAFactor);
    }
    // a Fixed lookalike at the largest scale is read exactly
    expect(ratio({ value: 15n, scale: 1000 } as never).den).toBe(2n * 10n ** 999n);
    expect(parts(ratio({ value: 15, scale: 1 } as never))).toEqual([3n, 2n, 3, 2]);
  });

  it('rejects non-finite numbers and malformed fractions', () => {
    for (const value of [Infinity, -Infinity, NaN]) {
      expect(() => ratio(value)).toThrow(new RangeError(`Invalid factor ${value}`));
    }
    expect(() => ratio('/2')).toThrow(new SyntaxError('Invalid decimal string "/2"'));
  });
});
