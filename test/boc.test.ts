import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBankOfCanadaJson } from '../src/boc.js';
import {
  BANK_OF_CANADA_URL,
  fetchBankOfCanada,
  FetchRatesError,
  type Fetch,
} from '../src/fetch.js';
import { money } from '../src/fn.js';
import { rateHistory } from '../src/history.js';
import { via } from '../src/provider.js';
import { convert } from '../src/convert.js';
import { exchangeRate } from '../src/rate.js';

// Fetched from bankofcanada.ca/valet on 2026-11-08: FX_RATES_DAILY over the 2025 Christmas holidays.
const valet = readFileSync(new URL('fixtures/boc/fx-rates-daily.json', import.meta.url), 'utf8');

const observations = (rows: readonly object[]) => JSON.stringify({ observations: rows });

describe('parseBankOfCanadaJson', () => {
  it('one CAD table per business day, newest first, with the published quotes', () => {
    const tables = parseBankOfCanadaJson(valet);
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
    const oldest = tables.at(-1)!;
    const cadUsd = oldest.rate('CAD', 'USD')!;
    expect(cadUsd).toMatchObject({ source: 'BoC', type: 'average', asOf: '2025-12-22' });
    expect(cadUsd.quote).toEqual({ rate: '1.3748', inverted: true });
    expect(cadUsd.toString()).toBe('2500/3437'); // 1 / 1.3748, exactly
    expect(cadUsd.inverse().toString()).toBe('1.3748');
    // trailing zeros as published
    expect(oldest.rate('CAD', 'JPY')!.inverse().toString()).toBe('0.008760');
    expect(oldest.rate('CAD', 'CHF')!.inverse().toString()).toBe('1.7350');
    // series listed in seriesDetail but absent on a day (MYR, PLN, THB and VND, on every day of
    // the fixture) are missing that day, not "not quoted"
    expect(oldest.rate('CAD', 'MYR')).toBeUndefined();
    expect(oldest.missing).toEqual(expect.arrayContaining(['MYR', 'PLN', 'THB', 'VND']));
  });

  it('is available from 16:30 Toronto time, summer time included', () => {
    const winter = parseBankOfCanadaJson(valet).at(-1)!;
    expect(winter.availableAt).toBe('2025-12-22T21:30:00.000Z');
    expect(winter.rate('CAD', 'USD', { asOf: '2025-12-22T21:00:00Z' })).toBeUndefined();
    expect(winter.rate('CAD', 'USD', { asOf: '2025-12-22T21:30:00Z' })).toBeDefined();
    const [summer] = parseBankOfCanadaJson(
      observations([{ d: '2026-07-06', FXUSDCAD: { v: '1.3600' } }]),
    );
    expect(summer!.availableAt).toBe('2026-07-06T20:30:00.000Z');
    // the day the clocks go forward (8 March 2026) is already summer time at 16:30
    const [change] = parseBankOfCanadaJson(
      observations([{ d: '2026-03-09', FXUSDCAD: { v: '1.4400' } }]),
    );
    expect(change!.availableAt).toBe('2026-03-09T20:30:00.000Z');
    // and in autumn: still summer time on Friday 30 October, winter time from 1 November
    const autumn = parseBankOfCanadaJson(
      observations([
        { d: '2026-10-30', FXUSDCAD: { v: '1.3800' } },
        { d: '2026-11-02', FXUSDCAD: { v: '1.3810' } },
      ]),
    );
    expect(autumn.map((table) => table.availableAt)).toEqual([
      '2026-11-02T21:30:00.000Z',
      '2026-10-30T20:30:00.000Z',
    ]);
    // a different publication time, or none
    const july = observations([{ d: '2026-07-06', FXUSDCAD: { v: '1.36' } }]);
    const [custom] = parseBankOfCanadaJson(july, { availableAt: (day) => `${day}T23:00:00Z` });
    expect(custom!.availableAt).toBe('2026-07-06T23:00:00.000Z');
    const [none] = parseBankOfCanadaJson(july, { availableAt: false });
    expect(none!.availableAt).toBeUndefined();
  });

  it('converts both ways through CAD, rounding once', () => {
    const history = rateHistory(parseBankOfCanadaJson(valet));
    const fx = via('CAD', history);
    // 100 USD → CAD at 1.3748 → EUR at 1 / 1.6161, on 22 December
    const eur = convert(money('100.00', 'USD'), 'EUR', fx, 'halfEven', { asOf: '2025-12-22' });
    expect(eur.toDecimal()).toBe('85.07');
    // Christmas falls back to the 24th
    expect(history.rate('CAD', 'USD', { asOf: '2025-12-26' })?.asOf).toBe('2025-12-24');
  });

  it('missing values, and files that are not Valet', () => {
    const [table] = parseBankOfCanadaJson(
      observations([{ d: '2026-11-06', FXUSDCAD: { v: '1.3654' }, FXEURCAD: { v: '' } }]),
    );
    expect(table!.missing).toEqual(['EUR']);
    // a day with nothing published is left out
    expect(parseBankOfCanadaJson(observations([{ d: '2026-11-06', FXUSDCAD: { v: '' } }]))).toEqual(
      [],
    );
    // a null value is missing too
    const [nullValue] = parseBankOfCanadaJson(
      observations([{ d: '2026-11-06', FXUSDCAD: { v: '1.3654' }, FXEURCAD: { v: null } }]),
    );
    expect(nullValue!.missing).toEqual(['EUR']);
    // anything but daily FX…CAD series throws: other data, monthly and annual groups
    expect(() =>
      parseBankOfCanadaJson(
        observations([{ d: '2026-11-06', FXUSDCAD: { v: '1.3654' }, V39079: { v: '2.25' } }]),
      ),
    ).toThrow(/V39079/);
    const monthly = JSON.stringify({
      seriesDetail: { FXMUSDCAD: {} },
      observations: [{ d: '2026-10-01', FXMUSDCAD: { v: '1.3800' } }],
    });
    expect(() => parseBankOfCanadaJson(monthly)).toThrow(/FXMUSDCAD/);
    // one day twice: a repeat merges, a contradiction throws
    const repeated = parseBankOfCanadaJson(
      observations([
        { d: '2026-11-06', FXUSDCAD: { v: '1.36' } },
        { d: '2026-11-06', FXUSDCAD: { v: '1.36' }, FXEURCAD: { v: '1.60' } },
      ]),
    );
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.rates).toHaveLength(2);
    expect(() =>
      parseBankOfCanadaJson(
        observations([
          { d: '2026-11-06', FXUSDCAD: { v: '1.36' } },
          { d: '2026-11-06', FXUSDCAD: { v: '1.37' } },
        ]),
      ),
    ).toThrow(/Two different values for FXUSDCAD on 2026-11-06/);
    expect(() => parseBankOfCanadaJson(observations([{ d: '2026-02-30' }]))).toThrow(SyntaxError);
    expect(() =>
      parseBankOfCanadaJson(observations([{ d: '2026-11-06', FXUSDCAD: { v: '0.0000' } }])),
    ).toThrow(/zero rate/);
    expect(() => parseBankOfCanadaJson('<html>')).toThrow(SyntaxError);
    expect(() => parseBankOfCanadaJson('{"error":"x"}')).toThrow(SyntaxError);
    expect(() => parseBankOfCanadaJson(observations([{ d: '06/11/2026' }]))).toThrow(SyntaxError);
    expect(() =>
      parseBankOfCanadaJson(observations([{ d: '2026-11-06', FXUSDCAD: { v: 1.3654 } }])),
    ).toThrow(/FXUSDCAD on 2026-11-06/);
    expect(() =>
      parseBankOfCanadaJson(observations([{ d: '2026-11-06', FXUSDCAD: { v: '1,3654' } }])),
    ).toThrow(SyntaxError);
  });

  it('keeps every published rate exactly, both ways (property)', () => {
    const published = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 9n }), fc.integer({ min: 0, max: 6 }))
      .map(([digits, scale]) => {
        const text = digits.toString().padStart(scale + 1, '0');
        return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`;
      });
    fc.assert(
      fc.property(published, (value) => {
        const [table] = parseBankOfCanadaJson(
          observations([{ d: '2026-11-06', FXUSDCAD: { v: value } }]),
        );
        const cadUsd = table!.rate('CAD', 'USD')!;
        expect(cadUsd.inverse().toString()).toBe(value);
        expect(cadUsd.inverse().ratio).toEqual(exchangeRate('USD', 'CAD', value).ratio);
      }),
    );
  });
});

describe('fetchBankOfCanada', () => {
  function fakeValet(seen: string[], status = 200, body = valet): Fetch {
    return async (url) => {
      seen.push(url);
      return { ok: status === 200, status, text: async () => body };
    };
  }

  it('asks for the latest day, or a range', async () => {
    const seen: string[] = [];
    await fetchBankOfCanada({ fetch: fakeValet(seen) });
    const tables = await fetchBankOfCanada({
      start: '2025-12-22',
      end: new Date(Date.UTC(2026, 0, 6, 12)),
      fetch: fakeValet(seen),
    });
    expect(seen).toEqual([
      `${BANK_OF_CANADA_URL}?recent=1`,
      `${BANK_OF_CANADA_URL}?start_date=2025-12-22&end_date=2026-01-06`,
    ]);
    expect(tables).toHaveLength(9);
  });

  it('validates its input before any request, and reports HTTP and format errors', async () => {
    const seen: string[] = [];
    await expect(fetchBankOfCanada({ start: 'today', fetch: fakeValet(seen) })).rejects.toThrow(
      RangeError,
    );
    await expect(fetchBankOfCanada({ end: '2026-01-01', fetch: fakeValet(seen) })).rejects.toThrow(
      RangeError,
    );
    await expect(
      fetchBankOfCanada({ start: '2026-01-02', end: '2026-01-01', fetch: fakeValet(seen) }),
    ).rejects.toThrow(/before start/);
    await expect(
      fetchBankOfCanada({ start: '2026-02-30', fetch: fakeValet(seen) }),
    ).rejects.toThrow(RangeError);
    await expect(
      fetchBankOfCanada({ start: '2016-12-30', fetch: fakeValet(seen) }),
    ).rejects.toThrow(/2017-01-03/);
    expect(seen).toEqual([]);
    await expect(fetchBankOfCanada({ fetch: fakeValet([], 503) })).rejects.toThrow(FetchRatesError);
    await expect(fetchBankOfCanada({ fetch: fakeValet([], 200, '<html/>') })).rejects.toThrow(
      /from https:\/\/www.bankofcanada.ca/,
    );
  });
});
