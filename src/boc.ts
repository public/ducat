// `@ducatjs/money/convert/boc`: an offline parser for the Bank of Canada's daily exchange rates
// (the Valet API). No I/O: fetch the JSON yourself, or use fetchBankOfCanada from
// @ducatjs/money/convert/fetch. Rates are kept exactly as published.
import { quotedTable } from './history.js';
import type { RateTable } from './provider.js';
import { addDayRate, isCalendarDay, newestFirst, readRateCell } from './rate-text.js';

const SERIES = /^FX([A-Z]{3})CAD$/;
const ZERO = /^0+(?:\.0+)?$/;

// The Bank publishes "once each business day by 16:30 (ET)". One formatter for the zone, built on
// first use, gives the Toronto offset on any day, summer time included.
let torontoFormatter: Intl.DateTimeFormat | undefined;

/** 16:30 in Toronto on `day`, as a UTC instant. */
function publishedBy(day: string): string {
  torontoFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    timeZoneName: 'shortOffset',
  });
  // Noon UTC is 07:00 or 08:00 in Toronto, after any clock change that day (they happen at 02:00).
  const noon = new Date(`${day}T12:00:00Z`);
  const zone = torontoFormatter.formatToParts(noon).find((part) => part.type === 'timeZoneName');
  const offset = /^GMT([+-]\d+)$/.exec(zone?.value ?? '');
  if (offset === null) {
    throw new RangeError(`Can't tell Toronto's UTC offset on ${day} (${zone?.value})`);
  }
  const utcMs = Date.parse(`${day}T16:30:00Z`) - Number(offset[1]) * 3_600_000;
  return new Date(utcMs).toISOString();
}

function notValet(why: string): never {
  throw new SyntaxError(`Not a Bank of Canada Valet daily FX file: ${why}`);
}

/** Options for parseBankOfCanadaJson. */
export interface BankOfCanadaOptions {
  /**
   * When each day's rates were published, or false for none. Default: 16:30 Toronto time that day,
   * when the Bank says it publishes them.
   */
  readonly availableAt?: false | ((day: string) => string | Date);
}

/**
 * Parses the Bank of Canada's daily exchange rates from the Valet API's JSON (the
 * `FX_RATES_DAILY` group, or single `FX…CAD` series) into one CAD-based table per business day,
 * newest first. The Bank quotes CAD per unit of each currency (FXUSDCAD 1.3748), so each table
 * holds the exact inverse, CAD → currency, and keeps the published quote: `rate.inverse()` prints
 * '1.3748' again. Rates have `source: 'BoC'`, `type: 'average'` (an average of a day's quotes, not
 * a market rate) and `availableAt` 16:30 Toronto time, when the Bank says it publishes them (a late
 * rate can come later; pass `availableAt` to change it). Valet leaves a series out of a day
 * without a value, so a series listed in `seriesDetail` but absent on a day, an empty value or a
 * null one, is in that day's `missing`. Anything but daily `FX…CAD` series (monthly or annual
 * groups, other data) throws SyntaxError, as do two different values for one series on one day.
 *
 * Precision: the Bank quotes four decimals, up to six for small rates, so a small rate has only
 * about four significant digits (JPY 0.008760, KRW 0.000929, and IDR 0.000082 with two). Its
 * inverse is exact, but only as precise as that. For such currencies, prefer a source that quotes
 * them the other way round.
 *
 *     const tables = parseBankOfCanadaJson(await (await fetch(url)).text());
 *     tables[0].rate('CAD', 'USD')?.inverse().toString(); // '1.3748'
 */
export function parseBankOfCanadaJson(json: string, options?: BankOfCanadaOptions): RateTable[] {
  const parsed = JSON.parse(json) as {
    observations?: unknown;
    seriesDetail?: Record<string, unknown>;
  } | null;
  const observations = parsed?.observations;
  if (!Array.isArray(observations)) {
    notValet('no observations');
  }

  // The series the file says it has; each must be a daily FX…CAD series.
  const expected = new Set<string>();
  for (const series of Object.keys(parsed?.seriesDetail ?? {})) {
    if (!SERIES.test(series)) {
      notValet(`series ${series} isn't a daily FX…CAD rate`);
    }
    expected.add(series);
  }

  const days = new Map<string, Record<string, string | null>>();
  for (const observation of observations as readonly Record<string, unknown>[]) {
    const day = observation?.['d'];
    if (typeof day !== 'string' || !isCalendarDay(day)) {
      notValet(`bad date ${JSON.stringify(day)}`);
    }

    for (const [series, cell] of Object.entries(observation)) {
      if (series === 'd') {
        continue;
      }
      const currency = SERIES.exec(series)?.[1];
      if (currency === undefined) {
        notValet(`series ${series} isn't a daily FX…CAD rate`);
      }
      const where = `${series} on ${day}`;
      const value = (cell as { v?: unknown } | null)?.v;
      if (value !== null && typeof value !== 'string') {
        throw new SyntaxError(`Malformed Valet value for ${where}`);
      }
      const rate = value === null ? null : readRateCell(value, where);
      if (rate !== null && ZERO.test(rate)) {
        throw new SyntaxError(`A zero rate for ${where}`);
      }
      addDayRate(days, day, currency, rate);
    }
    // Valet leaves out a series without a value that day.
    for (const series of expected) {
      const currency = SERIES.exec(series)![1]!;
      if (days.get(day)?.[currency] === undefined) {
        addDayRate(days, day, currency, null);
      }
    }
  }

  const tables: RateTable[] = [];
  for (const [day, rates] of days) {
    if (!Object.values(rates).some((rate) => rate !== null)) {
      continue;
    }
    let availableAt: string | Date | undefined;
    if (options?.availableAt === undefined) {
      availableAt = publishedBy(day);
    } else if (options.availableAt !== false) {
      availableAt = options.availableAt(day);
    }
    const info = { base: 'CAD', inverted: true, source: 'BoC', type: 'average', asOf: day };
    tables.push(
      quotedTable({ ...info, ...(availableAt === undefined ? {} : { availableAt }), rates }),
    );
  }
  return newestFirst(tables);
}
