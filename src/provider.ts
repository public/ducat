// Rate providers: synchronous lookups over rates you already hold, and combinators over them.
// Loading rates (network, files, databases) is async and stays outside; `snapshots()` is the one
// async boundary.
import type { Factor } from './decimal.js';
import { CurrencyMismatchError } from './money.js';
import {
  exchangeRate,
  hasEnded,
  hasStarted,
  isRate,
  toIsoString,
  type Rate,
  type RateInfo,
} from './rate.js';

const DAY_MS = 86_400_000;

/** When a rate is wanted for. */
export interface RateQuery {
  /** An ISO-8601 date or instant, or a Date. */
  readonly asOf?: string | Date;
}

/** Looks up a rate synchronously. `undefined` when it has none for the pair (or for `asOf`). */
export interface RateProvider {
  rate<From extends string, To extends string>(
    from: From,
    to: To,
    query?: RateQuery,
  ): Rate<From, To> | undefined;
}

/** A fixed set of rates, as built by rateTable() and returned by the ECB parsers and fetchers. */
export interface RateTable extends RateProvider {
  readonly rates: readonly Rate[];
  /** The quoted currency, for a one-base table. */
  readonly base?: string;
  /** The table's date, when it has one. */
  readonly asOf?: string;
  /** When the table was published, when that is known. */
  readonly availableAt?: string;
  /** The last day (or instant) the table applies to, for a table valid for a period. */
  readonly validUntil?: string;
  /** Currencies the source listed without a value (holidays, `ND`, `N/A`). */
  readonly missing?: readonly string[];
}

/** Thrown when no provider has a rate for the pair. */
export class RateUnavailableError extends Error {
  readonly from: string;
  readonly to: string;
  readonly asOf: string | undefined;

  constructor(from: string, to: string, asOf?: string | Date) {
    let when: string | undefined;
    if (asOf !== undefined) {
      when = toIsoString(asOf);
    }
    let message = `No exchange rate ${from}→${to}`;
    if (when !== undefined) {
      message += ` as of ${when}`;
    }
    super(message);
    this.name = 'RateUnavailableError';
    this.from = from;
    this.to = to;
    this.asOf = when;
  }
}

/** The UTC date ('2026-11-06') of a date, an instant (any offset) or a Date. */
function dayOf(time: string | Date): string {
  return toIsoString(time).slice(0, 10);
}

/** The rate for the pair, or RateUnavailableError: a lookup that must succeed. */
export function rateOf<From extends string, To extends string>(
  provider: RateProvider,
  from: From,
  to: To,
  query?: RateQuery,
): Rate<From, To> {
  const rate = provider.rate(from, to, query);
  if (rate === undefined) {
    throw new RateUnavailableError(from, to, query?.asOf);
  }

  // A provider is user code: a wrong pair here would produce Money labelled with the wrong
  // currency.
  if (rate.from !== from) {
    throw new CurrencyMismatchError(from, rate.from);
  }
  if (rate.to !== to) {
    throw new CurrencyMismatchError(to, rate.to);
  }
  return rate;
}

/** 1:1 for a currency to itself; nothing otherwise. */
export function identity(): RateProvider {
  return {
    rate(from, to) {
      // Compared as strings: From and To are independent type parameters.
      if ((from as string) !== to) {
        return undefined;
      }
      return exchangeRate(from, to, 1n);
    },
  };
}

/**
 * A one-base table: `rates.USD` is the number of USD per 1 `base` (or a base → USD Rate), or null
 * when the source has no value for the day. For rates published the other way round or per 100
 * units, see `quotedTable` in `@ducatjs/money/convert/history`.
 */
export interface RateTableSpec extends Omit<RateInfo, 'quote'> {
  readonly base: string;
  readonly rates: Readonly<Record<string, Factor | Rate | null>>;
}

/**
 * A fixed table of rates: one base currency against many (ECB style), or a list of Rates. Only the
 * pairs given are answered; wrap it in `reversed()` or `via()` for the others.
 *
 * A query with an `asOf` gets nothing from a rate that doesn't apply then: one dated after it, one
 * published (`availableAt`) after it, or one whose `validUntil` has passed. Days are UTC days, and
 * a date query covers the whole day: without an `availableAt`, a query at any time on the rate's
 * own day gets the rate, even before the source published it (the ECB publishes at about 15:00
 * UTC). Give `availableAt` to rule that out.
 *
 *     const ecb = rateTable({ base: 'EUR', source: 'ECB', asOf: '2026-11-06', rates: { USD: '1.1165' } });
 */
export function rateTable(spec: RateTableSpec | readonly Rate[]): RateTable {
  let rates: Rate[];
  const header: {
    base?: string;
    asOf?: string;
    availableAt?: string;
    validUntil?: string;
    missing?: string[];
  } = {};
  if (isRateList(spec)) {
    rates = [...spec];
  } else {
    rates = [];
    const missing: string[] = [];
    for (const [currency, entry] of Object.entries(spec.rates)) {
      if (entry === null) {
        missing.push(currency);
      } else if (isRate(entry)) {
        // A ready-made Rate is looked up under its own pair, so it must be the one its key says.
        if (entry.from !== spec.base || entry.to !== currency) {
          throw new CurrencyMismatchError(`${spec.base}→${currency}`, `${entry.from}→${entry.to}`);
        }
        rates.push(entry);
      } else {
        rates.push(exchangeRate(spec.base, currency, entry, spec));
      }
    }
    header.base = spec.base;
    if (spec.asOf !== undefined) {
      header.asOf = toIsoString(spec.asOf);
    }
    if (spec.availableAt !== undefined) {
      header.availableAt = toIsoString(spec.availableAt);
    }
    if (spec.validUntil !== undefined) {
      header.validUntil = toIsoString(spec.validUntil);
    }
    if (missing.length > 0) {
      header.missing = missing;
    }
  }

  const byPair = new Map<string, Rate>();
  for (const rate of rates) {
    byPair.set(`${rate.from}/${rate.to}`, rate);
  }

  return {
    ...header,
    rates,
    rate<From extends string, To extends string>(from: From, to: To, query?: RateQuery) {
      const rate = byPair.get(`${from}/${to}`);
      if (rate === undefined) {
        return undefined;
      }
      // The table's own dates count too: a ready-made Rate entry doesn't carry them.
      const asOf = query?.asOf;
      if (asOf !== undefined && (!appliesAt(rate, asOf) || !appliesAt(header, asOf))) {
        return undefined;
      }
      // The key matched, so the rate's currencies are exactly `from` and `to`.
      return rate as Rate<From, To>;
    },
  };
}

/** Whether a rate (or a table) applies at `at`: dated, published and still valid then. */
function appliesAt(
  rate: { readonly asOf?: string; readonly availableAt?: string; readonly validUntil?: string },
  at: string | Date,
): boolean {
  if (rate.asOf !== undefined && dayOf(at) < dayOf(rate.asOf)) {
    return false;
  }
  if (rate.availableAt !== undefined && !hasStarted(rate.availableAt, at)) {
    return false;
  }
  return rate.validUntil === undefined || !hasEnded(rate.validUntil, at);
}

function isRateList(spec: RateTableSpec | readonly Rate[]): spec is readonly Rate[] {
  return Array.isArray(spec) && spec.every(isRate);
}

/** Asks each provider in turn; the first with an answer wins. */
export function chain(...providers: readonly RateProvider[]): RateProvider {
  return {
    rate(from, to, query) {
      for (const provider of providers) {
        const rate = provider.rate(from, to, query);
        if (rate !== undefined) {
          return rate;
        }
      }
      return undefined;
    },
  };
}

/** Answers to→from lookups with the exact inverse of the provider's from→to rate. */
export function reversed(provider: RateProvider): RateProvider {
  return {
    rate(from, to, query) {
      return provider.rate(to, from, query)?.inverse();
    },
  };
}

/**
 * Triangulates through `base`: from→base, then base→to, composed exactly (converting rounds once).
 * Each leg is looked up directly or as an exact inverse, so an ECB table (EUR→X only) answers X→Y.
 */
export function via(base: string, provider: RateProvider): RateProvider {
  function leg<From extends string, To extends string>(
    from: From,
    to: To,
    query?: RateQuery,
  ): Rate<From, To> | undefined {
    return provider.rate(from, to, query) ?? provider.rate(to, from, query)?.inverse();
  }

  return {
    rate(from, to, query) {
      if ((from as string) === to) {
        return undefined;
      }
      if (from === base || to === base) {
        return leg(from, to, query);
      }

      const toBase = leg(from, base, query);
      if (toBase === undefined) {
        return undefined;
      }
      const fromBase = leg(base, to, query);
      if (fromBase === undefined) {
        return undefined;
      }
      return toBase.andThen(fromBase);
    },
  };
}

/** Options for snapshots(). */
export interface SnapshotOptions {
  /**
   * How many earlier days to try when a day has no table (weekends, holidays). Default 4, which
   * covers Good Friday to Easter Monday.
   */
  readonly lookback?: number;
  /** How many loaded days to keep; the least recently used are dropped. Default 32. */
  readonly max?: number;
}

/** Dated tables, loaded on demand. */
export interface Snapshots {
  /** The latest table at or before `asOf` (a date, an instant or a Date), within the lookback. */
  at(asOf: string | Date): Promise<RateProvider>;
}

/**
 * Dated tables from a loader you supply: `load('2026-11-06')` resolves to that day's table, or to
 * undefined when there is none. Days are UTC days. Loaded tables are cached by day. Misses and
 * failures are not cached, so a table that isn't published yet is tried again next time. A loader
 * that throws fails the lookup rather than falling back to an older day, so an outage doesn't
 * silently become a stale rate. The rates carry the day they're from. A table with an
 * `availableAt` after an instant asked for is passed over, so a lookup at 09:00 on a publication
 * day gets the day before.
 *
 *     const history = snapshots(async (day) => parseEcbXml(await readFile(`ecb/${day}.xml`, 'utf8'))[0]);
 *     const fx = await history.at('2026-11-08');   // a Sunday: Friday 2026-11-06's table
 */
export function snapshots(
  load: (day: string) => Promise<RateProvider | undefined>,
  options?: SnapshotOptions,
): Snapshots {
  const lookback = options?.lookback ?? 4;
  const max = options?.max ?? 32;
  if (!Number.isSafeInteger(lookback) || lookback < 0) {
    throw new RangeError(`lookback must be a non-negative integer, got ${lookback}`);
  }
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError(`max must be a positive integer, got ${max}`);
  }
  // Map iteration order is insertion order, so re-inserting on every use makes it an LRU.
  const cache = new Map<string, Promise<RateProvider | undefined>>();

  // Only drop the entry this load created: a newer load for the same day may have replaced it.
  function forget(day: string, loading: Promise<RateProvider | undefined>): void {
    if (cache.get(day) === loading) {
      cache.delete(day);
    }
  }

  function loadDay(day: string): Promise<RateProvider | undefined> {
    let pending = cache.get(day);
    if (pending === undefined) {
      const loading: Promise<RateProvider | undefined> = load(day).then((table) => {
        if (table === undefined) {
          forget(day, loading);
        }
        return table;
      });
      loading.catch(() => forget(day, loading));
      pending = loading;
    } else {
      cache.delete(day);
    }

    cache.set(day, pending);
    if (cache.size > max) {
      const leastRecentlyUsed = cache.keys().next().value!;
      cache.delete(leastRecentlyUsed);
    }
    return pending;
  }

  return {
    async at(asOf) {
      const firstDay = dayOf(asOf);
      const firstDayMs = Date.parse(`${firstDay}T00:00:00Z`);
      if (Number.isNaN(firstDayMs)) {
        throw new RangeError(`Invalid asOf ${String(asOf)}`);
      }

      for (let i = 0; i <= lookback; i++) {
        const day = new Date(firstDayMs - i * DAY_MS).toISOString().slice(0, 10);
        // Sequential on purpose: stop at the first day that has a table, without loading older
        // days. oxlint-disable-next-line no-await-in-loop
        const table = await loadDay(day);
        // A table not yet published at the instant asked for is passed over like a missing one.
        const availableAt = (table as Partial<RateTable> | undefined)?.availableAt;
        if (table !== undefined && (availableAt === undefined || hasStarted(availableAt, asOf))) {
          return table;
        }
      }
      throw new RateUnavailableError('*', '*', firstDay);
    },
  };
}

/**
 * Snapshots over tables you already hold (e.g. an ECB 90-day history), keyed by their asOf day.
 *
 *     const history = snapshotsFrom(parseEcbXml(xml90d));
 *     const fx = await history.at('2026-11-08');
 */
export function snapshotsFrom(tables: readonly RateTable[], options?: SnapshotOptions): Snapshots {
  const byDay = new Map<string, RateTable>();
  for (const table of tables) {
    if (table.asOf !== undefined) {
      byDay.set(dayOf(table.asOf), table);
    }
  }
  return snapshots(async (day) => byDay.get(day), options);
}
