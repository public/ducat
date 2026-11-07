// Adyen exchange rates as exact Rates, from settlement details report rows.
import { exchangeRate, type Rate, type RateInfo } from './rate.js';

// UTC offsets, in minutes, of the zone abbreviations that name one offset. Ambiguous ones are left
// out on purpose: IST is India, Ireland or Israel; CST is US Central or China; BST is British or
// Bangladesh.
const ZONE_OFFSET_MINUTES: Readonly<Record<string, number>> = {
  UTC: 0,
  GMT: 0,
  WET: 0,
  WEST: 60,
  CET: 60,
  CEST: 120,
  EET: 120,
  EEST: 180,
  MSK: 180,
  SGT: 480,
  HKT: 480,
  JST: 540,
  KST: 540,
  AEST: 600,
  AEDT: 660,
  NZST: 720,
  NZDT: 780,
  EST: -300,
  EDT: -240,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
};

const LOCAL_TIME = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d(?:\.\d+)?)?)$/;
const NUMERIC_OFFSET = /^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d\d))?$/;

// Real UTC offsets run from -12:00 to +14:00.
const MAX_OFFSET_MINUTES = 14 * 60;

/** The zone's offset in minutes, or undefined when it can't be read unambiguously. */
function offsetMinutes(zone: string): number | undefined {
  const named = ZONE_OFFSET_MINUTES[zone.toUpperCase()];
  if (named !== undefined) {
    return named;
  }
  const numeric = NUMERIC_OFFSET.exec(zone);
  if (numeric === null) {
    return undefined;
  }
  const hours = Number(numeric[2]);
  const minutes = Number(numeric[3] ?? 0);
  const total = hours * 60 + minutes;
  if (minutes >= 60 || total > MAX_OFFSET_MINUTES) {
    return undefined;
  }
  return numeric[1] === '-' ? -total : total;
}

/** The offset of an IANA time zone at a UTC instant, in minutes. */
function ianaOffsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const field = (type: string): number => Number(parts.find((part) => part.type === type)!.value);
  const wallClockAsUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return Math.round((wallClockAsUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** The UTC instant of a wall-clock time in an IANA zone, summer time included. */
function ianaToUtc(localAsUtcMs: number, timeZone: string): number {
  // The offset at the guess can differ from the offset at the answer across a clock change, so
  // look it up again at the first answer.
  const firstGuess = localAsUtcMs - ianaOffsetMinutes(timeZone, localAsUtcMs) * 60_000;
  return localAsUtcMs - ianaOffsetMinutes(timeZone, firstGuess) * 60_000;
}

/** Creation Date as a UTC instant when its zone is known; otherwise its local day. */
function creationAsOf(
  created: string,
  label: string | undefined,
  timeZone: string | undefined,
): string | undefined {
  const local = LOCAL_TIME.exec(created.trim());
  if (local === null) {
    return /^\d{4}-\d\d-\d\d/.test(created) ? created.slice(0, 10) : undefined;
  }
  const localAsUtcMs = Date.parse(`${local[1]}T${local[2]}Z`);
  if (timeZone !== undefined) {
    return new Date(ianaToUtc(localAsUtcMs, timeZone)).toISOString();
  }
  const offset = label === undefined ? undefined : offsetMinutes(label.trim());
  if (offset === undefined) {
    return local[1];
  }
  return new Date(localAsUtcMs - offset * 60_000).toISOString();
}

/** Options for adyenRate. */
export interface AdyenRateOptions {
  /**
   * The account's IANA time zone ('Europe/Amsterdam'). When given, Creation Date is read in it,
   * summer time included, and the TimeZone column is not used.
   */
  readonly timeZone?: string;
}

/** A settlement details report row, keyed by column name (as from a CSV parser with headers). */
export type AdyenSettlementRow = Readonly<Record<string, string | undefined>>;

/**
 * The rate in a settlement details report row: "The exchange rate used for converting the gross
 * amount into the net amount", Gross Currency → Net Currency (1 when they are the same). The
 * decimal string is kept exactly. `asOf` comes from Creation Date, which Adyen gives in local time,
 * with the zone in the TimeZone column. Pass `{ timeZone: 'Europe/Amsterdam' }` (the account's IANA
 * zone) to read it correctly all year. Without it, an unambiguous abbreviation (CET, PST, ...) or
 * offset (+01:00) is taken literally: Adyen's documentation doesn't say whether the column switches
 * to CEST in summer, and if it doesn't, a literal CET is an hour off then. Any other label gives
 * the local day, which can be a day off from UTC. `undefined` when the row has no rate. For
 * externally settled payments Adyen lists its reference rate, not the acquirer's, so check those
 * with impliedRate().
 */
export function adyenRate(row: AdyenSettlementRow, options?: AdyenRateOptions): Rate | undefined {
  const gross = row['Gross Currency'];
  const net = row['Net Currency'];
  const rate = row['Exchange Rate']?.trim();
  if (gross === undefined || gross === '' || net === undefined || net === '') {
    return undefined;
  }
  if (rate === undefined || rate === '') {
    return undefined;
  }

  const created = row['Creation Date'];
  let info: RateInfo = { source: 'adyen' };
  const asOf =
    created === undefined ? undefined : creationAsOf(created, row['TimeZone'], options?.timeZone);
  if (asOf !== undefined) {
    info = { source: 'adyen', asOf };
  }
  return exchangeRate(gross, net, rate, info);
}
