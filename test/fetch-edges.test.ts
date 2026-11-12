// Request and error-path tests for src/fetch.ts with a recording fake fetch: no network. Option
// checks before any request, accept headers, signals and timeouts, HTTP errors, and how parse
// errors carry the URL.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BANK_OF_CANADA_URL,
  ECB_URLS,
  fetchBankOfCanada,
  fetchEcb,
  fetchEcbRange,
  FetchRatesError,
  type Fetch,
} from '../src/fetch.js';

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const daily = fixture('ecb/eurofxref-daily.xml');

type Call = { url: string; init: Parameters<Fetch>[1] };
function fakeFetch(respond: (url: string) => { status: number; body: string }) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const { status, body } = respond(url);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetch, calls };
}

// Assigned directly rather than through vi.stubGlobal, which Bun's test runner lacks.
const globals = globalThis as { fetch?: unknown };
const platformFetch = globals.fetch;
const setGlobalFetch = (fetch: unknown) => {
  globals.fetch = fetch;
};
afterEach(() => {
  globals.fetch = platformFetch;
});

describe('fetchEcb', () => {
  it('works without options, through the global fetch', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: daily }));
    setGlobalFetch(fetch);
    const [table] = await fetchEcb();
    expect(table!.asOf).toBe('2026-11-06');
    expect(calls.map((call) => [call.url, call.init?.headers?.accept])).toEqual([
      [ECB_URLS.daily, 'application/xml'],
    ]);
  });

  it('without any fetch, says how to pass one', async () => {
    setGlobalFetch(undefined);
    await expect(fetchEcb()).rejects.toThrow(
      new TypeError('No fetch available: pass options.fetch'),
    );
  });

  it('an HTTP error, 404 included, is a FetchRatesError', async () => {
    for (const status of [404, 503]) {
      const { fetch } = fakeFetch(() => ({ status, body: '' }));
      const error = await fetchEcb({ fetch }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(FetchRatesError);
      expect([(error as Error).name, (error as Error).message]).toEqual([
        'FetchRatesError',
        `GET ${ECB_URLS.daily} failed with HTTP ${status}`,
      ]);
    }
  });

  it('a parse error names the URL and keeps the cause; other errors pass through', async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: '<html>busy</html>' }));
    const error = (await fetchEcb({ fetch }).catch((caught: unknown) => caught)) as Error;
    expect(error).toBeInstanceOf(SyntaxError);
    expect(error.message).toBe(`Not an ECB reference rate file (from ${ECB_URLS.daily})`);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    const good = fakeFetch(() => ({ status: 200, body: daily }));
    const thrown = await fetchEcb({ fetch: good.fetch, availableAt: () => 'not a time' }).catch(
      (caught: unknown) => caught,
    );
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown).not.toBeInstanceOf(SyntaxError);
  });

  it('checks the timeout, and a timeout of 0 adds no signal', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: daily }));
    for (const timeout of [-1, Number.NaN, Infinity]) {
      await expect(fetchEcb({ fetch, timeout })).rejects.toThrow(
        new RangeError(`timeout must be a non-negative number of milliseconds, got ${timeout}`),
      );
    }
    expect(calls).toEqual([]);
    await fetchEcb({ fetch, timeout: 0 });
    expect(calls.length).toBe(1);
    expect(calls[0]!.init !== undefined && 'signal' in calls[0]!.init).toBe(false);
    await fetchEcb({ fetch });
    expect(calls[1]!.init?.signal?.aborted).toBe(false);
  });
});

describe('fetchEcbRange', () => {
  const nodata = fixture('ecb-sdmx/exr-d-nodata.csv');
  const dataOnly = fixture('ecb-sdmx/exr-d-dataonly.csv');
  const respond = (url: string) => ({
    status: 200,
    body: url.includes('detail=nodata') ? nodata : dataOnly,
  });

  it('checks codes and days before any request', async () => {
    const { fetch, calls } = fakeFetch(respond);
    for (const currency of ['usd', 'USDX', 'XUSD']) {
      await expect(
        fetchEcbRange({ fetch, start: '2026-01-01', currencies: [currency] }),
      ).rejects.toThrow(new RangeError(`Not an ISO currency code: ${currency}`));
    }
    for (const start of ['x2026-01-01', '2026-01-01x', '2026-02-30']) {
      await expect(fetchEcbRange({ fetch, start })).rejects.toThrow(
        new RangeError(`start must be a date, got ${start}`),
      );
    }
    await expect(fetchEcbRange({ fetch, start: '2026-01-02', end: '2026-02-30' })).rejects.toThrow(
      new RangeError('end must be a date, got 2026-02-30'),
    );
    await expect(fetchEcbRange({ fetch, start: '1999-01-03' })).rejects.toThrow(
      new RangeError("The ECB's rates start on 1999-01-04, not 1999-01-03"),
    );
    await expect(fetchEcbRange({ fetch, start: '2026-01-02', end: '2026-01-01' })).rejects.toThrow(
      new RangeError('end 2026-01-01 is before start 2026-01-02'),
    );
    expect(calls).toEqual([]);
    await fetchEcbRange({ fetch, start: '1999-01-04', end: '1999-01-04' });
    expect(calls.map((call) => call.init?.headers?.accept)).toEqual(['text/csv', 'text/csv']);
  });

  it('an already aborted signal aborts both requests', async () => {
    const { fetch, calls } = fakeFetch(respond);
    const outer = new AbortController();
    outer.abort(new Error('stop'));
    await fetchEcbRange({ fetch, start: '2026-01-01', signal: outer.signal }).catch(
      () => undefined,
    );
    expect(calls.map((call) => call.init?.signal?.aborted)).toEqual([true, true]);
  });
});

describe('fetchBankOfCanada', () => {
  const body = fixture('boc/fx-rates-daily.json');

  it('builds the query and checks its days', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body }));
    await fetchBankOfCanada({ fetch });
    await fetchBankOfCanada({ fetch, start: '2026-01-02' });
    await fetchBankOfCanada({ fetch, start: '2017-01-03', end: '2017-01-03' });
    expect(
      calls.map((call) => [call.url.slice(BANK_OF_CANADA_URL.length), call.init?.headers?.accept]),
    ).toEqual([
      ['?recent=1', 'application/json'],
      ['?start_date=2026-01-02', 'application/json'],
      ['?start_date=2017-01-03&end_date=2017-01-03', 'application/json'],
    ]);
    await expect(fetchBankOfCanada({ fetch, start: '2017-01-02' })).rejects.toThrow(
      new RangeError("Valet's daily rates start on 2017-01-03, not 2017-01-02"),
    );
    await expect(
      fetchBankOfCanada({ fetch, start: '2026-01-02', end: '2026-01-01' }),
    ).rejects.toThrow(new RangeError('end 2026-01-01 is before start 2026-01-02'));
    await expect(fetchBankOfCanada({ fetch, end: '2026-01-01' })).rejects.toThrow(
      new RangeError('end needs a start'),
    );
    await expect(fetchBankOfCanada({ fetch, start: '2026-02-30' })).rejects.toThrow(
      new RangeError('start must be a date, got 2026-02-30'),
    );
  });
});
