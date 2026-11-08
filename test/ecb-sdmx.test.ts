import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEcbSdmxCsv, parseEcbSdmxDecimals, parseEcbXml } from '../src/ecb.js';
import { ECB_DATA_API, fetchEcbRange, FetchRatesError, type Fetch } from '../src/fetch.js';
import { rateHistory } from '../src/history.js';
import { exchangeRate } from '../src/rate.js';

function fixture(name: string): string {
  return readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
}

// Fetched from data-api.ecb.europa.eu on 2026-11-08: USD, JPY, ISK and BGN for the 2025 Christmas
// holidays with full detail, the same without attributes, the series' DECIMALS, and the last
// observation of every series.
const full = fixture('ecb-sdmx/exr-d-full.csv');
const dataOnly = fixture('ecb-sdmx/exr-d-dataonly.csv');
const series = fixture('ecb-sdmx/exr-d-nodata.csv');
const lastObservations = fixture('ecb-sdmx/exr-d-last1.csv');
const daily = fixture('ecb/eurofxref-daily.xml');

const HEADER = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE';
const row = (currency: string, day: string, value: string) =>
  `EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${day},${value}`;

describe('parseEcbSdmxCsv', () => {
  it('one EUR table per TARGET day, newest first, holidays absent', () => {
    const tables = parseEcbSdmxCsv(full);
    expect(tables.map((table) => table.asOf)).toEqual([
      '2026-01-06',
      '2026-01-05',
      '2026-01-02',
      '2025-12-31',
      '2025-12-30',
      '2025-12-29',
      '2025-12-24',
      '2025-12-23',
      '2025-12-22',
    ]);
    const [newest] = tables;
    expect(newest).toMatchObject({ base: 'EUR', asOf: '2026-01-06' });
    expect(newest!.rate('EUR', 'USD')).toMatchObject({ source: 'ECB', type: 'reference' });
    // BGN's series ended when Bulgaria joined the euro
    expect(newest!.rate('EUR', 'BGN')).toBeUndefined();
    expect(tables[3]!.rate('EUR', 'BGN')?.toString()).toBe('1.9558');
  });

  it('rebuilds the published digits from DECIMALS', () => {
    const [newest] = parseEcbSdmxCsv(full);
    // the API sends 147.2 and 1.1707; the ECB publishes 147.20 and 1.1707
    expect(newest!.rate('EUR', 'ISK')?.toString()).toBe('147.20');
    const lastYear = parseEcbSdmxCsv(full).find((table) => table.asOf === '2025-12-31')!;
    expect(lastYear.rate('EUR', 'USD')?.toString()).toBe('1.1750');
    // a dataonly file has no DECIMALS: from the series file, or as given
    const decimals = parseEcbSdmxDecimals(series);
    expect(decimals).toEqual({ USD: 4, JPY: 2, ISK: 2 });
    const rebuilt = parseEcbSdmxCsv(dataOnly, { decimals });
    expect(rebuilt[0]!.rate('EUR', 'ISK')?.toString()).toBe('147.20');
    expect(parseEcbSdmxCsv(dataOnly)[0]!.rate('EUR', 'ISK')?.toString()).toBe('147.2');
    expect(parseEcbSdmxDecimals(full)).toMatchObject({ USD: 4, JPY: 2, ISK: 2, BGN: 4 });
  });

  it('matches eurofxref-daily.xml digit for digit on the same day', () => {
    const xml = parseEcbXml(daily)[0]!;
    const sdmx = parseEcbSdmxCsv(lastObservations).find((table) => table.asOf === xml.asOf)!;
    const published = (table: typeof xml) =>
      Object.fromEntries(table.rates.map((rate) => [rate.to, rate.toString()]));
    expect(published(sdmx)).toEqual(published(xml));
  });

  it('pads THB and LTL only to the decimals the ECB published, not their DECIMALS', () => {
    const csv = `${HEADER},DECIMALS\n${row('THB', '2026-11-06', '37.459')},4\n${row('LTL', '2014-12-31', '3.4528')},5\n${row('THB', '2026-11-05', '37.46')},4`;
    const [newer, older] = parseEcbSdmxCsv(csv);
    expect(newer!.rate('EUR', 'THB')?.toString()).toBe('37.459');
    expect(older!.rate('EUR', 'THB')?.toString()).toBe('37.460');
    expect(parseEcbSdmxCsv(csv).at(-1)!.rate('EUR', 'LTL')?.toString()).toBe('3.4528');
  });

  it('keeps discontinued series on their own last days', () => {
    const tables = parseEcbSdmxCsv(lastObservations);
    const lastDay = (currency: string) =>
      tables.find((table) => table.rate('EUR', currency) !== undefined)?.asOf;
    expect(lastDay('RUB')).toBe('2022-03-01');
    expect(lastDay('ARS')).toBe('2020-10-30');
    expect(lastDay('USD')).toBe('2026-11-06');
  });

  it('feeds rateHistory: a Sunday falls back to Friday, the holidays to before them', () => {
    const history = rateHistory(parseEcbSdmxCsv(full));
    const christmas = history.lookup('EUR', 'USD', { asOf: '2025-12-26' });
    expect(christmas.rate?.asOf).toBe('2025-12-24');
    expect(christmas.skipped.map((fallback) => fallback.reason)).toEqual(['noTable', 'noTable']);
  });

  it('reads quoted cells, CRLF and a byte order mark; missing values are missing', () => {
    const csv = `﻿${HEADER},TITLE\r\n${row('USD', '2026-11-06', '1.1165')},"a, ""b"""\r\n${row('JPY', '2026-11-06', '')},x\r\n${row('ISK', '2026-11-06', 'NaN')},x\r\n`;
    const [table] = parseEcbSdmxCsv(csv);
    expect(table!.rate('EUR', 'USD')?.toString()).toBe('1.1165');
    expect(table!.missing).toEqual(['JPY', 'ISK']);
  });

  it('refuses what is not a daily EUR reference rate', () => {
    expect(() => parseEcbSdmxCsv('<html>error</html>')).toThrow(SyntaxError);
    expect(() => parseEcbSdmxCsv('')).toThrow(SyntaxError);
    const monthly = `${HEADER}\nEXR.M.USD.EUR.SP00.A,M,USD,EUR,SP00,A,2026-10,1.16`;
    expect(() => parseEcbSdmxCsv(monthly)).toThrow(/daily EUR/);
    const endOfPeriod = `${HEADER}\nEXR.D.USD.EUR.SP00.E,D,USD,EUR,SP00,E,2026-11-06,1.16`;
    expect(() => parseEcbSdmxCsv(endOfPeriod)).toThrow(/daily EUR/);
    const otherBase = `${HEADER}\nEXR.D.USD.GBP.SP00.A,D,USD,GBP,SP00,A,2026-11-06,1.3`;
    expect(() => parseEcbSdmxCsv(otherBase)).toThrow(/daily EUR/);
    const scaled = `${HEADER},UNIT_MULT\n${row('JPY', '2026-11-06', '1.7677')},2`;
    expect(() => parseEcbSdmxCsv(scaled)).toThrow(/UNIT_MULT/);
    expect(() => parseEcbSdmxCsv(`${HEADER}\n${row('USD', '2026-02-30', '1.1')}`)).toThrow(
      SyntaxError,
    );
    expect(() => parseEcbSdmxCsv(`${HEADER}\n${row('USD', '2026-11-06', '1.1x')}`)).toThrow(
      /USD on 2026-11-06/,
    );
  });

  it('keeps any rate exactly, with at least the stated decimals (property)', () => {
    const published = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.integer({ min: 0, max: 6 }))
      .map(([digits, scale]) => exchangeRate('X', 'Y', `${digits}/${10n ** BigInt(scale)}`))
      .map((rate) => rate.toString());
    fc.assert(
      fc.property(published, fc.integer({ min: 0, max: 8 }), (value, decimals) => {
        const csv = `${HEADER},DECIMALS\n${row('USD', '2026-11-06', value)},${decimals}`;
        const rate = parseEcbSdmxCsv(csv)[0]!.rate('EUR', 'USD')!;
        expect(rate.ratio).toEqual(exchangeRate('EUR', 'USD', value).ratio);
        const text = rate.toString();
        const places = text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
        expect(places).toBeGreaterThanOrEqual(decimals);
      }),
    );
  });
});

describe('fetchEcbRange', () => {
  function fakeApi(seen: string[], status = 200): Fetch {
    return async (url) => {
      seen.push(url);
      const body = url.includes('detail=nodata') ? series : dataOnly;
      return { ok: status === 200, status, text: async () => body };
    };
  }

  it('asks for the series decimals and the observations, and rebuilds the digits', async () => {
    const seen: string[] = [];
    const tables = await fetchEcbRange({
      start: '2025-12-22',
      end: new Date(Date.UTC(2026, 0, 6, 12)),
      currencies: ['USD', 'JPY', 'ISK'],
      fetch: fakeApi(seen),
    });
    expect(seen.sort()).toEqual([
      `${ECB_DATA_API}/D.USD+JPY+ISK.EUR.SP00.A?format=csvdata&detail=nodata`,
      `${ECB_DATA_API}/D.USD+JPY+ISK.EUR.SP00.A?format=csvdata&startPeriod=2025-12-22&endPeriod=2026-01-06&detail=dataonly`,
    ]);
    expect(tables[0]!.rate('EUR', 'ISK')?.toString()).toBe('147.20');
    await fetchEcbRange({ start: '2026-01-01', fetch: fakeApi(seen) });
    expect(seen.at(-1)).toBe(
      `${ECB_DATA_API}/D..EUR.SP00.A?format=csvdata&startPeriod=2026-01-01&detail=dataonly`,
    );
  });

  it('validates its input before any request, and reports HTTP and format errors', async () => {
    const seen: string[] = [];
    const api = fakeApi(seen);
    await expect(fetchEcbRange({ start: 'yesterday', fetch: api })).rejects.toThrow(RangeError);
    await expect(
      fetchEcbRange({ start: '2026-01-01', currencies: ['USD&x=1'], fetch: api }),
    ).rejects.toThrow(RangeError);
    expect(seen).toEqual([]);
    await expect(fetchEcbRange({ start: '2026-01-01', fetch: fakeApi([], 503) })).rejects.toThrow(
      FetchRatesError,
    );
    const html: Fetch = async () => ({ ok: true, status: 200, text: async () => '<html/>' });
    await expect(fetchEcbRange({ start: '2026-01-01', fetch: html })).rejects.toThrow(
      /from https:\/\/data-api/,
    );
  });
});
