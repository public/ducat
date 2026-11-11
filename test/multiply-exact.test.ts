import '../src/plugins/exact.js'; // Money#multiplyExact, and the core methods through the ISO table
import '../src/plugins/core.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exact, multiplyExact } from '../src/exact.js';
import { ratio } from '../src/decimal.js';
import { fixed } from '../src/fixed.js';
import { fromMinor, money, multiply } from '../src/fn.js';
import { RoundingError } from '../src/rounding.js';
import { runs } from './fc-config.js';

describe('multiplyExact', () => {
  it('grows the scale to keep every digit, never below the amount’s', () => {
    expect(multiplyExact(money('10.00', 'EUR'), '1.0775').toString()).toBe('10.775 EUR');
    expect(multiplyExact(money('0.10', 'EUR'), '0.25').toString()).toBe('0.025 EUR');
    expect(multiplyExact(money('10.00', 'EUR'), 2).toString()).toBe('20.00 EUR');
    expect(multiplyExact(money('3', 'EUR'), ratio(1, 3)).toString()).toBe('1.00 EUR');
    expect(multiplyExact(money('1', 'JPY'), '0.125').toString()).toBe('0.125 JPY');
    expect(multiplyExact(money('10.00', 'EUR'), fixed('0.0001')).toString()).toBe('0.001 EUR');
    expect(money('19.99', 'CHF').multiplyExact('0.077').toString()).toBe('1.53923 CHF');
  });

  it('throws a RoundingError when the product does not terminate', () => {
    expect(() => multiplyExact(money('1', 'EUR'), ratio(1, 3))).toThrow(RoundingError);
    expect(() => multiplyExact(money('1', 'EUR'), ratio(1, 3))).toThrow(
      /has no finite decimal form; round\(\) it with a rounding mode/,
    );
  });

  it('throws a RangeError past 1000 decimal places', () => {
    expect(() => multiplyExact(money('1', 'EUR'), ratio(1n, 2n ** 1001n))).toThrow(
      /needs 1001 decimal places, more than 1000/,
    );
    expect(multiplyExact(money('1', 'EUR'), ratio(1n, 2n ** 1000n)).scale).toBe(1000);
  });

  it('is exact: rounding it back to the scale gives multiply', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
        fc.integer({ min: 0, max: 6 }),
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.integer({ min: 0, max: 8 }),
        (minor, scale, factorDigits, factorScale) => {
          const amount = fromMinor(minor, 'EUR', scale);
          const factor = ratio(factorDigits, 10n ** BigInt(factorScale));
          const product = multiplyExact(amount, factor);
          return (
            product.scale >= scale &&
            product.scale <= scale + factorScale &&
            exact(product).equals(exact(amount).multiply(factor)) &&
            product.round('halfEven', scale).identical(multiply(amount, factor, 'halfEven'))
          );
        },
      ),
      { numRuns: runs(300) },
    );
  });
});

describe('ExactMoney#toMoney', () => {
  it('gives the exact value at the smallest scale that holds it', () => {
    expect(exact(money('1', 'EUR')).divide(8).toMoney().toString()).toBe('0.125 EUR');
    expect(exact(money('1', 'EUR')).divide(4).toMoney().toString()).toBe('0.25 EUR');
    expect(exact(money('1', 'EUR')).divide(2).toMoney().toString()).toBe('0.50 EUR');
    expect(exact(money('1', 'EUR')).divide(2).toMoney(0).toString()).toBe('0.5 EUR');
    expect(exact(money('7', 'JPY')).toMoney().toString()).toBe('7 JPY');
    expect(exact(money('-1', 'EUR')).divide(16).toMoney().toString()).toBe('-0.0625 EUR');
  });

  it('throws a RoundingError naming round() when the value does not terminate', () => {
    expect(() => exact(money('10', 'EUR')).divide(3).toMoney()).toThrow(
      '10/3 EUR has no finite decimal form; round() it with a rounding mode',
    );
    expect(() => exact(money('10', 'EUR')).divide(3).toMoney()).toThrow(RoundingError);
  });

  it('validates the minimum scale', () => {
    expect(() => exact(money('1', 'EUR')).toMoney(-1)).toThrow(/Invalid scale -1/);
  });

  it('round-trips every Money', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 20 }),
        (minor, scale) => {
          const amount = fromMinor(minor, 'EUR', scale);
          const back = exact(amount).toMoney(scale);
          return back.identical(amount);
        },
      ),
      { numRuns: runs(300) },
    );
  });
});
