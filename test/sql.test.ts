import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, fromMinor, money } from '../src/index.js';
import { toDecimal, toMinor } from '../src/fn.js';
import {
  checkDecimalSize,
  decimalFromDriver,
  decimalToDriver,
  jsonFromDriver,
  jsonToDriver,
  minorFromDriver,
  minorToDriver,
  readScale,
} from '../src/sql.js';
import { runs } from './fc-config.js';

const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;
const bigintMinor = fc.bigInt({ min: BIGINT_MIN, max: BIGINT_MAX });
const currencies = fc.constantFrom('EUR', 'JPY', 'KWD', 'CLF');

describe('minor units', () => {
  it('round-trip through every driver representation: bigint, safe number, integer string', () => {
    fc.assert(
      fc.property(bigintMinor, currencies, (minor, currency) => {
        const original = fromMinor(minor, currency);
        const stored = minorToDriver(original, currency);
        expect(stored).toBe(minor);

        for (const driverValue of [stored, stored.toString()]) {
          expect(minorFromDriver(driverValue, currency).equals(original)).toBe(true);
        }
        if (Number.isSafeInteger(Number(stored))) {
          expect(minorFromDriver(Number(stored), currency).equals(original)).toBe(true);
        }
      }),
      { numRuns: runs(1000) },
    );
  });

  it('rejects numbers that have lost digits, and anything that is not an integer', () => {
    expect(() => minorFromDriver(2 ** 53 + 2, 'EUR')).toThrow(/safe integer/);
    expect(() => minorFromDriver(1.5, 'EUR')).toThrow(RangeError);
    expect(() => minorFromDriver(NaN, 'EUR')).toThrow(RangeError);
    for (const text of ['', '1.0', '1e3', ' 1', '0x10', 'NaN']) {
      expect(() => minorFromDriver(text, 'EUR')).toThrow(SyntaxError);
    }
    expect(() => minorFromDriver(null, 'EUR')).toThrow(TypeError);
  });

  it('refuses amounts beyond the BIGINT range, which MySQL would otherwise clip', () => {
    expect(minorToDriver(fromMinor(2n ** 63n - 1n, 'EUR'), 'EUR')).toBe(2n ** 63n - 1n);
    expect(minorToDriver(fromMinor(-(2n ** 63n), 'EUR'), 'EUR')).toBe(-(2n ** 63n));
    fc.assert(
      fc.property(
        fc.bigInt({ min: 2n ** 63n, max: 10n ** 30n }),
        fc.boolean(),
        (excess, negative) => {
          const minor = negative ? -excess - 1n : excess;
          expect(() => minorToDriver(fromMinor(minor, 'EUR'), 'EUR')).toThrow(/range of a BIGINT/);
        },
      ),
      { numRuns: runs(200) },
    );
    expect(() => minorToDriver(money('1e20', 'EUR'), 'EUR')).toThrow(RangeError);
  });

  it('refuses another currency, or a scale the column cannot record', () => {
    expect(() => minorToDriver(money('1', 'USD'), 'EUR')).toThrow(CurrencyMismatchError);
    expect(() => minorToDriver(money('1.234', 'EUR', { scale: 3 }), 'EUR')).toThrow(/round\(\)/);
  });
});

describe('decimals', () => {
  it('round-trip exactly, with or without the trailing zeros a NUMERIC(p,4) column adds', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 17n), max: 10n ** 17n }),
        currencies,
        (minor, currency) => {
          const original = fromMinor(minor, currency);
          const stored = decimalToDriver(original, currency, { precision: 38, scale: 4 });
          expect(stored).toBe(toDecimal(original));

          const padded =
            original.scale === 4 ? stored : `${stored}${original.scale === 0 ? '.' : ''}0`;
          expect(decimalFromDriver(stored, currency).equals(original)).toBe(true);
          expect(decimalFromDriver(padded, currency).equals(original)).toBe(true);
        },
      ),
      { numRuns: runs(1000) },
    );
  });

  it('rejects floats, NaN, Infinity and decimals the currency does not have', () => {
    expect(() => decimalFromDriver(12.34, 'EUR')).toThrow(/as strings/);
    for (const text of ['NaN', 'Infinity', '-Infinity']) {
      expect(() => decimalFromDriver(text, 'EUR')).toThrow(SyntaxError);
    }
    expect(() => decimalFromDriver('1.2345', 'EUR')).toThrow(/decimal places/);
  });

  it('refuses a value the column would round or clamp, and a column that would round', () => {
    const size = { precision: 19, scale: 4 };
    expect(decimalToDriver(money('999999999999999.99', 'EUR'), 'EUR', size)).toBe(
      '999999999999999.99',
    );
    expect(() => decimalToDriver(money('1000000000000000', 'EUR'), 'EUR', size)).toThrow(
      /does not fit NUMERIC\(19,4\)/,
    );
    expect(() => decimalToDriver(money('1.23456', 'EUR', { scale: 5 }), 'EUR', size)).toThrow(
      /round\(\)/,
    );
    expect(() => checkDecimalSize('KWD', { precision: 19, scale: 2 })).toThrow(/would round KWD/);
    for (const [precision, scale] of [
      [4, 5],
      [0, 0],
      [19.5, 4],
      [19, -1],
      [NaN, 2],
    ] as const) {
      expect(() => checkDecimalSize('EUR', { precision, scale })).toThrow(/not a valid/);
    }
    // a column with no integer digits still holds amounts below one
    const fractionOnly = { precision: 4, scale: 4 };
    expect(decimalToDriver(money('0.12', 'EUR'), 'EUR', fractionOnly)).toBe('0.12');
    expect(decimalToDriver(money('-0.12', 'EUR'), 'EUR', fractionOnly)).toBe('-0.12');
    expect(() => decimalToDriver(money('1.00', 'EUR'), 'EUR', fractionOnly)).toThrow(
      /does not fit/,
    );
    expect(() => checkDecimalSize('EUR', { precision: 19, scale: 2 })).not.toThrow();
  });
});

describe('JSON', () => {
  it('round-trips as text and as the object a driver parsed', () => {
    fc.assert(
      fc.property(bigintMinor, currencies, (minor, currency) => {
        const original = fromMinor(minor, currency);
        const stored = jsonToDriver(original, undefined);
        expect(jsonFromDriver(stored, undefined).equals(original)).toBe(true);
        expect(jsonFromDriver(JSON.parse(stored), currency).equals(original)).toBe(true);
        expect(toMinor(jsonFromDriver(stored, currency))).toBe(minor);
      }),
      { numRuns: runs(1000) },
    );
  });

  it('checks a fixed currency on write and on read', () => {
    const dollars = money('1', 'USD');
    expect(() => jsonToDriver(dollars, 'EUR')).toThrow(CurrencyMismatchError);
    expect(() => jsonFromDriver(JSON.stringify(dollars), 'EUR')).toThrow(CurrencyMismatchError);
    expect(() => jsonFromDriver(42, 'EUR')).toThrow(TypeError);
    expect(() => jsonFromDriver(null, 'EUR')).toThrow(TypeError);
    expect(() => jsonFromDriver({ amount: 1, currency: 'EUR' }, 'EUR')).toThrow(TypeError);
  });
});

describe('readScale', () => {
  it('reads a scale column as a number or a bigint, from 0 to 1000', () => {
    expect(readScale(0, 's')).toBe(0);
    expect(readScale(2n, 's')).toBe(2);
    expect(readScale(1000, 's')).toBe(1000);
  });

  it('throws for NULL, a negative, fractional or too large scale, and anything else', () => {
    for (const value of [null, undefined, -1, 1.5, 1001, 1001n, NaN, '2', {}]) {
      expect(() => readScale(value, 'amount_scale')).toThrow(
        /integer scale from 0 to 1000 in "amount_scale"/,
      );
    }
  });

  it('a stored scale pairs with units at that scale: above, at and below the currency', () => {
    expect(String(minorFromDriver('1005', 'EUR', readScale(3, 's')))).toBe('1.005 EUR');
    expect(String(minorFromDriver('12', 'EUR', readScale(0n, 's')))).toBe('12 EUR');
    expect(minorToDriver(money('1.005', 'EUR', { scale: 3 }), 'EUR', 3)).toBe(1005n);
    expect(minorToDriver(money('12', 'EUR', { scale: 0 }), undefined, 0)).toBe(12n);
  });
});
