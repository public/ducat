// divide() has a number fast path for divisors whose ratio parts are safe integers. It must give
// exactly what the bigint path gives: the proved kernel applied to m·den / num.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runs } from './fc-config.js';
import { divideAndRoundBigint } from '../src/generated/kernel.js';
import { divide, fromMinor, ratio, RoundingError, type RoundingMode } from '../src/fn.js';
import { multiplyByRatio } from '../src/money.js';
import { divideSafeByRatio } from '../src/rounding.js';
import { fixed, fromScaled } from '../src/fixed.js';

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

// Uniform bigints rarely hit the edges, so the safe-integer boundary is listed explicitly.
const minors = fc.oneof(
  fc.integer({ min: -1_000_000, max: 1_000_000 }).map(BigInt),
  fc.bigInt({ min: -SAFE, max: SAFE }),
  fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
  fc.constantFrom(SAFE, -SAFE, SAFE - 1n, -(SAFE - 1n), SAFE + 1n, -(SAFE + 1n), 0n, 1n, -1n),
);
const divisors = fc.oneof(
  fc.integer({ min: -1000, max: 1000 }).filter((value) => value !== 0),
  fc.integer().filter((value) => value !== 0),
  fc.constantFrom('7', '-3', '1.5', '0.07', '0.3', '1.075', '-1', '1/3', '-22/7', '1e-3'),
  fc.constantFrom('123456789.123', 3n, -7n, 10n ** 20n + 1n),
  fc
    .tuple(
      fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }).filter((num) => num !== 0n),
      fc.bigInt({ min: 1n, max: 10n ** 20n }),
    )
    .map(([num, den]) => ratio(num, den)),
);
const modesAndUnnecessary = fc.constantFrom<RoundingMode>(...MODES, 'unnecessary');

describe('divide', () => {
  it('matches the proved bigint kernel on every path (property)', () => {
    fc.assert(
      fc.property(minors, divisors, modesAndUnnecessary, (minor, divisor, mode) => {
        const amount = fromMinor(minor, 'EUR');
        const divisorRatio = ratio(divisor);
        if (mode === 'unnecessary') {
          // exact quotients never throw, inexact ones always do
          const isExact = (minor * divisorRatio.den) % divisorRatio.num === 0n;
          if (!isExact) {
            expect(() => divide(amount, divisor, mode)).toThrow(RoundingError);
            return;
          }
        }
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

  it('agrees with the previous divide, through the inverse ratio (property)', () => {
    fc.assert(
      fc.property(minors, divisors, fc.constantFrom(...MODES), (minor, divisor, mode) => {
        const amount = fromMinor(minor, 'EUR');
        const divisorRatio = ratio(divisor);
        const previous = multiplyByRatio(amount, ratio(divisorRatio.den, divisorRatio.num), mode);
        const result = divide(amount, divisor, mode);
        // compared as bigints: the previous path could return -0 (divide(0, -1)), the new one never
        expect(BigInt(result.minor)).toBe(BigInt(previous.minor));
        expect(typeof result.minor).toBe(typeof previous.minor);
        expect(result.scale).toBe(previous.scale);
      }),
      { numRuns: runs(1000) },
    );
  });

  it('lands on the safe-integer boundary exactly', () => {
    // m·d exactly ±(2^53 − 1), and one past it, which must take the bigint path
    const third = (Number.MAX_SAFE_INTEGER - 1) / 2;
    expect(divide(fromMinor(Number.MAX_SAFE_INTEGER, 'EUR'), '1/1').minor).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(divide(fromMinor(third, 'EUR'), '1/2').minor).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(divide(fromMinor(Number.MAX_SAFE_INTEGER, 'EUR'), '3/3').minor).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(divide(fromMinor(2 ** 52, 'EUR'), '1/2').minor).toBe(2n ** 53n);
    expect(divide(fromMinor(-(2 ** 52), 'EUR'), '-1/2').minor).toBe(2n ** 53n);
    expect(divide(fromMinor(-Number.MAX_SAFE_INTEGER, 'EUR'), '1/3', 'trunc').minor).toBe(
      -(SAFE * 3n),
    );
  });

  it('reports an invalid mode only when rounding is needed, like the ratio path', () => {
    const amount = fromMinor(12, 'EUR');
    expect(divide(amount, 4, 'bogus' as RoundingMode).minor).toBe(3);
    expect(() => divide(amount, 5, 'bogus' as RoundingMode)).toThrow(RangeError);
  });

  it('rejects every form of zero', () => {
    const amount = fromMinor(10, 'EUR');
    for (const zeroDivisor of [0, 0n, '0', '0.00', '-0', ratio(0), ratio(0, 5)]) {
      expect(() => divide(amount, zeroDivisor)).toThrow(RangeError);
    }
  });

  it('normalises -0 and keeps unnecessary strict', () => {
    expect(Object.is(divide(fromMinor(0, 'EUR'), -3).minor, 0)).toBe(true);
    expect(Object.is(divide(fromMinor(0, 'EUR'), -1).minor, 0)).toBe(true);
    expect(Object.is(divide(fromMinor(0, 'EUR'), '-1').minor, 0)).toBe(true);
    expect(Object.is(divide(fromMinor(0, 'EUR'), '-0.5').minor, 0)).toBe(true);
    expect(Object.is(divide(fromMinor(-1, 'EUR'), 3, 'trunc').minor, 0)).toBe(true);
    expect(divide(fromMinor(9, 'EUR'), 3, 'unnecessary').minor).toBe(3);
    expect(() => divide(fromMinor(10, 'EUR'), 3, 'unnecessary')).toThrow(RangeError);
  });

  it('falls back near the safe-integer limit', () => {
    const max = fromMinor(Number.MAX_SAFE_INTEGER, 'EUR');
    expect(divide(max, '0.5').minor).toBe(SAFE * 2n);
    expect(divide(max, -1).minor).toBe(-Number.MAX_SAFE_INTEGER);
    expect(divide(max, '1/3', 'halfEven').minor).toBe(SAFE * 3n);
  });
});

describe('divide and multiply with a rounding policy', () => {
  it('never take the number fast paths, which would keep the amount’s own scale', async () => {
    const { roundingPolicy } = await import('../src/policy.js');
    const fourDecimals = roundingPolicy({ scale: 4 });
    const amount = fromMinor(1000, 'EUR');
    const quotient = divide(amount, 3, fourDecimals);
    expect([quotient.minor, quotient.scale]).toEqual([33333, 4]);
    const exactQuotient = divide(amount, 4, fourDecimals);
    expect([exactQuotient.minor, exactQuotient.scale]).toEqual([25000, 4]);
    const byString = divide(amount, '7', fourDecimals);
    expect([byString.minor, byString.scale]).toEqual([14286, 4]);
    const product = amount.multiply(3, fourDecimals);
    expect([product.minor, product.scale]).toEqual([300000, 4]);
    const fiveCents = roundingPolicy({ increment: 5 });
    expect(divide(fromMinor(1001, 'EUR'), 1, fiveCents).minor).toBe(1000);
  });
});

describe('Fixed#divide', () => {
  const scales = fc.integer({ min: 0, max: 6 });

  it('matches the proved bigint kernel at its own scale and at another (property)', () => {
    fc.assert(
      fc.property(
        minors,
        scales,
        divisors,
        fc.option(scales, { nil: undefined }),
        modesAndUnnecessary,
        (value, scale, divisor, target, mode) => {
          const dividend = fromScaled(value, scale);
          const divisorRatio = ratio(divisor);
          const resultScale = target ?? scale;
          // value / 10^scale ÷ (num/den), at resultScale: value·den·10^(resultScale − scale) / num
          let numerator = value * divisorRatio.den;
          let denominator = divisorRatio.num;
          if (resultScale > scale) {
            numerator *= 10n ** BigInt(resultScale - scale);
          } else {
            denominator *= 10n ** BigInt(scale - resultScale);
          }
          const options = target === undefined ? undefined : { scale: target };
          if (mode === 'unnecessary' && numerator % denominator !== 0n) {
            expect(() => dividend.divide(divisor, mode, options)).toThrow(RoundingError);
            return;
          }
          const expected = reference(numerator, denominator, 1n, mode);
          const result = dividend.divide(divisor, mode, options);
          expect(BigInt(result.value)).toBe(expected);
          expect(result.scale).toBe(resultScale);
          expect(typeof result.value === 'number').toBe(expected <= SAFE && expected >= -SAFE);
        },
      ),
      { numRuns: runs(2000) },
    );
  });

  it('takes the fast path for a Fixed divisor, and normalises -0', () => {
    expect(fixed('10.00').divide(fixed('3'), 'halfEven').toString()).toBe('3.33');
    expect(fixed('10.00').divide(fixed('-0.5')).toString()).toBe('-20.00');
    expect(Object.is(fixed('0.00').divide(-3).value, 0)).toBe(true);
    expect(fromScaled(Number.MAX_SAFE_INTEGER, 0).divide('0.5').value).toBe(SAFE * 2n);
    expect(() => fixed('1').divide(0)).toThrow('Division by zero');
  });
});

describe('the two copies of the number fast path', () => {
  // Money#divide inlines the steps of divideSafeByRatio (which Fixed#divide calls), so the copies
  // must agree wherever the fast path applies
  it('Money#divide and divideSafeByRatio agree in every mode (property)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1_000_000, max: 1_000_000 }),
          fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        ),
        fc.oneof(
          fc.integer({ min: -1000, max: 1000 }).filter((value) => value !== 0),
          fc.constantFrom('1.5', '-0.07', '1.075', '1/3', '-22/7'),
        ),
        modesAndUnnecessary,
        (value, divisor, mode) => {
          const divisorRatio = ratio(divisor);
          let fast: number | undefined;
          try {
            fast = divideSafeByRatio(value, divisorRatio, mode);
          } catch (error) {
            expect(error).toBeInstanceOf(RoundingError);
            expect(() => divide(fromMinor(value, 'EUR'), divisor, mode)).toThrow(RoundingError);
            return;
          }
          if (fast !== fast) {
            // out of the number path's range; the bigint path is checked above
            return;
          }
          expect(divide(fromMinor(value, 'EUR'), divisor, mode).minor).toBe(fast);
          expect(fromScaled(value, 2).divide(divisor, mode).value).toBe(fast);
        },
      ),
      { numRuns: runs(2000) },
    );
  });
});
