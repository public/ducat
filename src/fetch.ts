// Network fetchers for published reference rates, using the platform fetch. Opt-in: nothing else in
// the library imports this module, so core and ducat/convert never touch the network. You decide
// when to call it and how to cache.
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

export const ECB_URLS = {
  daily: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  '90d': 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
  all: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
} as const;

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
 * Fetches the ECB euro reference rates and parses them with parseEcbXml: EUR-based tables, newest first.
 * The ECB publishes once per TARGET working day at about 16:00 CET and states that its rates are for
 * information purposes only.
 *
 *     const [latest] = await fetchEcb();                      // RateTable for the last published day
 *     const hist = snapshotsFrom(await fetchEcb({ history: '90d' }));
 */
export async function fetchEcb(options?: FetchEcbOptions): Promise<RateTable[]> {
  const url = ECB_URLS[options?.history ?? 'daily'];
  const fetchFunction = options?.fetch ?? (globalThis as { fetch?: Fetch }).fetch;
  if (fetchFunction === undefined) {
    throw new TypeError('No fetch available: pass options.fetch');
  }

  const init: { signal?: AbortSignalLike; headers: Record<string, string> } = {
    headers: { accept: 'application/xml' },
  };
  const signal = requestSignal(options?.signal, options?.timeout ?? DEFAULT_TIMEOUT_MS);
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetchFunction(url, init);
  if (!response.ok) {
    throw new FetchRatesError(url, response.status);
  }

  const body = await response.text();
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
function requestSignal(signal: AbortSignalLike | undefined, timeout: number): AbortSignalLike | undefined {
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
