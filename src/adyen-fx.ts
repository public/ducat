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
  const minutes = Number(numeric[2]) * 60 + Number(numeric[3] ?? 0);
  return numeric[1] === '-' ? -minutes : minutes;
}

/** Creation Date as a UTC instant when TimeZone gives its offset; otherwise its local day. */
function creationAsOf(created: string, zone: string | undefined): string | undefined {
  const local = LOCAL_TIME.exec(created.trim());
  if (local === null) {
    return /^\d{4}-\d\d-\d\d/.test(created) ? created.slice(0, 10) : undefined;
  }
  const offset = zone === undefined ? undefined : offsetMinutes(zone.trim());
  if (offset === undefined) {
    return local[1];
  }
  const sign = offset < 0 ? '-' : '+';
  const hours = String(Math.trunc(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return new Date(`${local[1]}T${local[2]}${sign}${hours}:${minutes}`).toISOString();
}

/** A settlement details report row, keyed by column name (as from a CSV parser with headers). */
export type AdyenSettlementRow = Readonly<Record<string, string | undefined>>;

/**
 * The rate in a settlement details report row: "The exchange rate used for converting the gross
 * amount into the net amount", Gross Currency → Net Currency (1 when they are the same). The decimal
 * string is kept exactly. `asOf` comes from Creation Date, which Adyen gives in local time with the
 * zone in the TimeZone column: it is the UTC instant when that zone is an unambiguous abbreviation
 * (CET, PST, ...) or an offset (+01:00), and otherwise the local day, which can then be a day off
 * from UTC. `undefined` when the row has no rate. For externally settled payments
 * Adyen lists its reference rate, not the acquirer's, so check those with impliedRate().
 */
export function adyenRate(row: AdyenSettlementRow): Rate | undefined {
  const gross = row['Gross Currency'];
  const net = row['Net Currency'];
  const rate = row['Exchange Rate']?.trim();
  if (!gross || !net || !rate) {
    return undefined;
  }

  const created = row['Creation Date'];
  let info: RateInfo = { source: 'adyen' };
  const asOf = created === undefined ? undefined : creationAsOf(created, row['TimeZone']);
  if (asOf !== undefined) {
    info = { source: 'adyen', asOf };
  }
  return exchangeRate(gross, net, rate, info);
}
