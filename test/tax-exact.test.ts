import '../src/plugins/iso.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ratio } from '../src/decimal.js';
import { addTaxExact, exact, extractTaxExact, sumExact } from '../src/exact.js';
import { fromMinor, identical, money } from '../src/fn.js';
import { addTax, extractTax } from '../src/tax.js';
import type { RoundingMode } from '../src/rounding.js';
import { runs } from './fc-config.js';

const MODES: RoundingMode[] = ['halfEven', 'halfExpand', 'floor', 'ceil', 'trunc', 'expand'];
const percent = fc.oneof(
  fc.integer({ min: 0, max: 100 }),
  fc.constantFrom('7.7', '8.1', '2.6', '19', '20', '5.5', '0.5', '12.875'),
);
const amount = fc
  .bigInt({ min: -(10n ** 20n), max: 10n ** 20n })
  .map((minor) => fromMinor(minor, 'EUR'));

describe('extractTaxExact', () => {
  it('splits a gross amount exactly', () => {
    const { net, tax, gross } = extractTaxExact(money('12', 'EUR'), '20');
    expect([net.toString(), tax.toString(), gross.toString()]).toEqual([
      '10 EUR',
      '2 EUR',
      '12 EUR',
    ]);
    const swiss = extractTaxExact(money('10.78', 'CHF'), '7.7');
    expect(swiss.net.toString()).toBe('10780/1077 CHF');
    expect(swiss.net.isExact()).toBe(false);
  });

  it('lets a report sum unrounded nets and round once', () => {
    const rows = [money('1.00', 'CHF'), money('1.00', 'CHF'), money('1.00', 'CHF')];
    const perRow = rows.map((row) => extractTax(row, '7.7', 'halfEven').net.minor);
    expect(perRow).toEqual([93, 93, 93]); // 2.79 in total, rounded three times
    const total = sumExact(rows.map((row) => extractTaxExact(row, '7.7').net));
    expect(total.round('halfEven').toString()).toBe('2.79 CHF');
    const many = Array.from({ length: 7 }, () => money('1.00', 'CHF'));
    const exactTotal = sumExact(many.map((row) => extractTaxExact(row, '7.7').net));
    expect(exactTotal.round('halfEven').toString()).toBe('6.50 CHF'); // 7 × 0.9285...
    expect(
      many.reduce((sum, row) => sum + Number(extractTax(row, '7.7', 'halfEven').net.minor), 0),
    ).toBe(651);
  });

  it('accepts an ExactMoney, so a chain never rounds', () => {
    const third = exact(money('36', 'EUR')).divide(3);
    expect(extractTaxExact(third, '20').net.toString()).toBe('10 EUR');
  });

  it('is extractTax before rounding, and the parts add up', () => {
    fc.assert(
      fc.property(amount, percent, fc.constantFrom(...MODES), (gross, rate, mode) => {
        const parts = extractTaxExact(gross, rate);
        const rounded = extractTax(gross, rate, mode);
        return (
          parts.net.add(parts.tax).equals(exact(gross)) &&
          parts.gross.equals(exact(gross)) &&
          identical(parts.net.round(mode), rounded.net)
        );
      }),
      { numRuns: runs(300) },
    );
  });

  it('throws a RangeError naming the percent at -100% or below', () => {
    expect(() => extractTaxExact(money('1', 'EUR'), -100)).toThrow(
      'extractTaxExact: percent must be greater than -100, got -100',
    );
    expect(() => extractTaxExact(money('1', 'EUR'), '-150.5')).toThrow(
      'extractTaxExact: percent must be greater than -100, got -150.5',
    );
    expect(() => extractTax(money('1', 'EUR'), -100, 'halfEven')).toThrow(
      'extractTax: percent must be greater than -100, got -100',
    );
    expect(() => extractTax(money('1', 'EUR'), ratio(-201, 2))).toThrow(
      'extractTax: percent must be greater than -100, got -100.5',
    );
    expect(() => extractTaxExact(money('1', 'EUR'), ratio(-301, 3))).toThrow(
      'extractTaxExact: percent must be greater than -100, got -301/3',
    );
    expect(extractTax(money('1', 'EUR'), '-99.99', 'halfEven').net.toString()).toBe('10000.00 EUR');
    expect(extractTaxExact(money('1', 'EUR'), '-50').net.toString()).toBe('2 EUR');
  });
});

describe('addTaxExact', () => {
  it('adds tax exactly', () => {
    const { net, tax, gross } = addTaxExact(money('10.01', 'CHF'), '7.7');
    expect([net.toString(), tax.toString(), gross.toString()]).toEqual([
      '1001/100 CHF',
      '77077/100000 CHF',
      '1078077/100000 CHF',
    ]);
  });

  it('is addTax before rounding, and inverts extractTaxExact', () => {
    fc.assert(
      fc.property(amount, percent, fc.constantFrom(...MODES), (net, rate, mode) => {
        const parts = addTaxExact(net, rate);
        const rounded = addTax(net, rate, mode);
        return (
          parts.net.add(parts.tax).equals(parts.gross) &&
          identical(parts.tax.round(mode), rounded.tax) &&
          extractTaxExact(parts.gross, rate).net.equals(exact(net))
        );
      }),
      { numRuns: runs(300) },
    );
  });
});
