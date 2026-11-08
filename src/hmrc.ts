// `@ducatjs/money/convert/hmrc`: an offline parser for HMRC's monthly exchange rates, the UK's
// rates for customs and VAT. No I/O: download the CSV yourself.
import { rateTable, type RateTable } from './provider.js';
import { addDayRate, csvRows, isCalendarDay, newestFirst, readRateCell } from './rate-text.js';

const UK_DATE = /^(\d\d)\/(\d\d)\/(\d{4})$/;
const COLUMNS = ['Currency Code', 'Currency Units per £1', 'Start date', 'End date'] as const;

function notHmrc(why: string): never {
  throw new SyntaxError(`Not an HMRC monthly exchange rates CSV file: ${why}`);
}

/** 'DD/MM/YYYY' as an ISO date, or SyntaxError. */
function isoDate(text: string): string {
  const match = UK_DATE.exec(text.trim());
  const day = match === null ? '' : `${match[3]}-${match[2]}-${match[1]}`;
  if (!isCalendarDay(day)) {
    notHmrc(`bad date ${JSON.stringify(text)}`);
  }
  return day;
}

/**
 * The penultimate Thursday of the month before `start` (an ISO date), when HMRC says it publishes
 * the next month's rates.
 */
function publicationDay(start: string): string {
  // The last day of the previous month, then back to its last Thursday, then a week before that.
  const lastDay = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 0));
  const backToThursday = (lastDay.getUTCDay() - 4 + 7) % 7;
  lastDay.setUTCDate(lastDay.getUTCDate() - backToThursday - 7);
  return lastDay.toISOString().slice(0, 10);
}

/** Options for parseHmrcMonthlyCsv. */
export interface HmrcOptions {
  /**
   * When each period's rates were published, or false for none. Default: the penultimate Thursday
   * of the month before, as HMRC states (a date: from the start of that UTC day).
   */
  readonly availableAt?: false | ((start: string) => string | Date);
}

/**
 * Parses HMRC's monthly exchange rates CSV (trade-tariff.service.gov.uk, under the Open
 * Government Licence) into one GBP-based table per period, newest first. Each is valid for its
 * calendar month: `asOf` is the start date and `validUntil` the end date, so a `rateHistory` of
 * them answers any day of the month (see @ducatjs/money/convert/history). Rates are currency units
 * per £1, with `source: 'HMRC'` and `type: 'customs'`, four decimals as published. HMRC publishes
 * them "on the penultimate Thursday of every month", for the following calendar month, as of
 * midday the day before; that Thursday is the `availableAt`. Several countries share a code (the
 * CFA francs, AED, XCD): their rows must agree, or the file throws SyntaxError, as does any other
 * row that can't be read.
 *
 *     const [november] = parseHmrcMonthlyCsv(await readFile('monthly_csv_2026-11.csv', 'utf8'));
 *     november.rate('GBP', 'EUR', { asOf: '2026-11-15' })?.toString(); // '1.1930'
 */
export function parseHmrcMonthlyCsv(csv: string, options?: HmrcOptions): RateTable[] {
  const [header, ...rows] = csvRows(csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv);
  const names = (header ?? []).map((name) => name.trim());
  const index = COLUMNS.map((name) => names.indexOf(name));
  if (index.some((i) => i === -1)) {
    notHmrc(`the columns are ${names.join(', ')}`);
  }
  const [codeAt, rateAt, startAt, endAt] = index as [number, number, number, number];

  if (rows.length === 0) {
    notHmrc('no rates');
  }

  // Periods by their start and end; within one, rates by code.
  const periods = new Map<string, Map<string, Record<string, string | null>>>();
  for (const cells of rows) {
    if (cells.length !== names.length) {
      notHmrc(`a row has ${cells.length} cells, the header ${names.length}`);
    }
    const code = cells[codeAt]!.trim();
    if (!/^[A-Z]{3}$/.test(code) || code === 'GBP') {
      notHmrc(`bad currency code ${JSON.stringify(code)}`);
    }
    const start = isoDate(cells[startAt]!);
    const end = isoDate(cells[endAt]!);
    if (end < start) {
      notHmrc(`${code} ends on ${end}, before it starts on ${start}`);
    }
    const key = `${start}/${end}`;
    let codes = periods.get(key);
    if (codes === undefined) {
      codes = new Map();
      periods.set(key, codes);
    }
    addDayRate(codes, start, code, readRateCell(cells[rateAt]!, `${code} from ${start}`));
  }

  const tables: RateTable[] = [];
  for (const [key, codes] of periods) {
    const [start, end] = key.split('/') as [string, string];
    const rates = codes.get(start)!;
    if (!Object.values(rates).some((rate) => rate !== null)) {
      continue;
    }
    let availableAt: string | Date | undefined;
    if (options?.availableAt === undefined) {
      availableAt = publicationDay(start);
    } else if (options.availableAt !== false) {
      availableAt = options.availableAt(start);
    }
    const info = { base: 'GBP', source: 'HMRC', type: 'customs', asOf: start, validUntil: end };
    tables.push(
      rateTable({ ...info, ...(availableAt === undefined ? {} : { availableAt }), rates }),
    );
  }
  return newestFirst(tables);
}
