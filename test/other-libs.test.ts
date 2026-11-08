// Regression tests for bugs other JavaScript money libraries have had: dinero.js, currency.js and
// js-money (with its TypeScript port, ts-money). Each case is a bug reported in that library's
// issues or fixed in its history, reproduced against ducat. Links are to the original report.
import { describe, expect, it } from 'vitest';
import '../src/plugins/all.js';
import {
  allocate,
  currencyExponent,
  divide,
  fromMinor,
  isCurrency,
  isPositive,
  money,
  multiply,
  parse,
  roundToIncrement,
  split,
  toDecimal,
  toScale,
  type Money,
} from '../src/fn.js';
import { format } from '../src/format.js';

const minors = (parts: Money[]): (number | bigint)[] => parts.map((part) => part.minor);
const strings = (parts: Money[]): string[] => parts.map((part) => part.toString());

describe('decimal input is never scaled through a float', () => {
  // js-money #10, #28, #33, #35, ts-money #1: 78.43 * 100 is 7843.000000000001 in floating point
  it.each(['78.43', '142.45', '16.90', '8.45', '2067.22', '17.955', '300.15'])(
    'money(%s) keeps every digit',
    (amount) => {
      const scale = amount.split('.')[1]!.length;
      const result = money(amount, 'EUR', { scale, rounding: 'unnecessary' });
      expect(toDecimal(result)).toBe(amount);
    },
  );

  // js-money: 1.005 * 100 is 100.49999999999999, so rounding half up gave 100
  it('rounds 1.005 to 1.01, half away from zero', () => {
    expect(money('1.005', 'EUR', { rounding: 'halfExpand' }).toString()).toBe('1.01 EUR');
  });

  // currency.js #102: 17.955 rounded to 17.95 because 17.955 * 100 is 1795.4999999999998
  it('rounds 17.955 to 17.96, and a number input the same as its string', () => {
    expect(money('17.955', 'EUR', { rounding: 'halfExpand' }).toString()).toBe('17.96 EUR');
    expect(money(17.955, 'EUR', { rounding: 'halfExpand' }).toString()).toBe('17.96 EUR');
  });

  // js-money: fromDecimal(0.1 + 0.2) threw "supports only 2 decimal digits"; it must not
  // silently become 0.30 either
  it('rejects 0.1 + 0.2 unless rounding is asked for', () => {
    expect(() => money(0.1 + 0.2, 'EUR')).toThrow(RangeError);
  });

  // dinero.js 1 #6: float amounts were accepted and drifted
  it('rejects a non-integer minor amount', () => {
    expect(() => fromMinor(10.5, 'EUR')).toThrow(RangeError);
  });

  // js-money: fromDecimal({ amount: 0 }) threw "Missing required parameters"
  it('accepts zero', () => {
    expect(money('0', 'EUR').toString()).toBe('0.00 EUR');
    expect(fromMinor(0, 'EUR').toString()).toBe('0.00 EUR');
  });
});

describe('rounding', () => {
  // dinero.js #710, #713: rounding helpers changed exact results, zero and negatives
  it('leaves exact results alone', () => {
    expect(multiply(money('-2.00', 'USD'), 1).toString()).toBe('-2.00 USD');
    expect(divide(money('-20', 'USD'), 10, 'floor').toString()).toBe('-2.00 USD');
    expect(divide(money('20', 'USD'), 10, 'ceil').toString()).toBe('2.00 USD');
    expect(toScale(fromMinor(0, 'USD', 7), 2, 'halfEven').toString()).toBe('0.00 USD');
  });

  // currency.js #517, #451, #378; dinero.js 1 #7; js-money #32: Math.round rounds -2.5 to -2
  it('rounds negative halves away from zero by default, symmetric with positive ones', () => {
    expect(money('-2.675', 'EUR', { rounding: 'halfExpand' }).toString()).toBe('-2.68 EUR');
    expect(money('-0.015', 'EUR', { rounding: 'halfExpand' }).toString()).toBe('-0.02 EUR');
    expect(toScale(money('-2.5', 'EUR'), 0).toString()).toBe('-3 EUR');
    expect(multiply(fromMinor(-5, 'EUR'), '0.5').minor).toBe(-3);
    expect(multiply(fromMinor(5, 'EUR'), '0.5').minor).toBe(3);
    expect(toScale(money('-2.05', 'EUR'), 1).toString()).toBe('-2.1 EUR');
  });

  // currency.js: -0.005 rounded to "-0.00", a negative zero
  it('never produces negative zero', () => {
    const rounded = money('-0.004', 'EUR', { rounding: 'halfExpand' });
    expect(Object.is(rounded.minor, -0)).toBe(false);
    expect(rounded.toString()).toBe('0.00 EUR');
    expect(Object.is(multiply(fromMinor(0, 'EUR'), '-1').minor, -0)).toBe(false);
  });

  // currency.js #268: fractional minor units were truncated instead of rounded
  it('rounds instead of truncating', () => {
    expect(multiply(fromMinor(7169, 'EUR'), '0.2').toString()).toBe('14.34 EUR');
    expect(divide(fromMinor(12345, 'EUR'), 2).toString()).toBe('61.73 EUR');
  });

  // js-money #32, dinero.js 1 #8: 2090.50 * 8.61 is exactly 17999.205, which rounds up
  it('multiplies by a decimal factor exactly', () => {
    expect(multiply(money('2090.50', 'EUR'), '8.61').toString()).toBe('17999.21 EUR');
    expect(multiply(money('2090.50', 'EUR'), 8.61).toString()).toBe('17999.21 EUR');
    expect(multiply(money('0.50', 'EUR'), '1.15').toString()).toBe('0.58 EUR');
  });

  // currency.js #133, #138: rounding at an extra digit first, then again (1.2349 became 1.24)
  it('rounds once, never twice', () => {
    expect(money('1.2349', 'EUR', { rounding: 'halfExpand' }).toString()).toBe('1.23 EUR');
    expect(money('1.2349999', 'EUR', { rounding: 'halfExpand' }).toString()).toBe('1.23 EUR');
    expect(money('0.43499', 'EUR', { rounding: 'halfExpand' }).toString()).toBe('0.43 EUR');
    expect(multiply(money('81.97', 'EUR'), '0.0735').toString()).toBe('6.02 EUR');
  });

  // currency.js #327, #469: no choice of rounding mode
  it('offers every rounding mode', () => {
    expect(divide(money('1.99', 'EUR'), 10, 'trunc').toString()).toBe('0.19 EUR');
    expect(multiply(money('0.25', 'EUR'), '0.02', 'halfEven').toString()).toBe('0.00 EUR');
  });

  // dinero.js 1 #187: 10^-4 * 15000 is 1.4999999999999998 in floating point
  it('changes scale without floats', () => {
    expect(toScale(fromMinor(15000, 'EUR', 6), 2, 'halfEven').toString()).toBe('0.02 EUR');
    // dinero.js 1 #72: 1e-7 printed in exponent form broke digit counting
    expect(toScale(fromMinor(3333333336, 'EUR', 9), 2).toString()).toBe('3.33 EUR');
  });

  // currency.js #365: a rounded display hid an unrounded stored value
  it('rounds the stored value to the increment, not just the display', () => {
    const rounded = roundToIncrement(fromMinor(1002, 'CHF'), money('0.05', 'CHF'));
    expect(rounded.minor).toBe(1000);
    expect(roundToIncrement(money('-10.5', 'CHF'), money('1', 'CHF')).toString()).toBe(
      '-11.00 CHF',
    );
  });
});

describe('allocation', () => {
  // dinero.js #892 (open): amount * ratio overflows 2^53 even when every input and output is safe
  it('stays exact when amount * weight passes 2^53', () => {
    const parts = allocate(
      fromMinor(3, 'USD'),
      [3002399751580333, 1000000000000000, 501199875790167],
    );
    expect(minors(parts)).toEqual([2, 1, 0]);
    const negative = allocate(
      fromMinor(-3, 'USD'),
      [3002399751580333, 1000000000000000, 501199875790167],
    );
    expect(minors(negative)).toEqual([-2, -1, 0]);
  });

  // dinero.js #771: allocating an amount above 2^53 never returned
  it('allocates amounts above 2^53 and sums exactly', () => {
    const total = fromMinor(337582417582417600000n, 'EUR', 19);
    const parts = allocate(total, ['0.3', '0.7']);
    expect(parts.reduce((sum, part) => sum + BigInt(part.minor), 0n)).toBe(337582417582417600000n);
  });

  // dinero.js #776: the remainder went to the first parts, not the largest shares
  it('gives the remainder to the largest fractional shares', () => {
    expect(minors(allocate(fromMinor(5, 'EUR'), [100, 101, 100, 100]))).toEqual([1, 2, 1, 1]);
    expect(minors(allocate(fromMinor(5, 'EUR'), [1, 3]))).toEqual([1, 4]);
  });

  // dinero.js 1 (5dac412); js-money PR #5; ts-money PR #5: zero weights got remainder units
  it('gives zero weights exactly zero', () => {
    expect(strings(allocate(money('10.03', 'EUR'), [0, 50, 50]))).toEqual([
      '0.00 EUR',
      '5.02 EUR',
      '5.01 EUR',
    ]);
    expect(minors(allocate(fromMinor(1001, 'EUR'), [0, 1, 1]))).toEqual([0, 501, 500]);
  });

  // ts-money PR #5: 29900 * 265.09 / 299 is 26508.999999999996, which floored to 26508
  it('treats decimal weights exactly', () => {
    expect(minors(allocate(fromMinor(29900, 'EUR'), ['265.09', '0', '33.91']))).toEqual([
      26509, 0, 3391,
    ]);
  });

  // dinero.js 1 #588: non-number ratios ('98', NaN, Infinity) were accepted
  it('rejects bad weights', () => {
    expect(() => allocate(money('1', 'EUR'), [Number.NaN, 1])).toThrow(SyntaxError);
    expect(() => allocate(money('1', 'EUR'), [Number.POSITIVE_INFINITY, 1])).toThrow(SyntaxError);
    expect(() => allocate(money('1', 'EUR'), [-1, 2])).toThrow(RangeError);
    expect(() => allocate(money('1', 'EUR'), [0, 0])).toThrow(RangeError);
    expect(() => allocate(money('1', 'EUR'), [])).toThrow(RangeError);
  });

  // currency.js PR #99, js-money: negative amounts put the remainder on the wrong side or sign
  it('mirrors negative amounts', () => {
    expect(strings(split(money('-0.01', 'EUR'), 2))).toEqual(['-0.01 EUR', '0.00 EUR']);
    expect(minors(split(fromMinor(-100, 'EUR'), 3))).toEqual([-34, -33, -33]);
    expect(minors(split(fromMinor(100, 'EUR'), 3))).toEqual([34, 33, 33]);
  });

  // currency.js (44b3be4): distributing a value built from minor units gave zeros
  it('splits values built from minor units', () => {
    expect(strings(split(fromMinor(100, 'EUR'), 4))).toEqual([
      '0.25 EUR',
      '0.25 EUR',
      '0.25 EUR',
      '0.25 EUR',
    ]);
  });

  // currency.js PR #506 (open): distribute(-1) and distribute(2.5) never terminated
  it('rejects a bad count instead of looping', () => {
    expect(() => split(money('1', 'EUR'), -1)).toThrow(RangeError);
    expect(() => split(money('1', 'EUR'), 2.5)).toThrow(RangeError);
    expect(() => split(money('1', 'EUR'), 0)).toThrow(RangeError);
  });
});

describe('minor and major units never mix', () => {
  // currency.js #425, #319, #318 (open): values built from cents read later operands as cents
  it('adds and divides values built either way', () => {
    const fromCents = fromMinor(8000, 'EUR');
    expect(divide(fromCents, 80).toString()).toBe('1.00 EUR');
    expect(fromMinor(451, 'EUR').subtract(money('1', 'EUR')).toString()).toBe('3.51 EUR');
    expect(fromMinor(300, 'EUR').add(fromMinor(200, 'EUR')).minor).toBe(500);
    expect(multiply(fromMinor(300, 'EUR'), 2).minor).toBe(600);
  });

  // currency.js: precision 4 plus precision 2 used the other value's integer directly
  it('aligns scales when adding', () => {
    const fine = money('1.0000', 'EUR', { scale: 4 });
    expect(fine.add(money('1.00', 'EUR')).toString()).toBe('2.0000 EUR');
    expect(money('1.00', 'EUR').add(fine).toString()).toBe('2.0000 EUR');
  });

  // currency.js #132: money divided by money returned money
  it('gives the ratio of two amounts as a plain number of parts', () => {
    // ducat has no Money / Money division; a ratio goes through the decimal values
    expect(Number(toDecimal(money('110', 'USD'))) / Number(toDecimal(money('20', 'USD')))).toBe(
      5.5,
    );
  });
});

describe('large values', () => {
  // currency.js #271, #139, #343: values below 2^53 minor units lost precision
  it('keeps every digit up to and beyond 2^53', () => {
    expect(toDecimal(money('99999747361065.39', 'EUR'))).toBe('99999747361065.39');
    expect(toDecimal(money('70368744177664.01', 'EUR'))).toBe('70368744177664.01');
    expect(toDecimal(money('1000000000000000.00000001', 'EUR', { scale: 8 }))).toBe(
      '1000000000000000.00000001',
    );
  });

  // currency.js #226: whole units and cents used ~~, which wraps above 2^31
  it('has no 32-bit truncation', () => {
    expect(toDecimal(money('90071992547', 'EUR'))).toBe('90071992547.00');
    expect(money('90071992547.25', 'EUR').minor).toBe(9007199254725);
  });

  // js-money: toString divided as a float, so 1e23 minor units printed as "1e+21"
  it('prints large and tiny values without exponents', () => {
    expect(toDecimal(fromMinor(10n ** 23n, 'EUR'))).toBe('1000000000000000000000.00');
    expect(toDecimal(fromMinor(1, 'EUR', 25))).toBe('0.0000000000000000000000001');
  });

  // dinero.js 1 #84: 100000 * 10^18 at precision 18 printed as 99999.99999999999
  it('prints high-precision values exactly', () => {
    expect(toDecimal(fromMinor(100000n * 10n ** 18n, 'ETH', 18))).toBe('100000.000000000000000000');
  });
});

describe('parsing is strict', () => {
  // currency.js #184: junk was stripped ("123.sd" became 123.00)
  it.each(['123.sd', 'a1b2c3', 'abc', '', ' ', '1.2.3', '1e-7', 'NaN', 'Infinity', '1,000'])(
    'money(%j) throws',
    (input) => {
      expect(() => money(input, 'EUR')).toThrow();
    },
  );

  // currency.js #147, #412: "2.443233038698408e+21" became 2.44
  it('reads exponent notation exactly, or not at all', () => {
    expect(toDecimal(money('2.443233038698408e+21', 'EUR'))).toBe('2443233038698408000000.00');
  });

  // currency.js #390: with decimal mark ",", "78.00" became 7800.00
  it('never reads a dot as noise in a comma-decimal locale', () => {
    expect(() => parse('78.00', 'EUR', 'de-DE')).toThrow(SyntaxError);
    expect(() => parse('1.5', 'EUR', 'de-DE')).toThrow(SyntaxError);
    expect(() => parse('1,5', 'EUR', 'en-US')).toThrow(SyntaxError);
    expect(() => parse('12.34.56', 'EUR', 'de-DE')).toThrow(SyntaxError);
    expect(parse('78,00', 'EUR', 'de-DE').toString()).toBe('78.00 EUR');
    expect(parse('1.234,56', 'EUR', 'de-DE').toString()).toBe('1234.56 EUR');
    expect(parse('1.234.567', 'EUR', 'de-DE').toString()).toBe('1234567.00 EUR');
    expect(parse('₹1,23,456.78', 'INR', 'en-IN').toString()).toBe('123456.78 INR');
    expect(parse('1.5', 'EUR', 'de-DE', { lenient: true }).toString()).toBe('15.00 EUR');
  });

  // dinero.js 1 #637: currency codes are case-sensitive; ducat rejects lower case outright
  it('rejects a lower-case code instead of treating it as another currency', () => {
    expect(() => money('1', 'usd')).toThrow();
  });
});

describe('formatting', () => {
  // dinero.js #692: negative amounts printed as "-10.-50", and -0.01 as "0.01"
  it('prints negative decimals correctly', () => {
    expect(toDecimal(fromMinor(-1050, 'EUR'))).toBe('-10.50');
    expect(toDecimal(fromMinor(-1, 'EUR'))).toBe('-0.01');
    expect(toDecimal(fromMinor(0, 'EUR'))).toBe('0.00');
  });

  // dinero.js #751: zero-decimal currencies printed with a trailing point ("100.")
  it('prints zero-decimal currencies without a point', () => {
    expect(toDecimal(money('100', 'JPY'))).toBe('100');
    expect(format(money('500', 'JPY'), 'ja-JP')).not.toMatch(/\.\d/);
  });

  // currency.js #104, #109, #6: grouping inside decimals, missing at precision 0, swapped marks
  it('groups digits only in the integer part, in the locale’s style', () => {
    expect(format(money('2573693.7576', 'EUR', { scale: 4 }), 'en-US')).toBe('€2,573,693.7576');
    expect(format(money('1234567', 'JPY'), 'en-US')).toBe('¥1,234,567');
    expect(format(money('1000000', 'EUR'), 'de-DE')).toBe('1.000.000,00 €');
  });

  // currency.js: -0.01 rounded to a 0.05 increment showed "-$0.00"
  it('never formats a negative zero', () => {
    const rounded = roundToIncrement(money('-0.01', 'CHF'), money('0.05', 'CHF'));
    expect(format(rounded, 'en-US')).not.toContain('-');
  });
});

describe('signs', () => {
  // dinero.js PR #728: isPositive(0) was true
  it('treats zero as neither positive nor negative', () => {
    expect(isPositive(fromMinor(0, 'EUR'))).toBe(false);
    expect(money('0', 'EUR').isNegative()).toBe(false);
    expect(money('0', 'EUR').sign()).toBe(0);
  });
});

describe('currency data', () => {
  // js-money PR #22: 20 currencies had cash digits (0) instead of ISO's (HUF, IDR, COP, IQD ...)
  it('uses ISO 4217 minor units, not cash digits', () => {
    for (const [code, digits] of [
      ['HUF', 2],
      ['IDR', 2],
      ['COP', 2],
      ['IQD', 3],
      ['RSD', 2],
      ['AFN', 2],
      ['CLP', 0],
      ['JPY', 0],
      ['KWD', 3],
      ['BYN', 2],
    ] as const) {
      expect([code, currencyExponent(code)]).toEqual([code, digits]);
    }
  });

  // js-money #37: obsolete codes listed, current ones missing
  it('knows current codes and not withdrawn ones', () => {
    for (const code of ['ZMW', 'BYN', 'MRU', 'STN', 'VES', 'VED', 'SLE', 'ZWG', 'XPF']) {
      expect([code, isCurrency(code)]).toEqual([code, true]);
    }
    for (const code of ['ZMK', 'BYR', 'VEF', 'LTL', 'LVL', 'EEK', 'MRO', 'STD']) {
      expect([code, isCurrency(code)]).toEqual([code, false]);
    }
  });
});
