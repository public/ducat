import '../src/plugins/core.js'; // Money methods, for comparing results
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exact, type ExactMoney } from '../src/exact.js';
import { ratio } from '../src/decimal.js';
import { cashPolicy } from '../src/cash.js';
import { roundingPolicy } from '../src/policy.js';
import {
  abs,
  compare,
  CurrencyMismatchError,
  fromMinor,
  max,
  min,
  money,
  round,
  type Money,
} from '../src/fn.js';
import type { RoundingMode } from '../src/rounding.js';
import { runs } from './fc-config.js';

const MODES: RoundingMode[] = ['halfEven', 'halfExpand', 'floor', 'ceil', 'trunc', 'expand'];
const eur = (amount: string) => money(amount, 'EUR', { scale: 4, rounding: 'unnecessary' });
const amount = fc
  .tuple(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), fc.integer({ min: 0, max: 6 }))
  .map(([minor, scale]) => fromMinor(minor, 'EUR', scale));
const exactAmount = fc
  .tuple(amount, fc.bigInt({ min: 1n, max: 10n ** 9n }))
  .map(([base, den]) => exact(base).divide(den));

describe('ExactMoney helpers', () => {
  it('has the sign and size checks Money has', () => {
    const third = exact(money('-10', 'EUR')).divide(3);
    expect(third.isNegative()).toBe(true);
    expect(third.isPositive()).toBe(false);
    expect(third.abs().toString()).toBe('10/3 EUR');
    expect(third.abs().isPositive()).toBe(true);
    const zero = exact(money('0', 'EUR'));
    expect([zero.isZero(), zero.isPositive(), zero.isNegative()]).toEqual([true, false, false]);
    expect(zero.abs()).toBe(zero);
  });

  it('compares with ExactMoney and Money alike', () => {
    const third = exact(money('1', 'EUR')).divide(3);
    expect(third.lessThan(money('0.34', 'EUR'))).toBe(true);
    expect(third.greaterThan(money('0.33', 'EUR'))).toBe(true);
    expect(third.lessThanOrEqual(third)).toBe(true);
    expect(third.greaterThanOrEqual(money('1', 'EUR'))).toBe(false);
    expect(exact(money('1.5', 'EUR')).equals(eur('1.5000'))).toBe(true);
    expect(exact(money('1.5', 'EUR')).equals(money('1.5', 'USD'))).toBe(false);
    expect(() => third.compare(money('1', 'USD') as unknown as Money<'EUR'>)).toThrow(
      CurrencyMismatchError,
    );
  });

  it('adds and subtracts Money of the same currency exactly', () => {
    const third = exact(money('1', 'EUR')).divide(3);
    expect(third.add(money('0.01', 'EUR')).toString()).toBe('103/300 EUR');
    expect(third.subtract(eur('0.0001')).toString()).toBe('9997/30000 EUR');
    expect(() => third.add(money('1', 'USD') as unknown as Money<'EUR'>)).toThrow(
      CurrencyMismatchError,
    );
  });

  it('has min, max and clamp, the first winning ties', () => {
    const third = exact(money('1', 'EUR')).divide(3);
    expect(third.max(money('0.30', 'EUR'), money('0.40', 'EUR')).toString()).toBe('2/5 EUR');
    expect(third.min(money('0.30', 'EUR')).toString()).toBe('3/10 EUR');
    expect(third.min()).toBe(third);
    const same = exact(money('1', 'EUR')).divide(3);
    expect(third.max(same)).toBe(third);
    expect(third.clamp(money('0.40', 'EUR'), money('1', 'EUR')).toString()).toBe('2/5 EUR');
    expect(third.clamp(money('0', 'EUR'), money('1', 'EUR'))).toBe(third);
    expect(() => third.clamp(money('1', 'EUR'), money('0', 'EUR'))).toThrow('clamp: lo > hi');
  });

  it('has percentage and ratioOf', () => {
    const chf = exact(money('10.01', 'CHF'));
    expect(chf.percentage('7.7').toString()).toBe('77077/100000 CHF');
    expect(chf.ratioOf(money('20.02', 'CHF'))).toEqual(ratio(1, 2));
    expect(() => chf.ratioOf(money('0', 'CHF'))).toThrow('Division by zero');
  });

  it('rounds to a policy, an increment or a mode', () => {
    const value = exact(money('10.03', 'CHF')).divide(3); // 3.34333...
    expect(value.round(cashPolicy('CHF')).toString()).toBe('3.35 CHF');
    expect(value.round(roundingPolicy({ scale: 4, rounding: 'floor' })).toString()).toBe(
      '3.3433 CHF',
    );
    expect(
      value.round(roundingPolicy({ scale: 0, increment: 10, rounding: 'ceil' })).toString(),
    ).toBe('10 CHF');
    expect(value.round('floor').toString()).toBe('3.34 CHF');
    expect(value.round().toString()).toBe('3.34 CHF');
    expect(() => value.round(roundingPolicy({ currency: 'EUR' }))).toThrow(CurrencyMismatchError);
    const { value: rounded, residual } = value.roundWithResidual(cashPolicy('CHF'));
    expect(rounded.toString()).toBe('3.35 CHF');
    expect(residual.add(rounded).equals(value)).toBe(true);
  });
});

describe('ExactMoney helpers agree with Money', () => {
  it('on Money values, every helper gives what Money gives', () => {
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        const ea = exact(a);
        return (
          ea.compare(b) === compare(a, b) &&
          ea.abs().equals(abs(a)) &&
          ea.max(b).equals(max(a, b)) &&
          ea.min(b).equals(min(a, b)) &&
          ea.isNegative() === a.isNegative() &&
          ea.isPositive() === a.isPositive() &&
          ea.add(b).equals(exact(a).add(exact(b)))
        );
      }),
      { numRuns: runs(300) },
    );
  });

  it('round(policy) is the policy applied to the exact value, rounded once', () => {
    fc.assert(
      fc.property(
        exactAmount,
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 1, max: 100 }),
        fc.constantFrom(...MODES),
        (value: ExactMoney<'EUR'>, scale, increment, mode) => {
          const policy = roundingPolicy({ scale, increment, rounding: mode });
          // Oracle: count whole increments at that scale with the mode, from the exact value.
          const steps = value
            .multiply(10n ** BigInt(scale))
            .divide(increment)
            .round(mode, 0);
          const expected = fromMinor(BigInt(steps.minor) * BigInt(increment), 'EUR', scale);
          const viaPolicy = value.round(policy);
          return viaPolicy.equals(expected) && viaPolicy.scale === scale;
        },
      ),
      { numRuns: runs(300) },
    );
  });

  it('round(mode, scale) is Money rounding when the value is Money', () => {
    fc.assert(
      fc.property(
        amount,
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(...MODES),
        (a, scale, mode) =>
          exact(a)
            .round(mode, scale)
            .identical(round(a, mode, scale)),
      ),
      { numRuns: runs(300) },
    );
  });
});
