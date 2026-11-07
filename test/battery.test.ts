// The cross-library correctness battery (compare/battery/vectors.ts, the same vectors `pnpm compare`
// runs against the other money and decimal libraries), run against ducat, plus explicit regressions
// for each bug found in those libraries, so ducat never acquires one. Expected values are exact
// decimal strings worked out by hand, not taken from any library.
import { describe, expect, it } from 'vitest';
import { ducatLibrary } from '../compare/battery/ducat.ts';
import { runVector, VECTORS } from '../compare/battery/vectors.ts';
import {
  add,
  allocate,
  CurrencyMismatchError,
  fromMinor,
  money,
  multiply,
  RoundingError,
  split,
  subtract,
  type Money,
} from '../src/fn.js';

function decimalOf(amount: Money): string {
  return amount.toDecimal();
}

function decimalsOf(amounts: Money[]): string[] {
  return amounts.map(decimalOf);
}

/** Exact sum of decimal strings, computed in bigint at the widest scale, without ducat. */
function sumOfDecimals(values: string[]): string {
  const fractionLengths = values.map((value) => (value.split('.')[1] ?? '').length);
  const scale = Math.max(0, ...fractionLengths);

  let total = 0n;
  for (const value of values) {
    const isNegative = value.startsWith('-');
    const [integerPart, fractionPart = ''] = value.replace('-', '').split('.');
    const units = BigInt(integerPart! + fractionPart.padEnd(scale, '0'));
    total += isNegative ? -units : units;
  }

  const isNegative = total < 0n;
  const magnitude = isNegative ? -total : total;
  let digits = magnitude.toString().padStart(scale + 1, '0');
  if (scale > 0) {
    digits = digits.slice(0, -scale) + '.' + digits.slice(-scale);
  }
  return isNegative ? '-' + digits : digits;
}

describe('cross-library battery: ducat passes every vector', () => {
  const cases = VECTORS.map((vector) => [`${vector.id}: ${vector.description}`, vector] as const);

  it.each(cases)('%s', (_, vector) => {
    const result = runVector(vector, ducatLibrary);
    expect(result).toMatchObject({ outcome: 'pass' });
  });
});

// Bugs found in other libraries by the battery and by targeted probes. Each test names the library
// and the wrong result it gave, so the intent survives if the expected values ever look arbitrary.
describe('regressions from other libraries', () => {
  it('monetra: allocating a negative amount loses a cent (-100.00 / 3 gave -33.33 x3)', () => {
    const cases = [
      ['-100.00', [1, 1, 1]],
      ['-0.05', [70, 30]],
      ['-0.01', [1, 1, 1]],
      ['-1.00', [1, 2, 3, 4, 5, 6, 7]],
    ] as const;

    for (const [amount, weights] of cases) {
      const parts = decimalsOf(allocate(money(amount, 'EUR'), weights));
      expect(sumOfDecimals(parts)).toBe(amount);

      // the mirror image of the positive allocation
      const positiveAmount = amount.slice(1);
      const positiveParts = decimalsOf(allocate(money(positiveAmount, 'EUR'), weights));
      const mirrored = positiveParts.map((part) => (part === '0.00' ? part : '-' + part));
      expect(parts).toEqual(mirrored);
    }
  });

  it('@screeny05/ts-money: 1- and 2-cent splits crash', () => {
    for (const cents of [1, 2]) {
      for (const count of [2, 3, 4, 7]) {
        const parts = split(fromMinor(cents, 'EUR'), count);
        expect(parts).toHaveLength(count);
        const total = parts.reduce((sum, part) => sum + Number(part.minor), 0);
        expect(total).toBe(cents);
      }

      const threeWays = allocate(fromMinor(cents, 'EUR'), [1, 1, 1]).map((part) => part.minor);
      const expected = cents === 1 ? [1, 0, 0] : [1, 1, 0];
      expect(threeWays).toEqual(expected);
    }
  });

  it('js-money / ts-money: fromDecimal(1.15) gave 114 cents (1.15 * 100 = 114.99999999999999)', () => {
    expect(money(1.15, 'EUR').minor).toBe(115);
    expect(money('1.15', 'EUR').minor).toBe(115);

    // other values whose x * 100 is not an integer in binary floating point
    const awkwardFloats = [0.07, 0.29, 0.57, 1.13, 2.01, 4.35, 8.2, 9.95, 19.99, 100.5, 1234.56];
    for (const value of awkwardFloats) {
      expect(decimalOf(money(value, 'EUR'))).toBe(value.toFixed(2));
    }
  });

  it.each([
    ['0.50', '1.15', 'halfExpand', '0.58', '57.49999999999999'],
    ['0.45', '0.7', 'halfExpand', '0.32', '31.499999999999996'],
    ['1.15', '1.1', 'halfEven', '1.26', '126.50000000000001'],
    ['0.90', '1.15', 'halfExpand', '1.04', '103.49999999999999'],
    ['0.25', '1.1', 'halfTrunc', '0.27', '27.500000000000004'],
  ] as const)(
    'float multiply trap: %s x %s (%s) = %s (float product %s)',
    (amount, factor, mode, expected, floatProduct) => {
      // what a float-based library computes: integer cents times a float factor
      const cents = Math.round(Number(amount) * 100);
      expect(String(cents * Number(factor))).toBe(floatProduct);

      expect(decimalOf(multiply(money(amount, 'EUR'), factor, mode))).toBe(expected);

      // a JS number factor is read at its shortest decimal form, so it is exact too
      expect(decimalOf(multiply(money(amount, 'EUR'), Number(factor), mode))).toBe(expected);
    },
  );

  it('currency.js: half-up on a negative tie rounds toward zero (-0.125 gave -0.12)', () => {
    expect(decimalOf(multiply(money('-0.25', 'EUR'), '0.5', 'halfExpand'))).toBe('-0.13');
  });

  it('currency.js: "1000.5" JPY was silently rounded to 1001', () => {
    expect(() => money('1000.5', 'JPY')).toThrow(RoundingError);
  });

  it('dinero.js / currency.js / js-money: amounts above 2^53 lose cents', () => {
    const cases: [string, bigint][] = [
      ['90071992547409.93', 2n ** 53n + 1n],
      ['90071992547409.91', 2n ** 53n - 1n],
      ['-90071992547409.93', -(2n ** 53n + 1n)],
      ['125000000000000.01', 12500000000000001n],
      ['92233720368547758.07', 2n ** 63n - 1n],
      ['-92233720368547758.08', -(2n ** 63n)],
    ];
    const oneCent = money('0.01', 'EUR');

    for (const [decimal, minorUnits] of cases) {
      const amount = money(decimal, 'EUR');
      expect(amount.toMinor()).toBe(minorUnits);
      expect(decimalOf(amount)).toBe(decimal);
      expect(decimalOf(fromMinor(minorUnits, 'EUR'))).toBe(decimal);
      expect(decimalOf(subtract(add(amount, oneCent), oneCent))).toBe(decimal);
    }
  });

  it('monetra: CLF has 4 decimals, not 2', () => {
    expect(decimalOf(fromMinor(12345, 'CLF'))).toBe('1.2345');
  });

  it('decimal libraries: mixing currencies is not silently allowed', () => {
    const euro = money('1', 'EUR') as Money<string>;
    const pound = money('1', 'GBP') as Money<string>;
    expect(() => subtract(euro, pound)).toThrow(CurrencyMismatchError);

    const mixedParts = [...allocate(euro, [1]), ...split(pound, 1)];
    expect(() => mixedParts.reduce(add)).toThrow(CurrencyMismatchError);
  });
});
