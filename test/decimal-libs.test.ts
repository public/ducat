// Regression tests for bugs the JavaScript decimal libraries have had: decimal.js, decimal.js-light,
// big.js and bignumber.js. Each case is a bug reported in that library's issues or fixed in its
// history, reproduced against ducat's Fixed (and Money where the operation is Money's).
import { describe, expect, it } from 'vitest';
import '../src/plugins/all.js';
import { fixed, fromScaled, type Fixed } from '../src/fixed.js';
import { money, roundToIncrement, type RoundingMode } from '../src/fn.js';

const MODES: readonly RoundingMode[] = [
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

/** The reference: rounds value / 10^drop to an integer by the mode's definition, with bigints. */
function reference(value: bigint, drop: number, mode: RoundingMode): bigint {
  const divisor = 10n ** BigInt(drop);
  const quotient = value / divisor; // truncated toward zero
  const remainder = value % divisor;
  if (remainder === 0n) {
    return quotient;
  }
  const negative = value < 0n;
  const away = quotient + (negative ? -1n : 1n);
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  const tie = twice === divisor;
  const aboveHalf = twice > divisor;
  switch (mode) {
    case 'trunc':
      return quotient;
    case 'expand':
      return away;
    case 'ceil':
      return negative ? quotient : away;
    case 'floor':
      return negative ? away : quotient;
    case 'halfExpand':
      return aboveHalf || tie ? away : quotient;
    case 'halfTrunc':
      return aboveHalf ? away : quotient;
    case 'halfCeil':
      return aboveHalf || (tie && !negative) ? away : quotient;
    case 'halfFloor':
      return aboveHalf || (tie && negative) ? away : quotient;
    case 'halfEven':
      return aboveHalf || (tie && quotient % 2n !== 0n) ? away : quotient;
    default:
      throw new Error(mode);
  }
}

const isNegativeZero = (value: Fixed) => Object.is(value.toScaled().value, -0);

describe('every rounding mode, both signs, every kind of remainder', () => {
  // decimal.js 277e8a8 and PR #267: floor and ceiling used the wrong sign for negatives.
  // decimal.js PR #88: toNearest silently swapped up/down/ceil/floor for the half modes.
  const remainders = ['0', '1', '4999', '5000', '5001', '9999'];
  const cases = MODES.flatMap((mode) =>
    ['', '-'].flatMap((sign) =>
      ['2', '3'].flatMap((whole) =>
        remainders.map((tail) => ({ mode, text: `${sign}${whole}.${tail.padStart(4, '0')}` })),
      ),
    ),
  );
  it.each(cases)('$text rounded $mode to 0 places', ({ mode, text }) => {
    const value = fixed(text);
    const expected = reference(BigInt(text.replace('.', '')), 4, mode);
    expect(value.round(mode).toString()).toBe(expected.toString());
  });

  it('matches the reference on directed modes for negatives, as in decimal.js PR #267', () => {
    expect(fixed('-1.5707963').toScale(2, 'ceil').toString()).toBe('-1.57');
    expect(fixed('-1.5707963').toScale(2, 'floor').toString()).toBe('-1.58');
    expect(fixed('-2.5').round('halfCeil').toString()).toBe('-2');
    expect(fixed('-2.5').round('halfFloor').toString()).toBe('-3');
  });
});

describe('carries and digits below the rounding position', () => {
  // bignumber.js #388, big.js #191: a carry into a new leading digit got the wrong exponent or
  // left junk in the digit array
  it.each([
    ['9.995', 2, 'halfExpand', '10.00', 1000],
    ['-9.995', 2, 'halfExpand', '-10.00', -1000],
    ['999.5', 0, 'halfEven', '1000', 1000],
    ['9.99', 1, 'halfExpand', '10.0', 100],
    ['0.0999', 2, 'expand', '0.10', 10],
  ] as const)('%s to %i places %s is %s, in canonical form', (text, scale, mode, string, value) => {
    const rounded = fixed(text).toScale(scale, mode);
    expect(rounded.toString()).toBe(string);
    expect(rounded.toScaled()).toEqual({ value, scale });
  });

  // decimal.js 277e8a8, bignumber.js c843791: rounding up a value with every digit below the
  // kept place gave the wrong power of ten
  it.each([
    ['0.00001', 1, 'expand', '0.1'],
    ['0.00001', 1, 'ceil', '0.1'],
    ['-0.00001', 1, 'floor', '-0.1'],
    ['0.0004', 2, 'ceil', '0.01'],
    ['0.00001', 1, 'halfExpand', '0.0'],
  ] as const)('%s to %i places %s is %s', (text, scale, mode, string) => {
    expect(fixed(text).toScale(scale, mode).toString()).toBe(string);
  });
});

describe('ties are decided exactly', () => {
  // bignumber.js #412, decimal.js #272: ties judged from one discarded digit or guard digits
  it.each([
    ['2.5000', 'halfEven', '2'],
    ['2.5001', 'halfEven', '3'],
    ['2.4999', 'halfEven', '2'],
    ['2.5000', 'halfTrunc', '2'],
    ['2.5001', 'halfTrunc', '3'],
    ['2.4999', 'halfExpand', '2'],
    ['2.50000000000000000000000000001', 'halfTrunc', '3'],
    ['2.49999999999999999999999999999', 'halfExpand', '2'],
  ] as const)('%s %s is %s', (text, mode, string) => {
    expect(fixed(text).round(mode).toString()).toBe(string);
  });

  it('decides a division tie from the exact remainder', () => {
    // 1 / 8 = 0.125: a tie at 2 places; 1 / 7.999… is just above it
    expect(fixed('1').divide(8, 'halfEven', { scale: 2 }).toString()).toBe('0.12');
    expect(fixed('1').divide('7.99999999999999999999', 'halfEven', { scale: 2 }).toString()).toBe(
      '0.13',
    );
    expect(fixed('1').divide('8.00000000000000000001', 'halfExpand', { scale: 2 }).toString()).toBe(
      '0.12',
    );
  });
});

describe('division', () => {
  // bignumber.js #58: the quotient-digit estimate wasn't corrected, so division ran out of memory
  it('divides by a near-half divisor correctly and quickly', () => {
    const started = performance.now();
    const quotient = fixed('1').divide('0.50000025000012500006', 'halfExpand', { scale: 20 });
    expect(quotient.toString()).toBe('1.99999900000000000001');
    expect(performance.now() - started).toBeLessThan(200);
  });

  // decimal.js #247: integer division ignored the rounding mode and always truncated
  it.each([
    ['-18', '2.1', 'floor', '-9'],
    ['18', '-2.1', 'floor', '-9'],
    ['-18', '-2.1', 'floor', '8'],
    ['-18', '2.1', 'ceil', '-8'],
    ['-18', '2.1', 'trunc', '-8'],
    ['-18', '2.1', 'expand', '-9'],
  ] as const)('%s / %s rounded %s to an integer is %s', (dividend, divisor, mode, string) => {
    expect(fixed(dividend).divide(divisor, mode, { scale: 0 }).toString()).toBe(string);
  });

  // bignumber.js #342: work grew with the configured precision, not with the input
  it('takes no time for an exact result at a large scale', () => {
    const started = performance.now();
    expect(fixed('2').divide(4, 'unnecessary', { scale: 400 }).toScale(2).toString()).toBe('0.50');
    expect(performance.now() - started).toBeLessThan(200);
  });

  // bignumber.js #347: repeated halving at a fixed scale stops moving; ducat rounds each step,
  // so it does too, and says so: an exact result needs a scale that holds it
  it('throws for an inexact division asked to be exact', () => {
    expect(() => fixed('0.01').divide(2, 'unnecessary')).toThrow();
    expect(fixed('0.01').divide(2, 'unnecessary', { scale: 3 }).toString()).toBe('0.005');
  });
});

describe('zero has no sign', () => {
  // bignumber.js faa6003, big.js 2.4.1: x + (−x) was −0; decimal.js #273: −0 under floor
  // rounding kept an internal loop from ending
  it.each(MODES)('x − x and −x + x are a plain zero, rounding %s', (mode) => {
    const value = fixed('-1.25');
    expect(isNegativeZero(value.subtract(value))).toBe(false);
    expect(isNegativeZero(value.add(value.negate()))).toBe(false);
    expect(isNegativeZero(value.multiply('0.001', mode))).toBe(false);
    expect(isNegativeZero(fixed('-0.4').round(mode))).toBe(false);
  });

  // bignumber.js #405, decimal.js #223: −0.01 to 1 place printed "-0.0"
  it('never prints a negative zero', () => {
    expect(fixed('-0.01').toScale(1, 'halfExpand').toString()).toBe('0.0');
    expect(fixed('-0').toString()).toBe('0');
    expect(fixed(-0).toString()).toBe('0');
    expect(fixed('0').negate().toString()).toBe('0');
    expect(fromScaled(-0, 2).toString()).toBe('0.00');
  });

  // decimal.js #62, #218: isPositive(0) was true
  it('is neither positive nor negative', () => {
    expect(fixed('0').isPositive()).toBe(false);
    expect(fixed('-0').isNegative()).toBe(false);
    expect(fixed('0.000').sign()).toBe(0);
  });
});

describe('exact arithmetic at any size', () => {
  // decimal.js #102, #157: add and subtract were rounded to 20 significant digits
  it('adds without a precision limit', () => {
    expect(fixed('100.000000000000000000').add('0.000000000000000001').toString()).toBe(
      '100.000000000000000001',
    );
    expect(fixed('123456789012345678901234567890.5').subtract('0.25').toString()).toBe(
      '123456789012345678901234567890.25',
    );
    expect(fixed('99999999999999999999').multiply('99999999999999999999').toString()).toBe(
      '9999999999999999999800000000000000000001',
    );
  });

  // decimal.js #121: the number fast path skipped the checks the string path made
  it('gives the same value for a number and its string', () => {
    for (const value of [0, 1, 1000, -7, 2 ** 52, 0.5, 1.005, 123.456]) {
      expect(fixed(value).toScaled()).toEqual(fixed(String(value)).toScaled());
    }
  });

  // decimal.js #61, #200; big.js #83: a number is read at its shortest decimal form
  it('reads a number at its shortest decimal form, documented', () => {
    expect(fixed(1.005).toString()).toBe('1.005');
    expect(fixed(1.005).toScale(2, 'halfExpand').toString()).toBe('1.01');
    expect(() => fixed(0.1 + 0.2)).toThrow();
  });
});

describe('huge exponents are rejected up front', () => {
  // big.js #161: '528256e40000640005774827' parsed, then toFixed() crashed the tab; big.js #89
  it.each(['1e999999999', '1e-999999999', '528256e40000640005774827', `0.${'1'.repeat(5000)}`])(
    '%s throws quickly',
    (text) => {
      const started = performance.now();
      expect(() => fixed(text)).toThrow();
      expect(() => money(text, 'EUR')).toThrow();
      expect(performance.now() - started).toBeLessThan(200);
    },
  );
});

describe('rounding to an increment', () => {
  // decimal.js PR #88: toNearest mapped up/down/ceil/floor to the half modes
  it('honours the directed modes', () => {
    expect(
      roundToIncrement(
        money('449.999', 'EUR', { scale: 3 }),
        money('100', 'EUR'),
        'expand',
      ).toString(),
    ).toBe('500.000 EUR');
    expect(
      roundToIncrement(
        money('3847561.00000749', 'EUR', { scale: 8 }),
        money('10', 'EUR'),
        'expand',
      ).toString(),
    ).toBe('3847570.00000000 EUR');
    expect(
      roundToIncrement(
        money('-449.999', 'EUR', { scale: 3 }),
        money('100', 'EUR'),
        'floor',
      ).toString(),
    ).toBe('-500.000 EUR');
    expect(
      roundToIncrement(
        money('-449.999', 'EUR', { scale: 3 }),
        money('100', 'EUR'),
        'ceil',
      ).toString(),
    ).toBe('-400.000 EUR');
  });

  // bignumber.js PR #414: zero rounded to a power of ten "rounded away" to that power
  it.each(MODES)('keeps zero at zero, rounding %s', (mode) => {
    expect(roundToIncrement(money('0', 'EUR'), money('100', 'EUR'), mode).minor).toBe(0);
  });
});

describe('defaults', () => {
  // big.js #169, decimal.js #26: the default rounding mode was read from the wrong place
  it('uses halfExpand wherever a mode is optional', () => {
    expect(fixed('1.5').toScale(0).toString()).toBe('2');
    expect(fixed('-1.5').toScale(0).toString()).toBe('-2');
    expect(fixed('1.25').multiply(1, undefined, { scale: 1 }).toString()).toBe('1.3');
    expect(fixed('1').divide(8, undefined, { scale: 2 }).toString()).toBe('0.13');
    expect(money('10', 'EUR').divide(8).toString()).toBe('1.25 EUR');
    expect(money('0.10', 'EUR').divide(8).toString()).toBe('0.01 EUR');
  });
});
