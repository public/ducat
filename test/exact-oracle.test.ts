// ExactMoney against a frozen reference: the all-bigint implementation it had before its number
// fast path (0.3.0), kept here as an oracle. Random chains of operations must give the same value,
// string, comparisons and rounding after every step, including around 2^53 and at scales 15 and 16.
import '../src/plugins/iso.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ratio, type Ratio } from '../src/decimal.js';
import { exact, sumExact, type ExactMoney } from '../src/exact.js';
import { fromMinor } from '../src/fn.js';
import { divideAndRoundBigint, type RoundingMode } from '../src/rounding.js';
import { runs } from './fc-config.js';

class Reference {
  readonly num: bigint;
  readonly den: bigint;
  constructor(num: bigint, den: bigint) {
    const reduced = ratio(num, den);
    this.num = reduced.num;
    this.den = reduced.den;
  }
  add(other: Reference): Reference {
    return new Reference(this.num * other.den + other.num * this.den, this.den * other.den);
  }
  subtract(other: Reference): Reference {
    return this.add(other.negate());
  }
  negate(): Reference {
    return new Reference(-this.num, this.den);
  }
  multiply(factor: Ratio): Reference {
    return new Reference(this.num * factor.num, this.den * factor.den);
  }
  divide(factor: Ratio): Reference {
    return new Reference(this.num * factor.den, this.den * factor.num);
  }
  compare(other: Reference): number {
    const difference = this.num * other.den - other.num * this.den;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }
  round(mode: RoundingMode, scale: number): bigint {
    return divideAndRoundBigint(this.num * 10n ** BigInt(scale), this.den, mode);
  }
  toString(): string {
    return this.den === 1n ? `${this.num} EUR` : `${this.num}/${this.den} EUR`;
  }
}

const MODES: RoundingMode[] = ['halfEven', 'halfExpand', 'floor', 'ceil', 'trunc', 'expand'];
const SAFE = 2n ** 53n;
const minor = fc.oneof(
  fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
  fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
  fc.bigInt({ min: -50n, max: 50n }).map((offset) => SAFE + offset),
  fc.bigInt({ min: -50n, max: 50n }).map((offset) => -SAFE + offset),
);
const scale = fc.oneof(fc.integer({ min: 0, max: 4 }), fc.constantFrom(14, 15, 16, 17));
const factor = fc.oneof(
  fc.constantFrom('1.075', '1.19', '0.077', '100', '-1', '1/3', '7/11', '0.5', '1e-9'),
  fc.integer({ min: -1000, max: 1000 }).filter((value) => value !== 0),
  fc
    .tuple(
      fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
      fc.bigInt({ min: 1n, max: 10n ** 20n }),
    )
    .filter(([num]) => num !== 0n)
    .map(([num, den]) => ratio(num, den)),
  fc.bigInt({ min: -50n, max: 50n }).map((offset) => ratio(SAFE + offset, 3n)),
);
const step = fc.oneof(
  fc.record({ op: fc.constant('add' as const), minor, scale, asMoney: fc.boolean() }),
  fc.record({ op: fc.constant('subtract' as const), minor, scale, asMoney: fc.boolean() }),
  fc.record({ op: fc.constant('addSelf' as const) }),
  fc.record({ op: fc.constant('negate' as const) }),
  fc.record({ op: fc.constant('multiply' as const), factor }),
  fc.record({ op: fc.constant('divide' as const), factor }),
);

function agree(actual: ExactMoney<'EUR'>, expected: Reference): void {
  expect(actual.num).toBe(expected.num);
  expect(actual.den).toBe(expected.den);
  expect(actual.toString()).toBe(expected.toString());
  expect(actual.sign()).toBe(expected.compare(new Reference(0n, 1n)));
  expect(actual.isZero()).toBe(expected.num === 0n);
}

describe('ExactMoney agrees with the bigint reference', () => {
  it('after every step of a random chain', () => {
    fc.assert(
      fc.property(
        minor,
        scale,
        fc.array(step, { maxLength: 12 }),
        fc.constantFrom(...MODES),
        (start, startScale, steps, mode) => {
          let actual = exact(fromMinor(start, 'EUR', startScale));
          let expected = new Reference(start, 10n ** BigInt(startScale));
          agree(actual, expected);
          for (const next of steps) {
            const before = actual;
            const beforeReference = expected;
            switch (next.op) {
              case 'add':
              case 'subtract': {
                const other = exact(fromMinor(next.minor, 'EUR', next.scale));
                const otherReference = new Reference(next.minor, 10n ** BigInt(next.scale));
                actual = actual[next.op](other);
                expected = expected[next.op](otherReference);
                expect(before.compare(other)).toBe(beforeReference.compare(otherReference));
                expect(before.equals(other)).toBe(beforeReference.compare(otherReference) === 0);
                break;
              }
              case 'addSelf':
                actual = actual.add(actual);
                expected = expected.add(expected);
                break;
              case 'negate':
                actual = actual.negate();
                expected = expected.negate();
                break;
              case 'multiply':
                actual = actual.multiply(next.factor);
                expected = expected.multiply(ratio(next.factor));
                break;
              case 'divide':
                actual = actual.divide(next.factor);
                expected = expected.divide(ratio(next.factor));
                break;
            }
            agree(actual, expected);
            expect(actual.compare(before)).toBe(expected.compare(beforeReference));
          }
          for (const roundScale of [0, 2, 4, 15, 16]) {
            expect(BigInt(actual.round(mode, roundScale).minor)).toBe(
              expected.round(mode, roundScale),
            );
            expect(actual.isExact(roundScale)).toBe(
              (expected.num * 10n ** BigInt(roundScale)) % expected.den === 0n,
            );
          }
        },
      ),
      { numRuns: runs(400) },
    );
  });

  it('sums, converts and keeps -0 out', () => {
    const thirds = [1, 2, 3, 4, 5].map((cents) => exact(fromMinor(cents, 'EUR')).divide(3));
    expect(sumExact(thirds).toString()).toBe('1/20 EUR');
    expect(Object.is(exact(fromMinor(0, 'EUR')).negate().round('halfEven').minor, 0)).toBe(true);
    expect(exact(fromMinor(0, 'EUR')).multiply(-5).toString()).toBe('0 EUR');
    expect(exact(fromMinor(5, 'EUR')).divide(-3).toString()).toBe('-1/60 EUR');
  });
});
