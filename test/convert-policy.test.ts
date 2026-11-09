import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import '../src/plugins/convert.js';
import { cashPolicy } from '../src/cash.js';
import { convert, convertDetailed, exchangeRate, rateTable, via } from '../src/convert.js';
import { exact } from '../src/exact.js';
import { money } from '../src/fn.js';
import { assertScale, roundingPolicy } from '../src/policy.js';

const eurChf = exchangeRate('EUR', 'CHF', '0.9143');
const eurUsd = exchangeRate('EUR', 'USD', '1.1165');

describe('converting with a rounding policy', () => {
  it('lands on the policy scale and increment, in every form of convert', () => {
    const chfCash = cashPolicy('CHF'); // 0.05
    const amount = money('10.07', 'EUR'); // 9.207001 CHF
    const viaRate = convert(amount, eurChf, chfCash);
    expect(viaRate.toDecimal()).toBe('9.20');
    assertScale(viaRate, chfCash);
    expect(convert(amount, 'CHF', '0.9143', chfCash).toDecimal()).toBe('9.20');
    const table = rateTable({ base: 'EUR', rates: { CHF: '0.9143' } });
    expect(convert(amount, 'CHF', table, chfCash).toDecimal()).toBe('9.20');
    expect(eurChf.convert(amount, chfCash).toDecimal()).toBe('9.20');
    expect(amount.convert(eurChf, chfCash).toDecimal()).toBe('9.20');
    expect(amount.convert('CHF', table, chfCash).toDecimal()).toBe('9.20');
    // through a provider that triangulates, still rounded once
    const usdChf = convert(
      money('100.00', 'USD'),
      'CHF',
      via('EUR', rateTable({ base: 'EUR', rates: { USD: '1.1165', CHF: '0.9143' } })),
      chfCash,
    );
    expect(usdChf.toDecimal()).toBe('81.90'); // 100 / 1.1165 × 0.9143 = 81.889...
  });

  it('a scale policy keeps more decimals; its mode is used', () => {
    const fourDecimals = roundingPolicy({ scale: 4, rounding: 'halfEven' });
    const usd = convert(money('0.07', 'EUR'), eurUsd, fourDecimals);
    expect([usd.toDecimal(), usd.scale]).toEqual(['0.0782', 4]); // 0.078155 → 0.0782
    const down = roundingPolicy({ scale: 2, rounding: 'floor' });
    expect(convert(money('0.07', 'EUR'), eurUsd, down).toDecimal()).toBe('0.07');
    // a zero-decimal target
    const yen = convert(money('1.00', 'EUR'), 'JPY', '176.77', roundingPolicy({ increment: 10 }));
    expect(yen.toDecimal()).toBe('180');
  });

  it("checks the policy's currency against the target, and refuses a second scale", () => {
    const chfOnly = roundingPolicy({ currency: 'CHF' });
    expect(convert(money('10.00', 'EUR'), eurChf, chfOnly).currency).toBe('CHF');
    expect(() => convert(money('10.00', 'EUR'), eurUsd, chfOnly)).toThrow(/CHF/);
    expect(() => convert(money('10.00', 'EUR'), eurUsd, roundingPolicy(), { scale: 4 })).toThrow(
      TypeError,
    );
    // strict validity still applies
    const expired = exchangeRate('EUR', 'USD', '1.1', { validUntil: '2000-01-01' });
    expect(() =>
      expired.convert(money('1.00', 'EUR'), roundingPolicy(), { strictValidity: true }),
    ).toThrow(/expired/);
  });

  it('convertDetailed: the value is the policy rounding, the residual exact', () => {
    const { value, residual, rate } = convertDetailed(
      money('10.07', 'EUR'),
      eurChf,
      cashPolicy('CHF'),
    );
    expect(value.toDecimal()).toBe('9.20');
    expect(rate).toBe(eurChf);
    expect(
      exact(value)
        .add(residual)
        .equals(exact(money('10.07', 'EUR')).convert(eurChf)),
    ).toBe(true);
  });

  it('equals rounding the exact product by hand (property)', () => {
    const rates = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 8n }), fc.integer({ min: 0, max: 6 }))
      .map(([digits, scale]) => exchangeRate('EUR', 'USD', `${digits}/${10n ** BigInt(scale)}`));
    const policies = fc
      .record({
        scale: fc.integer({ min: 0, max: 6 }),
        increment: fc.integer({ min: 1, max: 100 }),
        rounding: fc.constantFrom('halfEven', 'halfExpand', 'floor', 'ceil', 'trunc', 'expand'),
      })
      .map((options) => roundingPolicy(options));
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        rates,
        policies,
        (minor, rate, policy) => {
          const amount = money(`${minor}`, 'EUR').divide(100, 'unnecessary');
          const value = convert(amount, rate, policy);
          assertScale(value, policy);
          // the same as multiplying an amount already in USD by the rate with that policy
          const inUsd = money(amount.toDecimal(), 'USD');
          expect(value.equals(inUsd.multiply(rate.ratio, policy))).toBe(true);
          expect(value.scale).toBe(policy.scale);
        },
      ),
    );
  });
});
