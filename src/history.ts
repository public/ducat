// `@ducatjs/money/convert/history`: rates as central banks publish them (the other way round, per
// 100 units, with stripped digits) and dated tables over a range, with lookups that say why they
// fell back. Opt-in, so that converting at a rate you already hold doesn't pay for it.
import type { CurrencyInput } from './money.js';
import {
  rateTable,
  type RateProvider,
  type RateQuery,
  type RateTable,
  type RateTableSpec,
} from './provider.js';

import { ratio, type Ratio } from './decimal.js';
import { hasEnded, hasStarted, Rate, toIsoString } from './rate.js';
import type { RateInfo, RateQuote } from './rate.js';
import { withDecimals } from './rate-text.js';

const DAY_MS = 86_400_000;

/**
 * Why a lookup passed over a day: no table that day (a weekend or holiday), the table not yet
 * published at the time asked for, its period over, or the pair not in it (`missing` when the
 * source listed the currency without a value, `notQuoted` when it isn't listed at all).
 */
export type FallbackReason = 'noTable' | 'notYetAvailable' | 'expired' | 'missing' | 'notQuoted';

/** A day a lookup passed over, and why. */
export interface Fallback {
  readonly day: string;
  readonly reason: FallbackReason;
}

const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/** The exact rate a quote stands for, in the Rate's own direction. */
function quoteRatio(quote: RateQuote): Ratio {
  if (!PLAIN_DECIMAL.test(quote.rate)) {
    throw new RangeError(`A quote is a plain decimal string, got ${quote.rate}`);
  }
  const per = quote.per ?? 1;
  if (!Number.isSafeInteger(per) || per < 1) {
    throw new RangeError(`A quote's per is a positive integer, got ${per}`);
  }
  const published = ratio(quote.rate);
  if (quote.inverted === true) {
    return ratio(published.den * BigInt(per), published.num);
  }
  return ratio(published.num, published.den * BigInt(per));
}

/**
 * A Rate from a published quote: `per` units and the direction are applied exactly, and the quote
 * is kept on the Rate.
 *
 *     rateFromQuote('JPY', 'NOK', { rate: '6.50', per: 100 })        // JPY→NOK 0.065
 *     rateFromQuote('USD', 'EUR', { rate: '1.1650', inverted: true }) // USD→EUR 200/233
 */
export function rateFromQuote<From extends CurrencyInput, To extends CurrencyInput>(
  from: From,
  to: To,
  quote: RateQuote,
  info?: Omit<RateInfo, 'quote'>,
): Rate<From, To> {
  const exact = quoteRatio(quote);
  // Stored in one form: per 1 and inverted false are the same as leaving them out, and a quote
  // without them prints its own digits.
  const kept: { rate: string; per?: number; inverted?: boolean } = { rate: quote.rate };
  if (quote.per !== undefined && quote.per !== 1) {
    kept.per = quote.per;
  }
  if (quote.inverted === true) {
    kept.inverted = true;
  }
  return new Rate(from, to, exact, { ...info, quote: kept });
}

/** One published rate in a quoted table. */
export interface QuotedRate {
  /** The rate as published, a decimal string. */
  readonly rate: string;
  /**
   * How many units the published number is for: of `base`, or of the currency when the rate is
   * `inverted` ("NOK per 100 JPY" is `{ rate: '6.50', per: 100, inverted: true }` in a NOK table).
   */
  readonly per?: number;
  /** Published as base per unit of the currency, the other way round from the table. */
  readonly inverted?: boolean;
  /**
   * The decimals the source publishes, for feeds that strip trailing zeros: '1.175' with 4 is
   * kept as '1.1750'.
   */
  readonly decimals?: number;
}

/** A one-base table of published quotes: a decimal string, a QuotedRate, or null (no value). */
export interface QuotedTableSpec extends Omit<RateTableSpec, 'rates'> {
  readonly rates: Readonly<Record<string, string | QuotedRate | null>>;
  /**
   * Every rate is published as base per unit of the currency (CAD per USD, as the Bank of Canada
   * quotes), unless its entry says otherwise.
   */
  readonly inverted?: boolean;
  /** The decimals every rate is published with, unless its entry says otherwise. */
  readonly decimals?: number;
}

/**
 * A rateTable from rates as a source published them: each is stored exactly in the table's
 * direction, base → currency, and keeps its quote (`rate.quote`).
 *
 *     const boc = quotedTable({ base: 'CAD', inverted: true, asOf: '2026-11-06', rates: { USD: '1.3654' } });
 *     boc.rate('CAD', 'USD')?.inverse().toString(); // '1.3654'
 */
export function quotedTable(spec: QuotedTableSpec): RateTable {
  const rates: Record<string, Rate | null> = {};
  for (const [currency, entry] of Object.entries(spec.rates)) {
    if (entry === null) {
      rates[currency] = null;
      continue;
    }
    let quoted: QuotedRate;
    if (typeof entry === 'string') {
      quoted = { rate: entry };
    } else {
      quoted = entry;
    }

    let text = quoted.rate.trim();
    const decimals = quoted.decimals ?? spec.decimals;
    if (decimals !== undefined) {
      text = withDecimals(text, decimals);
    }
    const quote: { rate: string; per?: number; inverted?: boolean } = { rate: text };
    if (quoted.per !== undefined) {
      quote.per = quoted.per;
    }
    if (quoted.inverted ?? spec.inverted ?? false) {
      quote.inverted = true;
    }
    rates[currency] = rateFromQuote(spec.base, currency, quote, spec);
  }
  return rateTable({ ...spec, rates });
}

/** The UTC date ('2026-11-06') of a date, an instant (any offset) or a Date. */
function dayOf(time: string | Date): string {
  return toIsoString(time).slice(0, 10);
}

/** Options for rateHistory(). */
export interface RateHistoryOptions {
  /**
   * How many days before the day asked for to look back for a daily table (weekends, holidays,
   * currencies missing that day). Default 4, which covers Good Friday to Easter Monday. A table
   * valid for a period (`validUntil`) answers for its whole period instead.
   */
  readonly lookback?: number;
}

/** A rate lookup with its reasons: the rate, or undefined, and the days passed over. */
export interface RateLookup<From extends string = string, To extends string = string> {
  readonly rate: Rate<From, To> | undefined;
  /** Days passed over before the answer (or before giving up), newest first. */
  readonly skipped: readonly Fallback[];
}

/** Dated tables held in memory, answering any day synchronously. */
export interface RateHistory extends RateProvider {
  /** The dated tables, newest first. */
  readonly tables: readonly RateTable[];
  /** The same lookup as `rate`, reporting the days it passed over and why. */
  lookup<From extends string, To extends string>(
    from: From,
    to: To,
    query?: RateQuery,
  ): RateLookup<From, To>;
}

/**
 * Why a table can't answer the pair at the time asked for, or undefined when it can. The table's
 * own dates are checked first; a table built from a list of Rates has none, so its rate's are.
 */
function passOver(
  table: RateTable,
  from: string,
  to: string,
  query: RateQuery | undefined,
  periodEnded: boolean,
): FallbackReason | undefined {
  const asOf = query?.asOf;
  if (periodEnded) {
    return 'expired';
  }
  if (
    asOf !== undefined &&
    table.availableAt !== undefined &&
    !hasStarted(table.availableAt, asOf)
  ) {
    return 'notYetAvailable';
  }
  if (table.rate(from, to, query) !== undefined) {
    return undefined;
  }

  if (table.missing?.includes(from) === true || table.missing?.includes(to) === true) {
    return 'missing';
  }
  const held = table.rates.find((rate) => rate.from === from && rate.to === to);
  if (held !== undefined && asOf !== undefined) {
    if (held.isExpired(asOf)) {
      return 'expired';
    }
    if (!held.isAvailable(asOf)) {
      return 'notYetAvailable';
    }
  }
  return 'notQuoted';
}

/** The ISO date `count` days before `day`. */
function daysBefore(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - count * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A provider over many dated tables, such as a date range loaded in one call: for each lookup it
 * takes the latest table at or before `asOf` that has the pair, published by then and still
 * valid, looking back up to `lookback` days. Each currency pair falls back on its own, so a
 * currency missing on a holiday comes from the day before while the others stay current; the
 * Rate's `asOf` says which day it is from. Without an `asOf`, the newest table with the pair
 * answers. `lookup` reports why a lookup fell back.
 *
 *     const history = rateHistory(parseEcbXml(xml90Days));
 *     history.rate('EUR', 'USD', { asOf: '2026-11-08' }); // Sunday: Friday's rate
 *     history.lookup('EUR', 'USD', { asOf: '2026-11-08' }).skipped;
 *     // [{ day: '2026-11-08', reason: 'noTable' }, { day: '2026-11-07', reason: 'noTable' }]
 */
export function rateHistory(
  tables: readonly RateTable[],
  options?: RateHistoryOptions,
): RateHistory {
  const lookback = options?.lookback ?? 4;
  if (!Number.isSafeInteger(lookback) || lookback < 0) {
    throw new RangeError(`lookback must be a non-negative integer, got ${lookback}`);
  }
  const dated: { day: string; table: RateTable }[] = [];
  for (const table of tables) {
    if (table.asOf === undefined) {
      throw new RangeError('rateHistory needs tables with an asOf');
    }
    dated.push({ day: dayOf(table.asOf), table });
  }
  // Newest first; a stable sort keeps the caller's order within a day.
  dated.sort((entry, other) => (other.day < entry.day ? -1 : Number(other.day > entry.day)));

  const hasPeriods = dated.some((entry) => entry.table.validUntil !== undefined);

  function lookup<From extends string, To extends string>(
    from: From,
    to: To,
    query?: RateQuery,
  ): RateLookup<From, To> {
    const asOf = query?.asOf;
    const skipped: Fallback[] = [];
    let firstDay: string | undefined;
    if (asOf !== undefined) {
      firstDay = dayOf(asOf);
    } else {
      firstDay = dated[0]?.day;
    }
    if (firstDay === undefined) {
      return { rate: undefined, skipped };
    }
    const lastDay = daysBefore(firstDay, lookback);
    // The newest day of the lookback window not yet accounted for by a daily table.
    let expectedDay = firstDay;

    for (const { day, table } of dated) {
      if (day > firstDay) {
        continue;
      }
      const periodEnded =
        asOf !== undefined && table.validUntil !== undefined && hasEnded(table.validUntil, asOf);
      const coversPeriod = table.validUntil !== undefined && !periodEnded;
      if (day < lastDay && !coversPeriod) {
        // Older daily tables are out of the window; an older period table may still cover it.
        if (!hasPeriods) {
          break;
        }
        continue;
      }

      // Days between the last table and this one had no table. A period table that answers
      // covers them, so for one they count only once it turns out not to answer.
      // An older period table comes after every day of the window, so all of them are gaps.
      const inWindow = day >= lastDay;
      const accountedTo = inWindow ? day : daysBefore(lastDay, 1);
      const gaps: Fallback[] = [];
      for (let gap = expectedDay; gap > accountedTo; gap = daysBefore(gap, 1)) {
        gaps.push({ day: gap, reason: 'noTable' });
      }
      if (!coversPeriod) {
        skipped.push(...gaps);
      }

      const reason = passOver(table, from, to, query, periodEnded);
      if (reason === undefined) {
        return { rate: table.rate(from, to, query) as Rate<From, To>, skipped };
      }
      if (coversPeriod) {
        skipped.push(...gaps);
      }
      skipped.push({ day, reason });
      if (accountedTo <= expectedDay) {
        expectedDay = inWindow ? daysBefore(day, 1) : accountedTo;
      }
    }

    // Days left in the window without any table at all.
    for (let gap = expectedDay; gap >= lastDay; gap = daysBefore(gap, 1)) {
      skipped.push({ day: gap, reason: 'noTable' });
    }
    return { rate: undefined, skipped };
  }

  return {
    tables: dated.map((entry) => entry.table),
    rate(from, to, query) {
      return lookup(from, to, query).rate;
    },
    lookup,
  };
}
