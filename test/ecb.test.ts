import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { money } from '../src/index.js';
import { parseEcbCsv, parseEcbXml } from '../src/ecb.js';
import { snapshotsFrom, via } from '../src/provider.js';

const fixture = (f: string) => readFileSync(new URL(`fixtures/ecb/${f}`, import.meta.url), 'utf8');

describe('ECB parsers', () => {
  it('parses the daily XML exactly as published', () => {
    const [t, ...rest] = parseEcbXml(fixture('eurofxref-daily.xml'));
    expect(rest).toEqual([]);
    expect(t).toMatchObject({ base: 'EUR', asOf: '2026-11-06' });
    expect(t!.rates.length).toBe(29);
    expect(t!.rate('EUR', 'USD')).toMatchObject({ source: 'ECB', type: 'reference', asOf: '2026-11-06' });
    expect(t!.rate('EUR', 'USD')?.toString()).toBe('1.1165');
    expect(t!.rate('EUR', 'IDR')?.toString()).toBe('20208.93');
    expect(t!.rate('EUR', 'HUF')?.ratio).toMatchObject({ num: 3639n, den: 10n });
    expect(t!.rate('EUR', 'RUB')).toBeUndefined();
    const usdGbp = via('EUR', t!).rate('USD', 'GBP')!;
    expect(usdGbp.convert(money('100', 'USD'), 'halfEven').toDecimal()).toBe('74.71'); // 83.415 / 1.1165
  });

  it('parses multi-day XML newest first', async () => {
    const days = parseEcbXml(fixture('eurofxref-hist-2d.xml'));
    expect(days.map((d) => d.asOf)).toEqual(['2026-11-06', '2026-11-05']);
    expect(days[1]!.rate('EUR', 'USD')?.toString()).toBe('1.1224');
    const hist = snapshotsFrom(days);
    expect((await hist.at('2026-11-08')).asOf).toBe('2026-11-06');
  });

  it('parses both CSV layouts and agrees with the XML', () => {
    const [daily] = parseEcbCsv(fixture('eurofxref.csv'));
    const [xml] = parseEcbXml(fixture('eurofxref-daily.xml'));
    expect(daily!.asOf).toBe('2026-11-06');
    expect(daily!.rates.map((r) => [r.to, r.ratio])).toEqual(xml!.rates.map((r) => [r.to, r.ratio]));
    const hist = parseEcbCsv(fixture('eurofxref-hist.csv'));
    expect(hist.map((d) => d.asOf)).toEqual(['2026-11-06', '2026-11-05', '2026-11-04']);
    expect(hist[0]!.rate('EUR', 'BGN')).toBeUndefined(); // N/A
    expect(hist[0]!.rates.map((r) => [r.to, r.ratio])).toEqual(xml!.rates.map((r) => [r.to, r.ratio]));
  });

  it('rejects other files', () => {
    expect(() => parseEcbXml('<html>Service unavailable</html>')).toThrow(SyntaxError);
    expect(() => parseEcbCsv('foo,bar\n1,2')).toThrow(SyntaxError);
    expect(() => parseEcbCsv('Date,USD\n31 Smarch 2026,1.1')).toThrow(SyntaxError);
  });
});
