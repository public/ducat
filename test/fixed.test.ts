import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { currencyExponent, fromMinor, money, ratio, RoundingError, type RoundingMode } from '../src/index.js';
import { Fixed, fixed, fromScaled, isFixed } from '../src/plugins/fixed.js';
import { MODES, refDivRound } from './oracle.js';

const ALL_MODES: RoundingMode[] = [...MODES, 'unnecessary'];

/** The oracle: value / 10^scale as an exact bigint fraction, rescaled and rounded independently. */
function oracleAtScale(numerator: bigint, denominator: bigint, scale: number, mode: RoundingMode): bigint {
  return refDivRound(numerator * 10n ** BigInt(scale), denominator, mode);
}

const scaledValue = fc.oneof(
  fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
  fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }),
);
const scale = fc.integer({ min: 0, max: 20 });
const anyFixed = fc.tuple(scaledValue, scale).map(([value, decimals]) => fromScaled(value, decimals));
const mode = fc.constantFrom(...MODES);

function exactOf(value: Fixed): [bigint, bigint] {
  return [BigInt(value.value), 10n ** BigInt(value.scale)];
}

describe('fixed()', () => {
  it('keeps a string at its own scale and refuses to guess with floats', () => {
    expect(fixed('12.340').toString()).toBe('12.340');
    expect(fixed('12.340').scale).toBe(3);
    expect(fixed('-0.05').toScaled()).toEqual({ value: -5, scale: 2 });
    expect(fixed(12).toScaled()).toEqual({ value: 12, scale: 0 });
    expect(fixed(0.25).toString()).toBe('0.25');
    expect(fixed(1.005).toString()).toBe('1.005');
    expect(fixed(10n ** 30n).toString()).toBe('1000000000000000000000000000000');
    expect(fixed('1e-3').toString()).toBe('0.001');
    expect(() => fixed(0.1 + 0.2)).toThrow(RangeError);
    expect(fixed(0.1 + 0.2, { scale: 2, rounding: 'halfEven' }).toString()).toBe('0.30');
    expect(() => fixed(0.1 + 0.2, { scale: 2 })).toThrow(RoundingError);
    expect(() => fixed(2 ** 60 + 0.5)).toThrow(RangeError); // 1152921504606846976: 19 digits
    expect(() => fixed(Number.NaN)).toThrow(RangeError);
    expect(() => fixed('12,34')).toThrow(SyntaxError);
    expect(() => fixed({} as never)).toThrow(TypeError);
  });

  it('refuses input that would break the invariant or cost unbounded work', () => {
    const FixedClass = Fixed as unknown as new (value: number, scale: number) => Fixed;
    expect(() => new FixedClass(1.5, 2)).toThrow(TypeError);
    expect(() => fixed('1e-999999999')).toThrow(RangeError);
    expect(() => fixed('1e999999999')).toThrow(RangeError);
    expect(() => fixed(`0.${'0'.repeat(1000)}1`)).toThrow(RangeError);
    expect(fixed(`0.${'0'.repeat(998)}1`).scale).toBe(1000);
    expect(() => fixed('1').toScale(1001)).toThrow(RangeError);
    expect(() => fixed('1').divide(3, 'halfEven', { scale: 1001 })).toThrow(RangeError);
    // a float needs an explicit rounding mode before its extra digits may be dropped or kept
    expect(() => fixed(0.1 + 0.2, { scale: 17 })).toThrow(RangeError);
    expect(fixed(0.1 + 0.2, { scale: 17, rounding: 'halfEven' }).toString()).toBe('0.30000000000000004');
    expect(() => fixed('1.5', { rounding: 'halfEven' })).toThrow(RangeError);
  });

  it('never produces a negative zero', () => {
    for (const result of [
      fixed('0').multiply('-2'),
      fixed('0').multiply(-2n),
      fixed('0').multiply(-2),
      fixed('0.00').divide(-1),
      fixed('-0.001').round('halfEven', 2),
      fixed('-0'),
      fromScaled(-0, 2),
    ]) {
      expect(Object.is(result.value, -0)).toBe(false);
    }
  });

  it('rounds input only when asked to', () => {
    expect(() => fixed('1.005', { scale: 2 })).toThrow(RoundingError);
    expect(fixed('1.005', { scale: 2, rounding: 'halfEven' }).toString()).toBe('1.00');
    expect(fixed('1.005', { scale: 2, rounding: 'halfExpand' }).toString()).toBe('1.01');
    expect(fixed('1.5', { scale: 4 }).toString()).toBe('1.5000');
    expect(fixed(7, { scale: 2 }).toString()).toBe('7.00');
    expect(fixed(fixed('1.25'), { scale: 1, rounding: 'halfEven' }).toString()).toBe('1.2');
    expect(() => fixed('1', { scale: -1 })).toThrow(RangeError);
    expect(() => fixed('1', { scale: 1.5 })).toThrow(RangeError);
  });

  it('fromScaled takes integers only, and keeps the number-while-safe invariant', () => {
    expect(fromScaled(12345, 3).toString()).toBe('12.345');
    expect(fromScaled(5n, 2).value).toBe(5);
    expect(typeof fromScaled(2n ** 60n, 0).value).toBe('bigint');
    expect(() => fromScaled(1.5, 0)).toThrow(RangeError);
    expect(() => fromScaled(2 ** 60, 0)).toThrow(RangeError);
    expect(() => fromScaled(1, -1)).toThrow(RangeError);
    expect(isFixed(fromScaled(1, 0))).toBe(true);
    expect(isFixed(money('1', 'EUR'))).toBe(false);
  });

  it('serialises as a decimal string and blocks primitive arithmetic', () => {
    const value = fixed('-12.50');
    expect(JSON.stringify({ value })).toBe('{"value":"-12.50"}');
    expect(fixed(JSON.parse(JSON.stringify(value)) as string).equals(value)).toBe(true);
    expect(`${value}`).toBe('-12.50');
    expect(() => +value).toThrow(TypeError);
  });
});

describe('Fixed arithmetic', () => {
  it('aligns mixed scales like Money', () => {
    expect(fixed('1.5').add('0.25').toString()).toBe('1.75');
    expect(fixed('1.50').subtract(fixed('2')).toString()).toBe('-0.50');
    expect(fixed('0.1').add(fixed('0.2')).toString()).toBe('0.3');
    expect(fixed('1.0').equals('1.00')).toBe(true);
    expect(fixed('1.01').compare('1.1')).toBe(-1);
  });

  it('multiplies and divides at this scale, rounding once', () => {
    expect(fixed('9.99').divide('1.2', 'halfEven').toString()).toBe('8.32');
    expect(fixed('9.99').divide('1.2').toString()).toBe('8.33'); // halfExpand by default
    expect(fixed('2.00').multiply(fixed('1.075')).toString()).toBe('2.15');
    expect(fixed('10.0000').divide(3).toString()).toBe('3.3333');
    expect(fixed('1').divide(ratio(1, 3), 'unnecessary').toString()).toBe('3');
    expect(() => fixed('1.00').divide(3, 'unnecessary')).toThrow(RoundingError);
    expect(() => fixed('1').divide('0')).toThrow(RangeError);
    // a target scale rounds once, at that scale
    expect(fixed('9.990').divide('1.2', 'halfEven', { scale: 2 }).toString()).toBe('8.32');
    expect(fixed('1.00').divide(3, 'halfEven', { scale: 6 }).toString()).toBe('0.333333');
    expect(fixed('0.25').multiply('0.5', 'halfEven', { scale: 3 }).toString()).toBe('0.125');
    expect(fixed('2').multiply(3, 'unnecessary', { scale: 2 }).toString()).toBe('6.00');
    // double rounding: 0.0145 at scale 2 is 1.45 hundredths, so one rounding gives 0.01, but rounding
    // to scale 3 first makes the tie 0.015, which then rounds up to 0.02
    expect(fixed('0.0145').multiply(1, 'halfEven', { scale: 2 }).toString()).toBe('0.01');
    expect(fixed('0.0145').toScale(3, 'halfExpand').toScale(2, 'halfExpand').toString()).toBe('0.02');
    expect(fixed('0.0145').multiply(1, 'halfExpand', { scale: 2 }).toString()).toBe('0.01');
    expect(() => fixed('1').divide(3, 'halfEven', { scale: -1 })).toThrow(RangeError);
  });

  it('rounds, changes scale and reports sign', () => {
    expect(fixed('2.5').round('halfEven').toString()).toBe('2');
    expect(fixed('-2.5').round('halfExpand').toString()).toBe('-3');
    expect(fixed('1.2345').round('halfEven', 2).toString()).toBe('1.23');
    expect(fixed('1.2').toScale(3).toString()).toBe('1.200');
    expect(fixed('-0.00').isZero()).toBe(true);
    expect(fixed('-0.01').sign()).toBe(-1);
    expect(fixed('-0.01').abs().toString()).toBe('0.01');
    expect(fixed('0').negate().value).toBe(0);
    expect(Object.is(fixed('0').negate().value, -0)).toBe(false);
  });
});

describe('battery, adapted for fixed point', () => {
  it.each([
    ['0.25', '0.5', 'halfEven', '0.12'],
    ['0.25', '0.5', 'halfExpand', '0.13'],
    ['-0.25', '0.5', 'halfExpand', '-0.13'],
    ['-0.25', '0.5', 'halfEven', '-0.12'],
    ['0.50', '1.15', 'halfExpand', '0.58'],
    ['0.45', '0.7', 'halfExpand', '0.32'],
    ['1.15', '1.1', 'halfEven', '1.26'],
    ['0.90', '1.15', 'halfExpand', '1.04'],
    ['0.25', '1.1', 'halfTrunc', '0.27'],
  ] as const)('%s × %s (%s) = %s', (amount, factor, rounding, expected) => {
    expect(fixed(amount).multiply(factor, rounding).toString()).toBe(expected);
    // a number factor is read at its shortest decimal form, so it is exact too
    expect(fixed(amount).multiply(Number(factor), rounding).toString()).toBe(expected);
  });

  it.each([
    ['12.00', '1.2', 'halfEven', '10.00'],
    ['9.99', '1.2', 'halfEven', '8.32'],
    ['9.99', '1.2', 'halfExpand', '8.33'],
    ['119.00', '1.19', 'halfEven', '100.00'],
  ] as const)('%s ÷ %s (%s) = %s', (amount, divisor, rounding, expected) => {
    expect(fixed(amount).divide(divisor, rounding).toString()).toBe(expected);
  });

  it('amounts beyond 2^53', () => {
    expect(fixed('90071992547409.93').toScaled()).toEqual({ value: 9007199254740993n, scale: 2 });
    expect(fixed('90071992547409.92').add('0.01').toString()).toBe('90071992547409.93');
    expect(fixed('125000000000000.00').add('0.01').toString()).toBe('125000000000000.01');
    expect(fixed('92233720368547758.07').toScaled().value).toBe(9223372036854775807n);
  });

  it('negatives and float input', () => {
    expect(fixed('-5.00').add('2.50').toString()).toBe('-2.50');
    expect(fixed('2.50').subtract('5.00').toString()).toBe('-2.50');
    expect(fixed('0.10').add('0.20').toString()).toBe('0.30');
    const awkwardFloats = [0.07, 0.29, 0.57, 1.13, 1.15, 2.01, 4.35, 8.2, 9.95, 19.99, 100.5, 1234.56];
    for (const value of awkwardFloats) {
      expect(fixed(value, { scale: 2 }).toString()).toBe(value.toFixed(2));
    }
  });
});

describe('Fixed and Money', () => {
  it('converts both ways exactly, and rounds into a currency only when asked to', () => {
    const price = money('12.34', 'EUR');
    expect(price.toFixedPoint().toString()).toBe('12.34');
    expect(price.toFixedPoint().toMoney('EUR').equals(price)).toBe(true);
    expect(fixed('100').toMoney('JPY').toDecimal()).toBe('100');
    expect(fixed('1.5').toMoney('EUR').toDecimal()).toBe('1.50');
    expect(() => fixed('1.005').toMoney('EUR')).toThrow(RoundingError);
    expect(fixed('1.005').toMoney('EUR', 'halfEven').toDecimal()).toBe('1.00');
    expect(fixed('1.234').toMoney('KWD').toDecimal()).toBe('1.234');
    // a bigint value at a high scale rounds once into the currency
    const big = fromScaled(123456789012345678901234567890n, 10);
    expect(big.toMoney('EUR', 'halfEven').toDecimal()).toBe('12345678901234567890.12');
    expect(() => big.toMoney('EUR')).toThrow(RoundingError);
  });

  it('round-trips any Money', () => {
    fc.assert(
      fc.property(scaledValue, fc.constantFrom('EUR', 'JPY', 'KWD', 'CLF'), (minor, currency) => {
        const amount = fromMinor(minor, currency);
        const back = amount.toFixedPoint().toMoney(currency);
        expect(back.equals(amount) && back.scale === amount.scale).toBe(true);
        expect(amount.toFixedPoint().toString()).toBe(amount.toDecimal());
      }),
    );
  });
});

describe('Fixed properties against a bigint rational oracle', () => {
  it('add and subtract are exact', () => {
    fc.assert(
      fc.property(anyFixed, anyFixed, (first, second) => {
        const [firstNum, firstDen] = exactOf(first);
        const [secondNum, secondDen] = exactOf(second);
        const sum = first.add(second);
        const difference = first.subtract(second);
        expect(sum.scale).toBe(Math.max(first.scale, second.scale));
        // value / 10^scale equals the exact rational sum, cross-multiplied
        const [sumNum, sumDen] = exactOf(sum);
        expect(sumNum * firstDen * secondDen).toBe((firstNum * secondDen + secondNum * firstDen) * sumDen);
        const [differenceNum, differenceDen] = exactOf(difference);
        expect(differenceNum * firstDen * secondDen).toBe(
          (firstNum * secondDen - secondNum * firstDen) * differenceDen,
        );
      }),
    );
  });

  it('multiply rounds the exact product once', () => {
    fc.assert(
      fc.property(anyFixed, anyFixed, mode, scale, (value, factor, rounding, target) => {
        const [valueNum, valueDen] = exactOf(value);
        const [factorNum, factorDen] = exactOf(factor);
        const expected = oracleAtScale(valueNum * factorNum, valueDen * factorDen, value.scale, rounding);
        expect(BigInt(value.multiply(factor, rounding).value)).toBe(expected);
        const atTarget = oracleAtScale(valueNum * factorNum, valueDen * factorDen, target, rounding);
        expect(BigInt(value.multiply(factor, rounding, { scale: target }).value)).toBe(atTarget);
      }),
      { numRuns: 2000 },
    );
  });

  it('divide rounds the exact quotient once', () => {
    fc.assert(
      fc.property(anyFixed, anyFixed, mode, scale, (value, divisor, rounding, target) => {
        fc.pre(!divisor.isZero());
        const [valueNum, valueDen] = exactOf(value);
        const [divisorNum, divisorDen] = exactOf(divisor);
        const expected = oracleAtScale(valueNum * divisorDen, valueDen * divisorNum, value.scale, rounding);
        expect(BigInt(value.divide(divisor, rounding).value)).toBe(expected);
        const atTarget = oracleAtScale(valueNum * divisorDen, valueDen * divisorNum, target, rounding);
        expect(BigInt(value.divide(divisor, rounding, { scale: target }).value)).toBe(atTarget);
      }),
      { numRuns: 2000 },
    );
  });

  it('toScale and round match the oracle, and unnecessary throws exactly when inexact', () => {
    fc.assert(
      fc.property(anyFixed, scale, fc.constantFrom(...ALL_MODES), (value, target, rounding) => {
        const [valueNum, valueDen] = exactOf(value);
        let expected: bigint | 'throws';
        try {
          expected = oracleAtScale(valueNum, valueDen, target, rounding);
        } catch {
          expected = 'throws';
        }
        if (expected === 'throws') {
          expect(() => value.toScale(target, rounding)).toThrow(RoundingError);
        } else {
          expect(BigInt(value.toScale(target, rounding).value)).toBe(expected);
          expect(BigInt(value.round(rounding, target).value)).toBe(expected);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('compare and equals agree with the exact order', () => {
    fc.assert(
      fc.property(anyFixed, anyFixed, (first, second) => {
        const [firstNum, firstDen] = exactOf(first);
        const [secondNum, secondDen] = exactOf(second);
        const left = firstNum * secondDen;
        const right = secondNum * firstDen;
        let expected = 0;
        if (left < right) {
          expected = -1;
        } else if (left > right) {
          expected = 1;
        }
        expect(first.compare(second)).toBe(expected);
        expect(first.equals(second)).toBe(expected === 0);
        expect(first.lessThan(second)).toBe(expected < 0);
        expect(first.greaterThanOrEqual(second)).toBe(expected >= 0);
      }),
    );
  });

  it('values are numbers exactly when they are safe integers', () => {
    fc.assert(
      fc.property(anyFixed, anyFixed, mode, scale, (first, second, rounding, target) => {
        const results = [
          first.add(second),
          first.subtract(second),
          first.multiply(second, rounding),
          first.negate(),
          first.toScale(target, rounding),
          fromScaled(BigInt(first.value), first.scale),
        ];
        if (!second.isZero()) {
          results.push(first.divide(second, rounding), first.divide(second, rounding, { scale: target }));
        }
        for (const result of results) {
          const isSafe =
            Number.isSafeInteger(Number(result.value)) && BigInt(Number(result.value)) === BigInt(result.value);
          expect(typeof result.value === 'number').toBe(isSafe);
        }
      }),
    );
  });

  it('fixed(number) is exact for every number with at most 15 significant digits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -(10 ** 15) + 1, max: 10 ** 15 - 1 }),
        fc.integer({ min: -30, max: 20 }),
        (digits, exponent) => {
          const decimal = `${digits}e${exponent}`;
          const value = Number(decimal);
          fc.pre(Number.isFinite(value));
          expect(fixed(value).equals(fixed(decimal))).toBe(true);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('toString and fixed() round-trip', () => {
    fc.assert(
      fc.property(anyFixed, (value) => {
        const back = fixed(value.toString());
        expect(back.equals(value) && back.scale === value.scale).toBe(true);
      }),
    );
  });
});

describe('Python decimal vectors, through Fixed', () => {
  interface VectorCase {
    op: string;
    currency: string;
    minor: string;
    mode: RoundingMode;
    factor?: string;
    divisor?: string;
    scale?: number;
    want: string | [string, string];
  }
  const vectorPath = join(import.meta.dirname, 'vectors', 'pydecimal.json');
  const { cases } = JSON.parse(readFileSync(vectorPath, 'utf8')) as { cases: VectorCase[] };
  // The currency-free operations: the value is the minor units at the currency's exponent.
  const fixedCases = cases.filter((vector) => ['multiply', 'divide', 'toScale'].includes(vector.op));

  it('covers every multiply, divide and toScale vector', () => {
    expect(fixedCases.length).toBeGreaterThan(0);
    for (const vector of fixedCases) {
      const value = fromScaled(BigInt(vector.minor), currencyExponent(vector.currency));
      let result: Fixed;
      if (vector.op === 'multiply') {
        result = value.multiply(vector.factor!, vector.mode);
      } else if (vector.op === 'divide') {
        result = value.divide(vector.divisor!, vector.mode);
      } else {
        result = value.toScale(vector.scale!, vector.mode);
      }
      expect([vector, String(result.value)]).toEqual([vector, vector.want]);
    }
  });
});
