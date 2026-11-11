import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ratio, type Ratio } from '../src/decimal.js';
import { fixed } from '../src/fixed.js';
import {
  ratioAdd,
  ratioCompare,
  ratioComplement,
  ratioDivide,
  ratioMultiply,
  ratioNegate,
  ratioSubtract,
} from '../src/math.js';
import { runs } from './fc-config.js';

// The oracle: plain bigint rationals, reduced here with their own gcd.
type Q = readonly [bigint, bigint];
const abs = (value: bigint) => (value < 0n ? -value : value);
const gcd = (left: bigint, right: bigint): bigint =>
  right === 0n ? abs(left) : gcd(right, left % right);
function reduce([num, den]: Q): Q {
  const sign = den < 0n ? -1n : 1n;
  const divisor = gcd(num, den) || 1n;
  return [(sign * num) / divisor, (sign * den) / divisor];
}
const safeOrNaN = (value: bigint) =>
  abs(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : NaN;
const same = (value: Ratio, fraction: Q) => {
  const [num, den] = reduce(fraction);
  return (
    value.num === num &&
    value.den === den &&
    Object.is(value.n, safeOrNaN(num)) &&
    Object.is(value.d, safeOrNaN(den))
  );
};
const rational = fc
  .tuple(
    fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
    fc.bigInt({ min: 1n, max: 10n ** 30n }),
  )
  .map(([num, den]) => [num, den] as Q);
const asRatio = ([num, den]: Q) => ratio(num, den);

describe('Ratio arithmetic', () => {
  it('composes rates without strings', () => {
    expect(ratioComplement(ratio(15, 100))).toEqual(ratio(17, 20));
    expect(ratioAdd('0.19', ratio(1, 3))).toEqual(ratio(157, 300));
    expect(ratioSubtract(1, '0.025')).toEqual(ratio(39, 40));
    expect(ratioMultiply('1.077', '1.5')).toEqual(ratio('1.6155'));
    expect(ratioDivide(1, 3)).toEqual(ratio(1, 3));
    expect(ratioNegate('2/4')).toEqual(ratio(-1, 2));
    expect(ratioCompare('1/3', '0.3333')).toBe(1);
    expect(ratioCompare(ratio(2, 6), '1/3')).toBe(0);
    expect(ratioCompare(-1n, 0)).toBe(-1);
  });

  it('takes a Fixed or a decimal string on either side', () => {
    expect(ratioAdd(fixed('0.10'), '0.05')).toEqual(ratio(3, 20));
    expect(ratioMultiply('100', fixed('0.077'))).toEqual(ratio('7.7'));
  });

  it('throws a RangeError for division by zero', () => {
    expect(() => ratioDivide(1, 0)).toThrow('Division by zero');
    expect(() => ratioDivide(1, '0.00')).toThrow(RangeError);
  });

  it('matches bigint rational arithmetic, reduced', () => {
    fc.assert(
      fc.property(rational, rational, (left, right) => {
        const [a, b] = left;
        const [c, d] = right;
        const order = a * d - c * b;
        return (
          same(ratioAdd(asRatio(left), asRatio(right)), [a * d + c * b, b * d]) &&
          same(ratioSubtract(asRatio(left), asRatio(right)), [a * d - c * b, b * d]) &&
          same(ratioMultiply(asRatio(left), asRatio(right)), [a * c, b * d]) &&
          (c === 0n || same(ratioDivide(asRatio(left), asRatio(right)), [a * d, b * c])) &&
          same(ratioNegate(asRatio(left)), [-a, b]) &&
          same(ratioComplement(asRatio(left)), [b - a, b]) &&
          ratioCompare(asRatio(left), asRatio(right)) === (order < 0n ? -1 : order > 0n ? 1 : 0)
        );
      }),
      { numRuns: runs(500) },
    );
  });

  it('obeys the field laws', () => {
    fc.assert(
      fc.property(rational, rational, rational, (x, y, z) => {
        const [a, b, c] = [asRatio(x), asRatio(y), asRatio(z)];
        return (
          ratioCompare(ratioAdd(a, b), ratioAdd(b, a)) === 0 &&
          ratioCompare(
            ratioMultiply(a, ratioAdd(b, c)),
            ratioAdd(ratioMultiply(a, b), ratioMultiply(a, c)),
          ) === 0 &&
          ratioCompare(ratioSubtract(ratioAdd(a, b), b), a) === 0 &&
          ratioCompare(ratioComplement(ratioComplement(a)), a) === 0 &&
          ratioCompare(ratioAdd(a, ratioNegate(a)), 0) === 0 &&
          (b.num === 0n || ratioCompare(ratioMultiply(ratioDivide(a, b), b), a) === 0)
        );
      }),
      { numRuns: runs(300) },
    );
  });
});
