// Network fetchers for published reference rates, using the platform fetch. Opt-in: nothing else in
// the library imports this module, so core and @ducatjs/money/convert never touch the
// network. You decide when to call it and how to cache.
import { parseBankOfCanadaJson } from './boc.js';
import { parseEcbXml } from './ecb.js';
import type { RateTable } from './provider.js';

/**
 * The part of the platform AbortSignal used here. Declared structurally so the library needs no DOM
 * or Node types; any real AbortSignal fits.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** The subset of the platform fetch used here (Node 24+, Deno, Bun, browsers, workers). */
export type Fetch = (
  url: string,
  init?: { signal?: AbortSignalLike; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The platform's AbortSignal statics, where they exist. */
type AbortSignalStatics = {
  timeout?: (milliseconds: number) => AbortSignalLike;
  any?: (signals: AbortSignalLike[]) => AbortSignalLike;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/** The ECB's eurofxref files: the latest day, the last 90 days, and the full history since 1999. */
export const ECB_URLS = {
  daily: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  '90d': 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
  all: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
} as const;

/** Options for fetching ECB reference rates. */
export interface FetchEcbOptions {
  /** 'daily' (default): the latest day; '90d': the last 90 days; 'all': since 1999 (several MB). */
  readonly history?: keyof typeof ECB_URLS;
  /** An AbortSignal to cancel the request; it is combined with the timeout. */
  readonly signal?: AbortSignalLike;
  /**
   * Milliseconds before the request is aborted (default 30 000; 0 for no timeout). It needs the
   * platform's AbortSignal.timeout, which Node 24, Deno, Bun and current browsers all have.
   */
  readonly timeout?: number;
  /** A fetch to use instead of the global one (for proxies, retries or tests). */
  readonly fetch?: Fetch;
}

/** Thrown when the HTTP request completes without a 2xx status. */
export class FetchRatesError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(url: string, status: number) {
    super(`GET ${url} failed with HTTP ${status}`);
    this.name = 'FetchRatesError';
    this.status = status;
    this.url = url;
  }
}

/**
 * Fetches the ECB euro reference rates and parses them with parseEcbXml: EUR-based tables,
 * newest first. The ECB publishes once per TARGET working day at about 16:00 CET and states
 * that its rates are for information purposes only.
 *
 *     const [latest] = await fetchEcb(); // the RateTable for the last published day
 *     const hist = snapshotsFrom(await fetchEcb({ history: '90d' }));
 */
export async function fetchEcb(options?: FetchEcbOptions): Promise<RateTable[]> {
  const url = ECB_URLS[options?.history ?? 'daily'];
  const body = await getText(url, 'application/xml', options);
  try {
    return parseEcbXml(body);
  } catch (error) {
    // An error page or a captive portal is the usual cause, so say where the bad file came from.
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`${error.message} (from ${url})`, { cause: error });
    }
    throw error;
  }
}

/** The caller's signal, a timeout signal, or both combined. */
function requestSignal(
  signal: AbortSignalLike | undefined,
  timeout: number,
): AbortSignalLike | undefined {
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new RangeError(`timeout must be a non-negative number of milliseconds, got ${timeout}`);
  }
  const statics = (globalThis as unknown as { AbortSignal?: AbortSignalStatics }).AbortSignal;
  if (timeout === 0 || statics?.timeout === undefined) {
    return signal;
  }

  const timeoutSignal = statics.timeout(timeout);
  if (signal === undefined) {
    return timeoutSignal;
  }
  if (statics.any === undefined) {
    // Without AbortSignal.any the caller's signal wins: it is the one they can control.
    return signal;
  }
  return statics.any([signal, timeoutSignal]);
}

/** GETs `url` as text, with the timeout and signal handling every fetcher here shares. */
async function getText(
  url: string,
  accept: string,
  options: Omit<FetchEcbOptions, 'history'> | undefined,
): Promise<string> {
  const fetchFunction = options?.fetch ?? (globalThis as { fetch?: Fetch }).fetch;
  if (fetchFunction === undefined) {
    throw new TypeError('No fetch available: pass options.fetch');
  }
  const init: { signal?: AbortSignalLike; headers: Record<string, string> } = {
    headers: { accept },
  };
  const signal = requestSignal(options?.signal, options?.timeout ?? DEFAULT_TIMEOUT_MS);
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetchFunction(url, init);
  if (!response.ok) {
    throw new FetchRatesError(url, response.status);
  }
  return response.text();
}

/** A UTC day for a request, or RangeError. */
function requestDay(time: string | Date, name: string): string {
  const day = (typeof time === 'string' ? time : time.toISOString()).slice(0, 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || Number.isNaN(Date.parse(day))) {
    throw new RangeError(`${name} must be a date, got ${String(time)}`);
  }
  return day;
}

/** The Bank of Canada's Valet API for its daily exchange rates (no key; CORS-enabled). */
export const BANK_OF_CANADA_URL =
  'https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json';

/** Options for fetching Bank of Canada rates. */
export interface FetchBankOfCanadaOptions extends Omit<FetchEcbOptions, 'history'> {
  /** The first day (2017-01-03 at the earliest). Default: only the latest published day. */
  readonly start?: string | Date;
  /** The last day (default: the latest published). */
  readonly end?: string | Date;
}

/**
 * Fetches the Bank of Canada's daily exchange rates from its Valet API and parses them with
 * parseBankOfCanadaJson: CAD-based tables, newest first. Without `start`, only the latest day.
 * The Bank asks you not to exceed its (unpublished) request limits, and its rates are "released
 * for statistical and analytical purposes only", not for transactions.
 *
 *     const [latest] = await fetchBankOfCanada();
 *     const year = await fetchBankOfCanada({ start: '2026-01-01' });
 */
export async function fetchBankOfCanada(options?: FetchBankOfCanadaOptions): Promise<RateTable[]> {
  let query = '?recent=1';
  if (options?.start !== undefined) {
    query = `?start_date=${requestDay(options.start, 'start')}`;
    if (options.end !== undefined) {
      query += `&end_date=${requestDay(options.end, 'end')}`;
    }
  } else if (options?.end !== undefined) {
    throw new RangeError('end needs a start');
  }
  const url = `${BANK_OF_CANADA_URL}${query}`;
  const body = await getText(url, 'application/json', options);
  try {
    return parseBankOfCanadaJson(body);
  } catch (error) {
    // An error page or a captive portal is the usual cause, so say where the bad file came from.
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`${error.message} (from ${url})`, { cause: error });
    }
    throw error;
  }
}
