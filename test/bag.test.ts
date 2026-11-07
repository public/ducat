import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromMinor, money, type Money } from '../src/index.js';
import { bag, comparator, MoneyBag, sortByValue, sumByCurrency } from '../src/bag.js';
import { chain, rateTable, RateUnavailableError, via } from '../src/provider.js';
import { exchangeRate } from '../src/rate.js';

const ecb = rateTable({ base: 'EUR', asOf: '2026-11-06', rates: { USD: '1.1165', JPY: '176.77', GBP: '0.83415' } });
const fx = via('EUR', ecb);

describe('MoneyBag', () => {
  it('keeps per-currency totals', () => {
    const b = bag(money('10', 'EUR'), money('5', 'USD'), money('2', 'EUR'));
    expect(b.get('EUR')?.toDecimal()).toBe('12.00');
    expect(b.get('JPY')).toBeUndefined();
    expect(b.currencies()).toEqual(['EUR', 'USD']);
    const b2 = b.add(money('1', 'GBP'));
    expect(b.currencies()).toEqual(['EUR', 'USD']); // immutable
    expect(JSON.stringify(b2)).toBe(
      '[{"amount":"12.00","currency":"EUR"},{"amount":"5.00","currency":"USD"},{"amount":"1.00","currency":"GBP"}]',
    );
    expect([...sumByCurrency([money('1', 'EUR'), money('2', 'EUR')]).values()].map(String)).toEqual(['3.00 EUR']);
    const totals = new Map<string, Money>([['EUR', money('1', 'EUR')]]);
    const copied = new MoneyBag(totals);
    totals.set('USD', money('1', 'USD'));
    expect(copied.currencies()).toEqual(['EUR']); // the caller's Map is copied
  });

  it('totals in one currency, rounding once', () => {
    // 1 EUR + 0.01 USD + 0.01 GBP = 1 + 0.0089565... + 0.0119882... = 1.0209447... EUR
    const b = bag(money('0.01', 'USD'), money('0.01', 'GBP'), money('1', 'EUR'));
    expect(b.total('EUR', fx, 'halfEven').toDecimal()).toBe('1.02');
    expect(b.exactTotal('EUR', fx).isExact()).toBe(false);
    expect(b.total('EUR', fx, 'halfEven', { scale: 4 }).toDecimal()).toBe('1.0209');
    expect(() => bag(money('1', 'CHF')).total('EUR', fx, 'halfEven')).toThrow(RateUnavailableError);
    expect(bag().total('EUR', fx, 'halfEven').toDecimal()).toBe('0.00');
  });
});

describe('comparator', () => {
  it('orders mixed currencies through one base, exactly', () => {
    const cmp = comparator(fx, { base: 'EUR' });
    const list = [money('100', 'JPY'), money('1', 'GBP'), money('1', 'USD'), money('1', 'EUR')];
    expect(list.sort(cmp).map(String)).toEqual(['100 JPY', '1.00 USD', '1.00 EUR', '1.00 GBP']);
    expect(cmp(money('1.1165', 'USD', { scale: 4 }), money('1', 'EUR'))).toBe(0);
    expect(() => cmp(money('1', 'CHF'), money('1', 'EUR'))).toThrow(RateUnavailableError);
  });

  it('is consistent even when the pairwise rates are not', () => {
    // USD→GBP 0.7 disagrees with the EUR legs (0.9 / 1.2 = 0.75); only the rates to the base are used
    const inconsistent = chain(
      rateTable([exchangeRate('USD', 'EUR', '0.9'), exchangeRate('GBP', 'EUR', '1.2')]),
      rateTable([exchangeRate('USD', 'GBP', '0.7')]),
    );
    const cmp = comparator(inconsistent, { base: 'EUR' });
    const a = money('1', 'USD'),
      b = money('0.8', 'GBP'),
      c = money('0.92', 'EUR');
    const s = [a, b, c].sort(cmp).map(String);
    expect(s).toEqual([...[c, b, a].sort(cmp)].map(String));
    expect(s).toEqual(['1.00 USD', '0.92 EUR', '0.80 GBP']); // 0.90, 0.92, 0.96 EUR
    for (const x of [a, b, c]) for (const y of [a, b, c]) expect(cmp(x, y)).toBe(-cmp(y, x) || 0);
  });

  it('is transitive on random triples, even over inconsistent pairwise rates', () => {
    const inconsistent = chain(
      rateTable([
        exchangeRate('USD', 'EUR', '0.9'),
        exchangeRate('GBP', 'EUR', '1.2'),
        exchangeRate('EUR', 'JPY', '163').inverse(),
      ]),
      rateTable([exchangeRate('USD', 'GBP', '0.7'), exchangeRate('JPY', 'USD', '0.0071')]),
    );
    const cmp = comparator(inconsistent, { base: 'EUR' });
    const amount = fc
      .tuple(fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), fc.constantFrom('EUR', 'USD', 'GBP', 'JPY'))
      .map(([minor, currency]) => fromMinor(minor, currency));
    fc.assert(
      fc.property(amount, amount, amount, (first, second, third) => {
        expect(cmp(first, second)).toBe(-cmp(second, first) || 0);
        if (cmp(first, second) <= 0 && cmp(second, third) <= 0) {
          expect(cmp(first, third)).toBeLessThanOrEqual(0);
        }
        if (cmp(first, second) === 0 && cmp(second, third) === 0) {
          expect(cmp(first, third)).toBe(0);
        }
      }),
      { numRuns: 3000 },
    );
  });
});

describe('sortByValue', () => {
  it('sorts like the comparator, and checks every rate before reordering', () => {
    const list = [money('100', 'JPY'), money('1', 'GBP'), money('1', 'USD'), money('1', 'EUR')];
    const sorted = sortByValue(list, fx, { base: 'EUR' });
    expect(sorted.map(String)).toEqual(['100 JPY', '1.00 USD', '1.00 EUR', '1.00 GBP']);
    expect(list.map(String)).toEqual(['100 JPY', '1.00 GBP', '1.00 USD', '1.00 EUR']); // input untouched
    const withChf = [money('1', 'GBP'), money('1', 'EUR'), money('1', 'CHF')];
    expect(() => sortByValue(withChf, fx, { base: 'EUR' })).toThrow(RateUnavailableError);
    // equal values keep their input order
    const tie = [money('1.1165', 'USD', { scale: 4 }), money('1', 'EUR')];
    expect(sortByValue(tie, fx, { base: 'EUR' })).toEqual(tie);
  });
});
