// `@ducatjs/money/convert/boc`: an offline parser for the Bank of Canada's daily exchange rates
// (the Valet API). No I/O: fetch the JSON yourself, or use fetchBankOfCanada from
// @ducatjs/money/convert/fetch. Rates are kept exactly as published.
import { quotedTable } from './history.js';
import type { RateTable } from './provider.js';
import { readRateCell } from './rate-text.js';

const SERIES = /^FX([A-Z]{3})CAD$/;
const ISO_DAY = /^\d{4}-\d\d-\d\d$/;

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
  // Without the zone name, assume EST: in summer that is an hour late, never early.
  const offsetHours = offset === null ? -5 : Number(offset[1]);
  const utcMs = Date.parse(`${day}T16:30:00Z`) - offsetHours * 3_600_000;
  return new Date(utcMs).toISOString();
}

interface ValetObservation {
  readonly d?: unknown;
  readonly [series: string]: unknown;
}

function notValet(): never {
  throw new SyntaxError('Not a Bank of Canada Valet observations file');
}

/**
 * Parses the Bank of Canada's daily exchange rates from the Valet API's JSON (the
 * `FX_RATES_DAILY` group, or single `FX…CAD` series) into one CAD-based table per business day,
 * newest first. The Bank quotes CAD per unit of each currency (FXUSDCAD 1.3748), so each table
 * holds the exact inverse, CAD → currency, and keeps the published quote: `rate.inverse()` prints
 * '1.3748' again. Rates have `source: 'BoC'`, `type: 'average'` (an average of a day's quotes, not
 * a market rate) and `availableAt` 16:30 Toronto time, when the Bank says it publishes them; a late
 * rate can come later than that. Currencies without a value that day are left out, as the Bank
 * does, and an empty value is a missing one.
 *
 * Precision: the Bank quotes four decimals, up to six for small rates, so a small rate has only
 * about four significant digits (JPY 0.008760, KRW 0.000929, and IDR 0.000082 with two). Its
 * inverse is exact, but only as precise as that. For such currencies, prefer a source that quotes
 * them the other way round.
 *
 *     const tables = parseBankOfCanadaJson(await (await fetch(url)).text());
 *     tables[0].rate('CAD', 'USD')?.inverse().toString(); // '1.3748'
 */
export function parseBankOfCanadaJson(json: string): RateTable[] {
  const parsed: unknown = JSON.parse(json);
  const observations = (parsed as { observations?: unknown } | null)?.observations;
  if (!Array.isArray(observations)) {
    notValet();
  }

  const tables: RateTable[] = [];
  for (const observation of observations as readonly ValetObservation[]) {
    const day = observation?.d;
    if (typeof day !== 'string' || !ISO_DAY.test(day) || Number.isNaN(Date.parse(day))) {
      notValet();
    }

    const rates: Record<string, string | null> = {};
    let quoted = 0;
    for (const [series, cell] of Object.entries(observation)) {
      const currency = SERIES.exec(series)?.[1];
      if (currency === undefined) {
        continue;
      }
      const value = (cell as { v?: unknown } | null)?.v;
      if (typeof value !== 'string') {
        throw new SyntaxError(`Malformed Valet value for ${series} on ${day}`);
      }
      const rate = readRateCell(value, `${series} on ${day}`);
      rates[currency] = rate;
      if (rate !== null) {
        quoted++;
      }
    }
    if (quoted > 0) {
      tables.push(
        quotedTable({
          base: 'CAD',
          inverted: true,
          source: 'BoC',
          type: 'average',
          asOf: day,
          availableAt: publishedBy(day),
          rates,
        }),
      );
    }
  }
  return tables.sort((table, other) => other.asOf!.localeCompare(table.asOf!));
}
