// Cross-library correctness battery: every vector that was run against ducat and 16 other money
// and decimal libraries, plus explicit regressions for each bug found in those libraries, so ducat
// never acquires one. Expected values are exact decimal strings worked out by hand, not taken from
// any library.
import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  compare,
  convert,
  CurrencyMismatchError,
  currencyExponent,
  divide,
  equals,
  extractTax,
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

/** Sorted copy, for comparing split results as multisets: part order is a remainder policy. */
function sortedCopy(values: string[]): string[] {
  return values.toSorted();
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

describe('battery: currencies and minor units', () => {
  it.each([
    ['JPY', 0],
    ['KWD', 3],
    ['CLF', 4],
    ['ISK', 0],
    ['EUR', 2],
  ])('exponent of %s is %i', (currency, exponent) => {
    expect(currencyExponent(currency)).toBe(exponent);
  });

  it('jpy-1000: 1000 JPY round-trips', () => {
    expect(decimalOf(fromMinor(1000, 'JPY'))).toBe('1000');
  });

  it('jpy-frac: "1000.5" JPY is rejected, not rounded', () => {
    expect(() => money('1000.5', 'JPY')).toThrow(RoundingError);
    expect(() => money(1000.5, 'JPY')).toThrow(RoundingError);
  });

  it('kwd-1.234: 1234 fils is 1.234 KWD', () => {
    expect(decimalOf(fromMinor(1234, 'KWD'))).toBe('1.234');
    expect(money('1.234', 'KWD').minor).toBe(1234);
  });

  it('kwd-split3', () => {
    const parts = decimalsOf(split(money('1.000', 'KWD'), 3));
    expect(sortedCopy(parts)).toEqual(sortedCopy(['0.334', '0.333', '0.333']));
  });

  it('jpy-split3', () => {
    const parts = decimalsOf(split(money('100', 'JPY'), 3));
    expect(sortedCopy(parts)).toEqual(sortedCopy(['34', '33', '33']));
  });
});

describe('battery: allocation', () => {
  it('split3', () => {
    expect(decimalsOf(split(money('100.00', 'EUR'), 3))).toEqual(['33.34', '33.33', '33.33']);
  });

  it('split3-neg', () => {
    const parts = decimalsOf(split(money('-100.00', 'EUR'), 3));
    expect(parts).toEqual(['-33.34', '-33.33', '-33.33']);
  });

  it('split-cent', () => {
    expect(decimalsOf(split(money('0.01', 'EUR'), 3))).toEqual(['0.01', '0.00', '0.00']);
  });

  it('alloc-zero-w: a zero weight gets nothing', () => {
    const parts = decimalsOf(allocate(money('10.00', 'EUR'), [1, 0, 1]));
    expect(parts).toEqual(['5.00', '0.00', '5.00']);
  });

  it('alloc-fuzz: 2,000 seeded allocations sum to the whole, each part within one unit', () => {
    // a linear congruential generator, in bigint: the product overflows 2^53 as a double
    let state = 12345n;
    function randomBelow(limit: number): number {
      state = (state * 1103515245n + 12345n) % 2147483648n;
      return Number(state % BigInt(limit));
    }

    for (let i = 0; i < 2000; i++) {
      const amountMinor = randomBelow(1_000_000_000) - 100_000_000;
      const weightCount = 2 + randomBelow(6);
      const weights = Array.from({ length: weightCount }, () => 1 + randomBelow(1000));
      const totalWeight = weights.reduce((total, weight) => total + weight, 0);

      const whole = fromMinor(amountMinor, 'EUR');
      const parts = allocate(whole, weights);
      expect(sumOfDecimals(decimalsOf(parts))).toBe(decimalOf(whole));

      // |part * W - amount * weight| < W, in exact bigint
      for (let k = 0; k < parts.length; k++) {
        const scaledPart = BigInt(parts[k]!.minor) * BigInt(totalWeight);
        const scaledShare = BigInt(amountMinor) * BigInt(weights[k]!);
        const error = scaledPart - scaledShare;
        expect(error < BigInt(totalWeight)).toBe(true);
        expect(error > -BigInt(totalWeight)).toBe(true);
      }
    }
  });
});

describe('battery: tax', () => {
  it('vat-12: 12.00 GBP / 1.2 = 10.00', () => {
    expect(decimalOf(divide(money('12.00', 'GBP'), '1.2', 'halfEven'))).toBe('10.00');
  });

  it('vat-9.99-even: 8.325 -> 8.32', () => {
    expect(decimalOf(divide(money('9.99', 'GBP'), '1.2', 'halfEven'))).toBe('8.32');
  });

  it('vat-9.99-up: 8.325 -> 8.33', () => {
    expect(decimalOf(divide(money('9.99', 'GBP'), '1.2', 'halfExpand'))).toBe('8.33');
  });

  it('vat-119: 119.00 EUR / 1.19 = 100.00', () => {
    expect(decimalOf(divide(money('119.00', 'EUR'), '1.19', 'halfEven'))).toBe('100.00');
  });

  it('extractTax agrees with divide and adds up', () => {
    const breakdown = extractTax(money('9.99', 'GBP'), 20, 'halfEven');
    const parts = [breakdown.net, breakdown.tax, breakdown.gross].map(decimalOf);
    expect(parts).toEqual(['8.32', '1.67', '9.99']);
  });
});

describe('battery: rounding at .5 boundaries', () => {
  it.each([
    ['0.25', '0.5', 'halfEven', '0.12'],
    ['0.25', '0.5', 'halfExpand', '0.13'],
    ['-0.25', '0.5', 'halfExpand', '-0.13'],
    ['-0.25', '0.5', 'halfEven', '-0.12'],
  ] as const)('%s x %s (%s) = %s', (amount, factor, mode, expected) => {
    expect(decimalOf(multiply(money(amount, 'EUR'), factor, mode))).toBe(expected);
  });

  it('fx-jpy: 100.00 EUR at 162.457 -> 16246 JPY', () => {
    const converted = convert(money('100.00', 'EUR'), 'JPY', '162.457', 'halfExpand');
    expect(decimalOf(converted)).toBe('16246');
  });

  it('fx-float: 1.15 EUR at 1.1 -> 1.26 USD (float gives 1.27)', () => {
    const converted = convert(money('1.15', 'EUR'), 'USD', '1.1', 'halfEven');
    expect(decimalOf(converted)).toBe('1.26');
  });
});

describe('battery: amounts beyond 2^53', () => {
  it('big-2^53+1 cents round-trips', () => {
    expect(decimalOf(money('90071992547409.93', 'EUR'))).toBe('90071992547409.93');
    expect(money('90071992547409.93', 'EUR').toMinor()).toBe(9007199254740993n);
    expect(decimalOf(fromMinor(9007199254740993n, 'EUR'))).toBe('90071992547409.93');
  });

  it('big-add: 2^53 cents + 0.01', () => {
    const total = add(money('90071992547409.92', 'EUR'), money('0.01', 'EUR'));
    expect(decimalOf(total)).toBe('90071992547409.93');
  });

  it('gdp: 1.25e16 cents + 0.01', () => {
    const total = add(money('125000000000000.00', 'USD'), money('0.01', 'USD'));
    expect(decimalOf(total)).toBe('125000000000000.01');
  });

  it('gdp-split3 sums to the whole', () => {
    const parts = decimalsOf(split(money('125000000000000.00', 'USD'), 3));
    expect(sumOfDecimals(parts)).toBe('125000000000000.00');
    expect(parts).toEqual(['41666666666666.67', '41666666666666.67', '41666666666666.66']);
  });

  it('bigint-max: BIGINT max cents round-trips', () => {
    const bigintMax = money('92233720368547758.07', 'EUR');
    expect(decimalOf(bigintMax)).toBe('92233720368547758.07');
    expect(bigintMax.toMinor()).toBe(9223372036854775807n);
  });
});

describe('battery: negatives', () => {
  it('neg-add', () => {
    expect(decimalOf(add(money('-5.00', 'EUR'), money('2.50', 'EUR')))).toBe('-2.50');
  });

  it('neg-sub', () => {
    expect(decimalOf(subtract(money('2.50', 'EUR'), money('5.00', 'EUR')))).toBe('-2.50');
  });

  it('neg-small', () => {
    expect(decimalOf(money('-0.05', 'EUR'))).toBe('-0.05');
  });
});

describe('battery: float input', () => {
  it('float-in: money(0.1 + 0.2) is rejected', () => {
    expect(() => money(0.1 + 0.2, 'EUR')).toThrow(RoundingError);
  });

  it('dec-add: 0.10 + 0.20 = 0.30 exactly', () => {
    expect(decimalOf(add(money('0.10', 'EUR'), money('0.20', 'EUR')))).toBe('0.30');
  });

  it('float-1.005: money(1.005) is the decimal 1.005, so it is rejected at scale 2', () => {
    expect(() => money(1.005, 'EUR')).toThrow(RoundingError);
    expect(decimalOf(money(1.005, 'EUR', { scale: 3 }))).toBe('1.005');
  });
});

describe('battery: currency mismatch', () => {
  const euro = money('1.00', 'EUR') as Money<string>;
  const dollar = money('1.00', 'USD') as Money<string>;

  it('mix-add throws', () => {
    expect(() => add(euro, dollar)).toThrow(CurrencyMismatchError);
  });

  it('mix-cmp throws', () => {
    expect(() => compare(euro, dollar)).toThrow(CurrencyMismatchError);
  });

  it('mix-eq is false', () => {
    expect(equals(euro, dollar)).toBe(false);
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
