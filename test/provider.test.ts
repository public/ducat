import { describe, expect, it } from 'vitest';
import { money } from '../src/index.js';
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
    expect(ecb.rate('EUR', 'USD', { asOf: '2026-11-06T09:00:00Z' })).toBe(r);
    expect(ecb.rate('EUR', 'USD', { asOf: '2026-11-05' })).toBeUndefined();
    const list = rateTable([exchangeRate('USD', 'CAD', '1.40')]);
    expect(list.rate('USD', 'CAD')?.toString()).toBe('1.4');
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
    await expect(snapshots(async () => undefined, { lookback: 0 }).at('2026-11-06')).rejects.toThrow(/2026-11-06/);
    await expect(hist.at('not a date')).rejects.toThrow(RangeError);
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
    expect(convert(money('100', 'USD'), 'JPY', fx, 'halfEven', { asOf: '2026-11-08', scale: 2 }).toDecimal()).toBe(
      '15832.51',
    );
    expect(() => convert(money('1', 'USD'), 'JPY', fx, 'halfEven', { asOf: '2026-11-05' })).toThrow(
      RateUnavailableError,
    );
    expect(() => convert(money('1', 'USD'), 'CHF', fx)).toThrow(/USD→CHF/);
  });
});
