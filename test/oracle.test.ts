// Independent oracles: every result is recomputed with decimal.js (arithmetic, rounding, tax,
// conversion) or with a from-scratch bigint largest-remainder allocator, over fast-check inputs.
// Nothing here imports ducat internals; only the public API is under test.
//
// decimal.js runs at 200 significant digits. Every quotient below has a denominator under 10^40, so
// a non-terminating quotient cannot sit within 10^-150 of a rounding boundary, and the single
// rounding to the money's scale is the only one that matters.
import { Decimal as DecimalJs } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  add,
  addTax,
  allocate,
  compare,
  convert,
  discount,
  divide,
  extractTax,
  fromMinor,
  multiply,
  percentage,
  RoundingError,
  split,
  subtract,
  sum,
  toScale,
  type Money,
  type RoundingMode,
} from '../src/fn.js';
import { runs } from './fc-config.js';

const Decimal = DecimalJs.clone({
  precision: 200,
  rounding: DecimalJs.ROUND_DOWN,
  toExpNeg: -1000,
  toExpPos: 1000,
});
type Decimal = InstanceType<typeof Decimal>;

type InexactMode = Exclude<RoundingMode, 'unnecessary'>;

/** ducat's rounding modes and their decimal.js names */
const DECIMAL_JS_MODES: Record<InexactMode, DecimalJs.Rounding> = {
  expand: Decimal.ROUND_UP,
  trunc: Decimal.ROUND_DOWN,
  ceil: Decimal.ROUND_CEIL,
  floor: Decimal.ROUND_FLOOR,
  halfExpand: Decimal.ROUND_HALF_UP,
  halfTrunc: Decimal.ROUND_HALF_DOWN,
  halfEven: Decimal.ROUND_HALF_EVEN,
  halfCeil: Decimal.ROUND_HALF_CEIL,
  halfFloor: Decimal.ROUND_HALF_FLOOR,
};
const INEXACT_MODES = Object.keys(DECIMAL_JS_MODES) as InexactMode[];

/** The value of a Money as decimal.js sees it, built from its minor units and scale only. */
function valueOf(amount: Money): Decimal {
  const minorUnits = new Decimal(amount.toScaledUnits().toString());
  return minorUnits.div(new Decimal(10).pow(amount.scale));
}

/** The expected minor units: `value` rounded once, at `scale`, with `mode`. */
function expectedMinor(value: Decimal, scale: number, mode: InexactMode): bigint {
  const scaled = value.mul(new Decimal(10).pow(scale));
  const rounded = scaled.toDecimalPlaces(0, DECIMAL_JS_MODES[mode]);
  return BigInt(rounded.toFixed(0));
}

/** A decimal string with `scale` fraction digits, written without any ducat code. */
function decimalString(units: bigint, scale: number): string {
  const isNegative = units < 0n;
  const magnitude = isNegative ? -units : units;
  let digits = magnitude.toString().padStart(scale + 1, '0');
  if (scale > 0) {
    digits = digits.slice(0, -scale) + '.' + digits.slice(-scale);
  }
  return isNegative ? '-' + digits : digits;
}

const CURRENCIES = [
  ['JPY', 0],
  ['EUR', 2],
  ['KWD', 3],
  ['CLF', 4],
] as const;
const currencyArb = fc.constantFrom(...CURRENCIES);

/** minor units: mostly safe integers, some well beyond 2^53 to exercise the bigint path */
const minorArb = fc.oneof(
  { weight: 3, arbitrary: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }) },
  { weight: 2, arbitrary: fc.bigInt({ min: -(2n ** 53n), max: 2n ** 53n }) },
  { weight: 1, arbitrary: fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }) },
);

const amountArb = fc
  .tuple(minorArb, currencyArb)
  .map(([minorUnits, [currency]]) => fromMinor(minorUnits, currency));

/** a decimal factor such as '1.075', '-0.5' or '12' */
const factorArb = fc
  .tuple(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), fc.integer({ min: 0, max: 8 }))
  .map(([units, scale]) => decimalString(units, scale));

const nonZeroFactorArb = factorArb.filter((factor) => !new Decimal(factor).isZero());

const positiveFactorArb = fc
  .tuple(fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.integer({ min: 0, max: 8 }))
  .map(([units, scale]) => decimalString(units, scale));

/** a tax or discount percentage: 0 to 100,000 units with up to 3 decimals, so 0 % to 100,000 % */
const percentArb = fc
  .tuple(fc.bigInt({ min: 0n, max: 100_000n }), fc.integer({ min: 0, max: 3 }))
  .map(([units, scale]) => decimalString(units, scale));

const modeArb = fc.constantFrom(...INEXACT_MODES);
const scaleArb = fc.integer({ min: 0, max: 6 });

describe('oracle: arithmetic against decimal.js', () => {
  it('add, subtract and compare, across scales', () => {
    const property = fc.property(
      minorArb,
      minorArb,
      currencyArb,
      scaleArb,
      scaleArb,
      (firstMinor, secondMinor, [currency], firstScale, secondScale) => {
        const first = fromMinor(firstMinor, currency, firstScale);
        const second = fromMinor(secondMinor, currency, secondScale);
        const widerScale = Math.max(firstScale, secondScale);

        const total = add(first, second);
        expect(total.scale).toBe(widerScale);
        expect(valueOf(total).eq(valueOf(first).add(valueOf(second)))).toBe(true);

        const difference = subtract(first, second);
        expect(difference.scale).toBe(widerScale);
        expect(valueOf(difference).eq(valueOf(first).sub(valueOf(second)))).toBe(true);

        expect(compare(first, second)).toBe(valueOf(first).cmp(valueOf(second)));
      },
    );
    fc.assert(property, { numRuns: runs(3000) });
  });

  it('sum of a list', () => {
    const listArb = fc.array(minorArb, { minLength: 1, maxLength: 20 });
    const property = fc.property(listArb, (minorUnitsList) => {
      const amounts = minorUnitsList.map((minorUnits) => fromMinor(minorUnits, 'EUR'));
      const expected = amounts.reduce(
        (total, amount) => total.add(valueOf(amount)),
        new Decimal(0),
      );
      expect(valueOf(sum(amounts)).eq(expected)).toBe(true);
    });
    fc.assert(property, { numRuns: runs(1000) });
  });

  it('multiply by a decimal factor, every rounding mode', () => {
    const property = fc.property(amountArb, factorArb, modeArb, (amount, factor, mode) => {
      const product = multiply(amount, factor, mode);
      expect(product.scale).toBe(amount.scale);

      const expected = expectedMinor(valueOf(amount).mul(factor), amount.scale, mode);
      expect(product.toScaledUnits()).toBe(expected);
    });
    fc.assert(property, { numRuns: runs(5000) });
  });

  it('multiply with "unnecessary" throws exactly when the product is inexact', () => {
    const property = fc.property(amountArb, factorArb, (amount, factor) => {
      const exactMinor = valueOf(amount).mul(factor).mul(new Decimal(10).pow(amount.scale));

      if (exactMinor.isInteger()) {
        const product = multiply(amount, factor, 'unnecessary');
        expect(product.toScaledUnits()).toBe(BigInt(exactMinor.toFixed(0)));
      } else {
        expect(() => multiply(amount, factor, 'unnecessary')).toThrow(RoundingError);
      }
    });
    fc.assert(property, { numRuns: runs(2000) });
  });

  it('divide by a decimal divisor, every rounding mode', () => {
    const property = fc.property(amountArb, nonZeroFactorArb, modeArb, (amount, divisor, mode) => {
      const quotient = divide(amount, divisor, mode);
      const expected = expectedMinor(valueOf(amount).div(divisor), amount.scale, mode);
      expect(quotient.toScaledUnits()).toBe(expected);
    });
    fc.assert(property, { numRuns: runs(5000) });
  });

  it('toScale down rounds once; toScale up is exact', () => {
    const targetScaleArb = fc.integer({ min: 0, max: 8 });
    const property = fc.property(amountArb, targetScaleArb, modeArb, (amount, scale, mode) => {
      const rescaled = toScale(amount, scale, mode);
      expect(rescaled.scale).toBe(scale);
      expect(rescaled.toScaledUnits()).toBe(expectedMinor(valueOf(amount), scale, mode));
    });
    fc.assert(property, { numRuns: runs(3000) });
  });
});

describe('oracle: tax, percentages and conversion against decimal.js', () => {
  it('percentage and discount', () => {
    const property = fc.property(amountArb, percentArb, modeArb, (amount, percent, mode) => {
      const exactShare = valueOf(amount).mul(percent).div(100);
      const share = expectedMinor(exactShare, amount.scale, mode);

      expect(percentage(amount, percent, mode).toScaledUnits()).toBe(share);
      expect(discount(amount, percent, mode).toScaledUnits()).toBe(amount.toScaledUnits() - share);
    });
    fc.assert(property, { numRuns: runs(3000) });
  });

  it('addTax: tax = net x p/100 rounded, gross = net + tax', () => {
    const property = fc.property(amountArb, percentArb, modeArb, (net, percent, mode) => {
      const breakdown = addTax(net, percent, mode);
      const tax = expectedMinor(valueOf(net).mul(percent).div(100), net.scale, mode);

      expect(breakdown.net.toScaledUnits()).toBe(net.toScaledUnits());
      expect(breakdown.tax.toScaledUnits()).toBe(tax);
      expect(breakdown.gross.toScaledUnits()).toBe(net.toScaledUnits() + tax);
    });
    fc.assert(property, { numRuns: runs(3000) });
  });

  it('extractTax: net = gross / (1 + p/100) rounded, tax = gross - net', () => {
    const property = fc.property(amountArb, percentArb, modeArb, (gross, percent, mode) => {
      const breakdown = extractTax(gross, percent, mode);
      const divisor = new Decimal(percent).div(100).add(1);
      const net = expectedMinor(valueOf(gross).div(divisor), gross.scale, mode);

      expect(breakdown.net.toScaledUnits()).toBe(net);
      expect(breakdown.tax.toScaledUnits()).toBe(gross.toScaledUnits() - net);
      expect(breakdown.gross.toScaledUnits()).toBe(gross.toScaledUnits());
    });
    fc.assert(property, { numRuns: runs(3000) });
  });

  it('convert: one rounding, to the target currency exponent', () => {
    const property = fc.property(
      amountArb,
      currencyArb,
      positiveFactorArb,
      modeArb,
      (amount, [target, targetExponent], rate, mode) => {
        const converted = convert(amount, target, rate, mode);
        expect(converted.currency).toBe(target);
        expect(converted.scale).toBe(targetExponent);

        const expected = expectedMinor(valueOf(amount).mul(rate), targetExponent, mode);
        expect(converted.toScaledUnits()).toBe(expected);
      },
    );
    fc.assert(property, { numRuns: runs(3000) });
  });
});

/**
 * Largest-remainder (Hamilton) allocation, written from its definition: each part gets
 * floor(amount * weight / W); the leftover units go one each to the parts with the largest
 * remainders (amount * weight mod W), ties to the lower index, never to a zero weight. A negative
 * amount is the mirror image of the positive allocation.
 */
function largestRemainderAllocation(amount: bigint, weights: bigint[]): bigint[] {
  if (amount < 0n) {
    return largestRemainderAllocation(-amount, weights).map((part) => -part);
  }

  const totalWeight = weights.reduce((total, weight) => total + weight, 0n);
  const parts = weights.map((weight) => (amount * weight) / totalWeight);
  const assigned = parts.reduce((total, part) => total + part, 0n);
  let leftover = amount - assigned;

  const candidates = weights.map((weight, index) => ({
    index,
    weight,
    remainder: (amount * weight) % totalWeight,
  }));
  candidates.sort((first, second) => {
    if (first.remainder === second.remainder) {
      return first.index - second.index;
    }
    return first.remainder > second.remainder ? -1 : 1;
  });

  for (const candidate of candidates) {
    if (leftover === 0n) {
      break;
    }
    if (candidate.weight === 0n) {
      continue;
    }
    parts[candidate.index]! += 1n;
    leftover -= 1n;
  }
  return parts;
}

describe('oracle: allocation against a from-scratch largest-remainder allocator', () => {
  const weightArb = fc.oneof(
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 0, max: 2 ** 40 }),
  );
  const weightsArb = fc
    .array(weightArb, { minLength: 1, maxLength: 12 })
    .filter((weights) => weights.some((weight) => weight > 0));

  it('integer weights', () => {
    const property = fc.property(minorArb, weightsArb, (minorUnits, weights) => {
      const parts = allocate(fromMinor(minorUnits, 'EUR'), weights);
      const expected = largestRemainderAllocation(minorUnits, weights.map(BigInt));
      expect(parts.map((part) => part.toScaledUnits())).toEqual(expected);
    });
    fc.assert(property, { numRuns: runs(3000) });
  });

  it('decimal-string weights (scaled to a common denominator)', () => {
    const decimalWeightArb = fc.tuple(
      fc.bigInt({ min: 0n, max: 10n ** 6n }),
      fc.integer({ min: 0, max: 4 }),
    );
    const decimalWeightsArb = fc.array(decimalWeightArb, { minLength: 1, maxLength: 8 });

    const property = fc.property(minorArb, decimalWeightsArb, (minorUnits, weights) => {
      fc.pre(weights.some(([units]) => units > 0n));

      const weightStrings = weights.map(([units, scale]) => decimalString(units, scale));
      // every weight at 4 decimals, as an integer, gives the same proportions
      const integerWeights = weights.map(([units, scale]) => units * 10n ** BigInt(4 - scale));

      const parts = allocate(fromMinor(minorUnits, 'EUR'), weightStrings);
      const expected = largestRemainderAllocation(minorUnits, integerWeights);
      expect(parts.map((part) => part.toScaledUnits())).toEqual(expected);
    });
    fc.assert(property, { numRuns: runs(2000) });
  });

  it('split: equal parts, the remainder one unit each to the first parts', () => {
    const countArb = fc.integer({ min: 1, max: 50 });
    const property = fc.property(minorArb, countArb, (minorUnits, count) => {
      const isNegative = minorUnits < 0n;
      const magnitude = isNegative ? -minorUnits : minorUnits;
      const quotient = magnitude / BigInt(count);
      const remainder = Number(magnitude % BigInt(count));
      const sign = isNegative ? -1n : 1n;

      const expected = Array.from({ length: count }, (_, index) => {
        const extraUnit = index < remainder ? 1n : 0n;
        return (quotient + extraUnit) * sign;
      });

      const parts = split(fromMinor(minorUnits, 'EUR'), count);
      expect(parts.map((part) => part.toScaledUnits())).toEqual(expected);
    });
    fc.assert(property, { numRuns: runs(3000) });
  });
});
