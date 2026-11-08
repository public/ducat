// divide() has a number fast path for divisors whose ratio parts are safe integers. It must give
// exactly what the bigint path gives: the proved kernel applied to m·den / num.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runs } from './fc-config.js';
import { divideAndRoundBigint } from '../src/generated/kernel.js';
import { divide, fromMinor, ratio, type RoundingMode } from '../src/fn.js';

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

/** m / (num/den) through the proved bigint kernel, with a positive divisor. */
function reference(minor: bigint, divisorNum: bigint, divisorDen: bigint, mode: RoundingMode) {
  const dividend = minor * divisorDen;
  return divisorNum > 0n
    ? divideAndRoundBigint(dividend, divisorNum, mode)
    : divideAndRoundBigint(-dividend, -divisorNum, mode);
}

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const minors = fc.oneof(
  fc.integer({ min: -1_000_000, max: 1_000_000 }).map(BigInt),
  fc.bigInt({ min: -SAFE, max: SAFE }),
  fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
);
const divisors = fc.oneof(
  fc.integer({ min: -1000, max: 1000 }).filter((value) => value !== 0),
  fc.integer().filter((value) => value !== 0),
  fc.constantFrom('7', '-3', '1.5', '0.07', '1/3', '-22/7', '1e-3', '123456789.123'),
  fc
    .tuple(fc.bigInt({ min: 1n, max: 10n ** 20n }), fc.bigInt({ min: 1n, max: 10n ** 20n }))
    .map(([num, den]) => ratio(num, den)),
);

describe('divide', () => {
  it('matches the proved bigint kernel on every path (property)', () => {
    fc.assert(
      fc.property(minors, divisors, fc.constantFrom(...MODES), (minor, divisor, mode) => {
        const amount = fromMinor(minor, 'EUR');
        const divisorRatio = ratio(divisor);
        const expected = reference(minor, divisorRatio.num, divisorRatio.den, mode);
        const result = divide(amount, divisor, mode);
        expect(BigInt(result.minor)).toBe(expected);
        expect(result.scale).toBe(2);
        // the representation invariant: a number exactly when it is a safe integer
        expect(typeof result.minor === 'number').toBe(expected <= SAFE && expected >= -SAFE);
      }),
      { numRuns: runs(2000) },
    );
  });

  it('normalises -0 and keeps unnecessary strict', () => {
    expect(Object.is(divide(fromMinor(0, 'EUR'), -3).minor, 0)).toBe(true);
    expect(Object.is(divide(fromMinor(-1, 'EUR'), 3, 'trunc').minor, 0)).toBe(true);
    expect(divide(fromMinor(9, 'EUR'), 3, 'unnecessary').minor).toBe(3);
    expect(() => divide(fromMinor(10, 'EUR'), 3, 'unnecessary')).toThrow(RangeError);
    expect(() => divide(fromMinor(10, 'EUR'), 0)).toThrow(RangeError);
    expect(() => divide(fromMinor(10, 'EUR'), '0.00')).toThrow(RangeError);
  });

  it('falls back near the safe-integer limit', () => {
    const max = fromMinor(Number.MAX_SAFE_INTEGER, 'EUR');
    expect(divide(max, '0.5').minor).toBe(SAFE * 2n);
    expect(divide(max, -1).minor).toBe(-Number.MAX_SAFE_INTEGER);
    expect(divide(max, '1/3', 'halfEven').minor).toBe(SAFE * 3n);
  });
});
