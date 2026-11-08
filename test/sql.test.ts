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
