import '../src/plugins/all.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromMinor, money, toDecimal, toScale } from '../src/fn.js';
import { format, formatToParts } from '../src/format.js';
import type { RoundingMode } from '../src/rounding.js';
import { runs } from './fc-config.js';

const MODES: RoundingMode[] = ['halfEven', 'halfExpand', 'floor', 'ceil', 'trunc', 'expand'];

describe('format with digits', () => {
  it('rounds once to the chosen digits, half up by default', () => {
    const perKwh = money('0.123456', 'EUR', { scale: 6 });
    expect(format(perKwh, 'en-US', { digits: 4 })).toBe('€0.1235');
    expect(format(perKwh, 'en-US', { digits: 4, rounding: 'floor' })).toBe('€0.1234');
    expect(format(money('1234.5', 'EUR'), 'en-US', { digits: 0 })).toBe('€1,235');
    expect(format(money('1234.5', 'EUR'), 'en-US', { digits: 0, rounding: 'halfEven' })).toBe(
      '€1,234',
    );
    expect(format(money('2.5', 'EUR'), 'en-US', { digits: 0, rounding: 'halfEven' })).toBe('€2');
    expect(money('19.99', 'EUR').format('en-US', { digits: 0 })).toBe('€20');
  });

  it('pads to more digits than the scale', () => {
    expect(format(money('12.3', 'EUR'), 'en-US', { digits: 4 })).toBe('€12.3000');
    expect(format(money('5', 'JPY'), 'en-US', { digits: 2 })).toBe('¥5.00');
  });

  it('rounds the exact decimal, at any size', () => {
    expect(format(money('1.005', 'EUR', { scale: 3 }), 'en-US', { digits: 2 })).toBe('€1.01');
    expect(format(money('-1.005', 'EUR', { scale: 3 }), 'en-US', { digits: 2 })).toBe('-€1.01');
    // beyond 2^53, through Intl's string input
    const big = fromMinor(10n ** 20n * 1000n + 5n, 'EUR', 3); // 100000000000000000000.005
    expect(format(big, 'en-US', { digits: 2, useGrouping: false })).toBe(
      '€100000000000000000000.01',
    );
  });

  it('keeps other Intl options', () => {
    expect(
      format(money('-5.555', 'USD', { scale: 3 }), 'en-US', {
        digits: 2,
        currencySign: 'accounting',
      }),
    ).toBe('($5.56)');
    expect(
      formatToParts(money('0.125', 'EUR', { scale: 3 }), 'en-US', { digits: 2 })
        .map((part) => part.value)
        .join(''),
    ).toBe('€0.13');
  });

  it('refuses Intl digit options beside digits, and rounding without digits', () => {
    expect(() =>
      format(money('1', 'EUR'), 'en-US', { digits: 2, maximumFractionDigits: 3 }),
    ).toThrow('format: digits replaces the fraction-digit options; rounding needs it');
    expect(() => format(money('1', 'EUR'), 'en-US', { rounding: 'floor' })).toThrow(
      'format: digits replaces the fraction-digit options; rounding needs it',
    );
    expect(() => format(money('1', 'EUR'), 'en-US', { digits: -1 })).toThrow(/Invalid scale -1/);
  });

  it('is format of the amount rounded with toScale', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -(10 ** 12), max: 10 ** 12 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 8 }),
        fc.constantFrom(...MODES),
        (minor, scale, digits, rounding) => {
          const amount = fromMinor(minor, 'EUR', scale);
          const rounded = toScale(amount, digits, rounding);
          const shown = format(amount, 'en-US', { digits, rounding, useGrouping: false });
          return (
            shown === format(rounded, 'en-US', { useGrouping: false }) &&
            shown.replace(/[€-]/g, '') === toDecimal(rounded).replace('-', '')
          );
        },
      ),
      { numRuns: runs(300) },
    );
  });
});
