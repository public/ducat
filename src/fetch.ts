// Network fetchers for published reference rates, using the platform fetch. Opt-in: nothing else in
// the library imports this module, so core and ducat/convert never touch the network. You decide
// when to call it and how to cache.
import { parseEcbXml } from './ecb.js';
import type { RateTable } from './provider.js';

/** The subset of the platform fetch used here (Node 18+, Deno, Bun, browsers, workers). */
export type Fetch = (
  url: string,
  init?: { signal?: unknown; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export const ECB_URLS = {
  daily: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  '90d': 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
  all: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
} as const;

export interface FetchEcbOptions {
  /** 'daily' (default): the latest day; '90d': the last 90 days; 'all': since 1999 (several MB). */
  readonly history?: keyof typeof ECB_URLS;
  /** An AbortSignal, e.g. AbortSignal.timeout(10_000). */
  readonly signal?: unknown;
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

  const init: { signal?: unknown; headers: Record<string, string> } = {
    headers: { accept: 'application/xml' },
  };
  if (options?.signal !== undefined) {
    init.signal = options.signal;
  }
  const response = await fetchFunction(url, init);
  if (!response.ok) {
    throw new FetchRatesError(url, response.status);
  }
  return parseEcbXml(await response.text());
}
