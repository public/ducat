import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  abs,
  add,
  addTax,
  allocate,
  clamp,
  convert,
  discount,
  divide,
  extractTax,
  fromMinor,
  max,
  min,
  multiply,
  negate,
  percentage,
  ratio,
  round,
  roundToIncrement,
  split,
  subtract,
  sum,
  toScale,
  type Factor,
  type Money,
} from '../src/fn.js';
import { fixed } from '../src/plugins/fixed.js';
import { runs } from './fc-config.js';
import { MODES } from './oracle.js';

// -0 survives `===` and JSON but breaks Object.is equality (Vitest's toBe, toStrictEqual on
// fields), so no operation may return it. Zero inputs are oversampled: that is where it appears.

const minorUnits = fc.oneof(
  fc.constantFrom(0, -0, 1, -1),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
);
const eurArb = minorUnits.map((minor) => fromMinor(minor, 'EUR'));
const zeroArb = fc.constantFrom(0, -0, 0n).map((minor) => fromMinor(minor, 'EUR'));
const amountArb = fc.oneof(zeroArb, eurArb);
const factorArb: fc.Arbitrary<Factor> = fc.oneof(
  fc.constantFrom<Factor>(-1, 0, 1, '-1', '-0', '-1.5', '-0.001', -1n, ratio(-1, 3)),
  fc.integer({ min: -1000, max: 1000 }),
  fc
    .tuple(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 1, max: 1000 }))
    .map(([num, den]) => ratio(num, den)),
);
const nonZeroFactorArb = factorArb.filter((factor) => ratio(factor).num !== 0n);
const modeArb = fc.constantFrom(...MODES).filter((mode) => mode !== 'unnecessary');

function expectNoNegativeZero(money: Money): void {
  expect(Object.is(money.minor, -0)).toBe(false);
}

describe('no operation returns -0 minor units', () => {
  it('fromMinor(-0)', () => {
    expectNoNegativeZero(fromMinor(-0, 'EUR'));
  });

  it('multiply(zero, -1) (#105)', () => {
    expectNoNegativeZero(multiply(fromMinor(0, 'EUR'), '-1'));
    expectNoNegativeZero(multiply(fromMinor(0, 'EUR'), -1));
    expectNoNegativeZero(multiply(fromMinor(0, 'EUR'), ratio(-1, 1)));
    expect(Object.is(fixed('0').multiply('-1').toScaled().value, -0)).toBe(false);
  });

  it('arithmetic', () => {
    fc.assert(
      fc.property(amountArb, amountArb, factorArb, modeArb, (money, other, factor, mode) => {
        expectNoNegativeZero(add(money, other));
        expectNoNegativeZero(subtract(money, other));
        expectNoNegativeZero(sum([money, other]));
        expectNoNegativeZero(negate(money));
        expectNoNegativeZero(abs(money));
        expectNoNegativeZero(min(money, other));
        expectNoNegativeZero(max(money, other));
        expectNoNegativeZero(multiply(money, factor, mode));
        expectNoNegativeZero(percentage(money, factor, mode));
        expectNoNegativeZero(round(money, mode, 0));
        expectNoNegativeZero(toScale(money, 0, mode));
        expectNoNegativeZero(toScale(money, 4, mode));
        expectNoNegativeZero(roundToIncrement(money, fromMinor(5, 'EUR'), mode));
        expectNoNegativeZero(convert(money, 'JPY', '162.457', mode));
        expectNoNegativeZero(convert(money, 'USD', '1', mode));
      }),
      { numRuns: runs(500) },
    );
  });

  it('division', () => {
    fc.assert(
      fc.property(amountArb, nonZeroFactorArb, modeArb, (money, divisor, mode) => {
        expectNoNegativeZero(divide(money, divisor, mode));
      }),
      { numRuns: runs(500) },
    );
  });

  it('clamp, tax and allocation', () => {
    fc.assert(
      fc.property(amountArb, modeArb, (money, mode) => {
        expectNoNegativeZero(clamp(money, fromMinor(-0, 'EUR'), fromMinor(0, 'EUR')));
        const added = addTax(money, '20', mode);
        expectNoNegativeZero(added.net);
        expectNoNegativeZero(added.tax);
        expectNoNegativeZero(added.gross);
        const extracted = extractTax(money, '20', mode);
        expectNoNegativeZero(extracted.net);
        expectNoNegativeZero(extracted.tax);
        expectNoNegativeZero(discount(money, '15', mode));
        allocate(money, [1, 2, 0]).forEach(expectNoNegativeZero);
        split(money, 3).forEach(expectNoNegativeZero);
      }),
      { numRuns: runs(300) },
    );
  });

  it('Fixed arithmetic', () => {
    const fixedArb = fc.oneof(
      fc.constantFrom('0', '-0', '0.00', '-0.00'),
      fc.integer({ min: -100_000, max: 100_000 }).map((value) => String(value / 100)),
    );
    fc.assert(
      fc.property(fixedArb, factorArb, modeArb, (text, factor, mode) => {
        const value = fixed(text);
        for (const result of [
          value.negate(),
          value.abs(),
          value.multiply(factor, mode),
          value.round(mode),
          value.toScale(0, mode),
        ]) {
          expect(Object.is(result.toScaled().value, -0)).toBe(false);
        }
      }),
      { numRuns: runs(300) },
    );
  });
});
