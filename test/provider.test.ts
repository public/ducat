import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { money } from '../src/fn.js';
import {
  chain,
  identity,
  rateOf,
  rateTable,
  RateUnavailableError,
  reversed,
  snapshots,
  snapshotsFrom,
  via,
  type RateProvider,
} from '../src/provider.js';
import { exchangeRate } from '../src/rate.js';

const ecb = rateTable({
  base: 'EUR',
  source: 'ECB',
  asOf: '2026-11-06',
  type: 'mid',
  rates: { USD: '1.1165', JPY: '176.77', GBP: '0.83415' },
});

describe('providers', () => {
  it('rateTable answers only the pairs it holds, from its asOf on', () => {
    const r = ecb.rate('EUR', 'USD')!;
    expect(r.toString()).toBe('1.1165');
    expect(r).toMatchObject({ source: 'ECB', asOf: '2026-11-06', type: 'mid' });
    expect(ecb).toMatchObject({ base: 'EUR', asOf: '2026-11-06' });
    expect(ecb.rate('USD', 'EUR')).toBeUndefined();
    expect(ecb.rate('EUR', 'USD', { asOf: '2026-11-08' })).toBe(r);
    // whole UTC days: any time on the table's day gets it, even before the ECB's ~15:00 UTC publication
    expect(ecb.rate('EUR', 'USD', { asOf: '2026-11-06T09:00:00Z' })).toBe(r);
    // instants are compared as UTC: 23:30 at UTC-5 on the 5th is already the 6th
    expect(ecb.rate('EUR', 'USD', { asOf: '2026-11-05T23:30:00-05:00' })).toBe(r);
    expect(ecb.rate('EUR', 'USD', { asOf: new Date(Date.UTC(2026, 10, 5, 23)) })).toBeUndefined();
    expect(ecb.rate('EUR', 'USD', { asOf: '2026-11-05' })).toBeUndefined();
    const list = rateTable([exchangeRate('USD', 'CAD', '1.40')]);
    expect(list.rate('USD', 'CAD')?.toString()).toBe('1.40');
    expect(list.base).toBeUndefined();
  });

  it('identity, reversed and chain', () => {
    expect(identity().rate('EUR', 'EUR')?.toString()).toBe('1');
    expect(identity().rate('EUR', 'USD')).toBeUndefined();
    expect(reversed(ecb).rate('USD', 'EUR')?.toString()).toBe('2000/2233');
    const p = chain(identity(), ecb, reversed(ecb));
    expect(p.rate('GBP', 'EUR')?.ratio).toMatchObject({ num: 20000n, den: 16683n });
    expect(p.rate('USD', 'JPY')).toBeUndefined();
  });

  it('via triangulates exactly and keeps the audit chain', () => {
    const p = via('EUR', ecb);
    const usdJpy = p.rate('USD', 'JPY')!;
    expect(usdJpy.ratio).toMatchObject({ num: 32140n, den: 203n }); // 176.77 / 1.1165, reduced
    expect(usdJpy.derivedFrom?.length).toBe(2);
    expect(usdJpy.asOf).toBe('2026-11-06');
    expect(p.rate('EUR', 'GBP')?.toString()).toBe('0.83415');
    expect(p.rate('GBP', 'EUR')?.ratio.den).toBe(16683n);
    expect(p.rate('USD', 'CHF')).toBeUndefined();
    expect(p.rate('USD', 'USD')).toBeUndefined();
    // converting through the provider rounds once
    expect(usdJpy.convert(money('100', 'USD'), 'halfEven').toDecimal()).toBe('15833'); // 15832.51...
  });

  it('rateOf rejects a provider that answers with the wrong pair', () => {
    const liar: RateProvider = { rate: () => exchangeRate('EUR', 'GBP', '0.83') as never };
    expect(() => rateOf(liar, 'EUR', 'USD')).toThrow(/currency/i);
    const backwards: RateProvider = { rate: () => exchangeRate('USD', 'EUR', '0.9') as never };
    expect(() => rateOf(backwards, 'EUR', 'USD')).toThrow(/currency/i);
  });

  it('via equals a consistent direct rate', () => {
    const quote = fc
      .tuple(fc.bigInt({ min: 1n, max: 99_999_999n }), fc.integer({ min: 0, max: 6 }))
      .map(([digits, scale]) => `${digits}e-${scale}`)
      .map((s) => exchangeRate('X', 'Y', Number(s)).toString());
    fc.assert(
      fc.property(quote, quote, quote, (eurUsd, usdJpy, usdGbp) => {
        // a consistent EUR table derived from direct USD cross rates
        const eurUsdRate = exchangeRate('EUR', 'USD', eurUsd);
        const table = rateTable({
          base: 'EUR',
          rates: {
            USD: eurUsd,
            JPY: eurUsdRate.andThen(exchangeRate('USD', 'JPY', usdJpy)).toString(),
            GBP: eurUsdRate.andThen(exchangeRate('USD', 'GBP', usdGbp)).toString(),
          },
        });
        const fx = via('EUR', table);
        expect(fx.rate('USD', 'JPY')?.ratio).toEqual(exchangeRate('USD', 'JPY', usdJpy).ratio);
        expect(fx.rate('GBP', 'USD')?.ratio).toEqual(
          exchangeRate('USD', 'GBP', usdGbp).inverse().ratio,
        );
      }),
    );
  });

  it('rateOf throws RateUnavailableError with the pair and asOf', () => {
    expect(() => rateOf(ecb, 'USD', 'CHF', { asOf: '2026-11-06' })).toThrow(RateUnavailableError);
    try {
      rateOf(ecb, 'USD', 'CHF', { asOf: new Date(Date.UTC(2026, 10, 6)) });
    } catch (e) {
      expect(e).toMatchObject({ from: 'USD', to: 'CHF', asOf: '2026-11-06T00:00:00.000Z' });
      expect(String(e)).toContain('USD→CHF');
    }
  });
});

describe('snapshots', () => {
  const days: Record<string, RateProvider> = { '2026-11-06': ecb, '2026-11-02': ecb };
  it('takes the latest table at or before asOf within the lookback, and caches hits only', async () => {
    const calls: string[] = [];
    const hist = snapshots(async (d) => {
      calls.push(d);
      return days[d];
    });
    expect(await hist.at('2026-11-08')).toBe(ecb); // Sunday -> Friday
    expect(calls).toEqual(['2026-11-08', '2026-11-07', '2026-11-06']);
    calls.length = 0;
    expect(await hist.at('2026-11-08T12:00:00Z')).toBe(ecb);
    expect(calls).toEqual(['2026-11-08', '2026-11-07']); // misses are retried, the hit is cached
    await expect(hist.at('2026-11-01')).rejects.toThrow(RateUnavailableError);
    await expect(
      snapshots(async () => undefined, { lookback: 0 }).at('2026-11-06'),
    ).rejects.toThrow(/2026-11-06/);
    await expect(hist.at('not a date')).rejects.toThrow(RangeError);
    // a Date and an offset instant resolve to their UTC day
    calls.length = 0;
    await hist.at('2026-11-06T22:00:00-05:00'); // 03:00Z on the 7th
    expect(calls[0]).toBe('2026-11-07');
    expect(() => snapshots(async () => undefined, { lookback: -1 })).toThrow(RangeError);
    expect(() => snapshots(async () => undefined, { lookback: 1.5 })).toThrow(RangeError);
    expect(() => snapshots(async () => undefined, { max: 0 })).toThrow(RangeError);
  });

  it('retries a load that failed and bounds the cache', async () => {
    let n = 0;
    const hist = snapshots(
      async (d) => {
        n++;
        if (n === 1) throw new Error('network');
        return d.endsWith('6') || d.endsWith('5') ? ecb : undefined;
      },
      { lookback: 0, max: 1 },
    );
    await expect(hist.at('2026-11-06')).rejects.toThrow('network');
    expect(await hist.at('2026-11-06')).toBe(ecb);
    expect(await hist.at('2026-11-05')).toBe(ecb);
    expect(await hist.at('2026-11-06')).toBe(ecb);
    expect(n).toBe(4); // 06 was evicted by 05
  });

  it('a slow miss does not evict a newer load for the same day', async () => {
    const loads: Array<(table: RateProvider | undefined) => void> = [];
    const hist = snapshots(
      (day) =>
        day === '2026-11-05'
          ? Promise.resolve(ecb)
          : new Promise((resolve) => {
              loads.push(resolve);
            }),
      { lookback: 0, max: 1 },
    );
    const slow = hist.at('2026-11-06'); // first load of the 6th, still pending
    expect(await hist.at('2026-11-05')).toBe(ecb); // evicts the pending 6th
    const fresh = hist.at('2026-11-06'); // second load of the 6th
    loads[1]!(ecb);
    expect(await fresh).toBe(ecb);
    loads[0]!(undefined); // the first load now misses: it must not drop the second's entry
    await expect(slow).rejects.toThrow(RateUnavailableError);
    expect(await hist.at('2026-11-06')).toBe(ecb);
    expect(loads).toHaveLength(2);
  });

  it('snapshotsFrom indexes tables by day', async () => {
    const thu = rateTable({ base: 'EUR', asOf: '2026-11-05', rates: { USD: '1.1224' } });
    const hist = snapshotsFrom([ecb, thu]);
    expect((await hist.at('2026-11-05')).rate('EUR', 'USD')?.toString()).toBe('1.1224');
    expect(await hist.at('2026-11-09')).toBe(ecb);
  });
});

describe('convert through a provider', () => {
  it('looks the rate up, as of a time, and rounds once', async () => {
    const { convert } = await import('../src/plugins/convert.js');
    const fx = via('EUR', ecb);
    expect(convert(money('100', 'USD'), 'JPY', fx, 'halfEven').toDecimal()).toBe('15833');
    expect(money('100', 'USD').convert('JPY', fx, 'halfEven').toDecimal()).toBe('15833');
    expect(
      convert(money('100', 'USD'), 'JPY', fx, 'halfEven', {
        asOf: '2026-11-08',
        scale: 2,
      }).toDecimal(),
    ).toBe('15832.51');
    expect(() => convert(money('1', 'USD'), 'JPY', fx, 'halfEven', { asOf: '2026-11-05' })).toThrow(
      RateUnavailableError,
    );
    expect(() => convert(money('1', 'USD'), 'CHF', fx)).toThrow(/USD→CHF/);
  });
});
