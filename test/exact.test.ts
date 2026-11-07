import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromMinor, money, type RoundingMode } from '../src/index.js';
import { exact, isExactMoney, sumExact } from '../src/exact.js';
import { exchangeRate } from '../src/rate.js';

const MODES: RoundingMode[] = [
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

describe('ExactMoney', () => {
  it('chains arithmetic and rounds once', () => {
    const x = exact(money('10.00', 'EUR')).divide(3).multiply(3);
    expect(x.toString()).toBe('10 EUR');
    expect(x.round('halfEven').toDecimal()).toBe('10.00');
    const third = exact(money('10.00', 'EUR')).divide(3);
    expect(third.toString()).toBe('10/3 EUR');
    expect(third.isExact()).toBe(false);
    expect(exact(money('1.5', 'EUR')).isExact()).toBe(true);
    expect(exact(money('1.005', 'EUR', { scale: 3 })).isExact()).toBe(false);
    expect(third.add(third).add(third).round('halfEven').toDecimal()).toBe('10.00');
    expect(third.subtract(third).isZero()).toBe(true);
    expect(third.negate().sign()).toBe(-1);
    expect(third.compare(exact(money('3.33', 'EUR')))).toBe(1);
    expect(third.equals(exact(money('10', 'EUR')).divide(3))).toBe(true);
    expect(() => third.add(exact(money('1', 'USD')) as never)).toThrow(/currency/i);
    expect(() => third.divide(0)).toThrow(RangeError);
    expect(() => +third).toThrow(TypeError);
    expect(isExactMoney(third)).toBe(true);
  });

  it('converts exactly and reports the residual', () => {
    const eurUsd = exchangeRate('EUR', 'USD', '1.1165');
    const x = exact(money('0.07', 'EUR')).convert(eurUsd); // 0.078155 USD
    const { value, residual } = x.roundWithResidual('halfEven');
    expect(value.toDecimal()).toBe('0.08');
    expect(residual.toString()).toBe('-369/200000 USD');
    expect(exact(value).add(residual).equals(x)).toBe(true);
    expect(x.round('halfEven', 4).toDecimal()).toBe('0.0782');
    expect(() => exact(money('1', 'USD')).convert(eurUsd as never)).toThrow(/currency/i);
  });

  it('sumExact rounds a batch once', () => {
    const r = exchangeRate('EUR', 'USD', '1.1165');
    const parts = ['0.07', '0.07', '0.07'].map((a) => exact(money(a, 'EUR')).convert(r));
    const each = parts.map((p) => p.roundWithResidual('halfEven'));
    const residual = sumExact(each.map((e) => e.residual));
    expect(residual.round('halfEven').toDecimal()).toBe('-0.01'); // 3 × 0.08 booked vs 0.234465 exact
    expect(sumExact(parts).round('halfEven').toDecimal()).toBe('0.23');
    expect(sumExact([], 'EUR').isZero()).toBe(true);
    expect(() => sumExact([])).toThrow(RangeError);
  });

  it('value + residual = exact, and the residual is within the mode bound', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(...MODES),
        (m, div, scale, rm) => {
          const x = exact(fromMinor(m, 'EUR', 4)).divide(div);
          const { value, residual } = x.roundWithResidual(rm, scale);
          expect(exact(value).add(residual).equals(x)).toBe(true);
          // |residual| in units of 10^-scale: <= 1/2 for half modes, < 1 for directed modes
          const ulps = exact(fromMinor(1n, 'EUR', scale));
          const bound = rm.startsWith('half') ? ulps.divide(2) : ulps;
          const abs = residual.sign() < 0 ? residual.negate() : residual;
          expect(abs.compare(bound)).toBeLessThanOrEqual(rm.startsWith('half') ? 0 : -1);
          expect(residual.isZero()).toBe(x.isExact(scale));
        },
      ),
    );
  });
});

describe('convertDetailed and Money#exact', () => {
  it('reports the residual and the rate used', async () => {
    const { convertDetailed } = await import('../src/convert.js');
    await import('../src/plugins/exact.js');
    const eurUsd = exchangeRate('EUR', 'USD', '1.1165', { source: 'ECB', asOf: '2026-11-06' });
    const detail = convertDetailed(money('0.07', 'EUR'), eurUsd, 'halfEven');
    expect(detail.value.toDecimal()).toBe('0.08');
    expect(detail.residual.toString()).toBe('-369/200000 USD');
    expect(detail.rate).toBe(eurUsd);
    expect(money('10', 'EUR').exact().divide(3).toString()).toBe('10/3 EUR');
  });
});
