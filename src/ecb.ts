// Offline parsers for the ECB euro foreign exchange reference rates (eurofxref). No I/O: fetch or
// read the files yourself, or use ducat/convert/fetch. Rates are kept exactly as published.
import { rateTable, type RateTable } from './provider.js';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const DAY_CUBE = /<Cube\s+time=["'](\d{4}-\d\d-\d\d)["']\s*>([\s\S]*?)<\/Cube>/g;
// One <Cube .../> element, and its attributes in any order and with any quoting or spacing.
const INNER_CUBE = /<Cube\b([^>]*?)\/?>/g;
const ATTRIBUTE = /([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const RATE_TEXT = /^\d+(?:\.\d+)?$/;
const ISO_DAY = /^(\d{4})-(\d\d)-(\d\d)$/;

/**
 * The ECB's rates are typed 'reference', not 'mid': they are set once a day, around 14:10 CET, from a
 * regular concertation between central banks, and published for information only. They are not a
 * market mid-rate that anyone deals at.
 */
function ecbTable(asOf: string, rates: Record<string, string>): RateTable {
  return rateTable({ base: 'EUR', asOf, source: 'ECB', type: 'reference', rates });
}

function notAnEcbFile(): never {
  throw new SyntaxError('Not an ECB reference rate file');
}

function withoutByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The currency → rate attributes of the <Cube> elements in one day's cube. */
function ratesOfDay(body: string): Record<string, string> {
  const rates: Record<string, string> = {};
  for (const [, attributeText] of body.matchAll(INNER_CUBE)) {
    const attributes: Record<string, string> = {};
    for (const [, name, doubleQuoted, singleQuoted] of attributeText!.matchAll(ATTRIBUTE)) {
      attributes[name!] = doubleQuoted ?? singleQuoted!;
    }
    const currency = attributes['currency'];
    const rate = attributes['rate'];
    if (currency === undefined && rate === undefined) {
      continue;
    }
    // Fail rather than silently drop a currency: a missing rate would look like "not quoted".
    if (currency === undefined || !/^[A-Z]{3}$/.test(currency) || rate === undefined || !RATE_TEXT.test(rate)) {
      throw new SyntaxError(`Malformed ECB rate entry <Cube${attributeText}>`);
    }
    rates[currency] = rate;
  }
  return rates;
}

function newestFirst(tables: RateTable[]): RateTable[] {
  return tables.sort((table, other) => other.asOf!.localeCompare(table.asOf!));
}

/**
 * Parses eurofxref-daily.xml, eurofxref-hist-90d.xml or eurofxref-hist.xml into one EUR-based table
 * per day, newest first. Each rate is EUR → currency, with `source: 'ECB'`, `type: 'reference'` and
 * `asOf` the publication day. A day without any rates is left out, so a lookback goes on to the day
 * before. A rate entry that can't be read throws SyntaxError.
 *
 *     const [latest] = parseEcbXml(await readFile('eurofxref-daily.xml', 'utf8'));
 */
export function parseEcbXml(xml: string): RateTable[] {
  let days = 0;
  const tables: RateTable[] = [];
  for (const [, asOf, body] of withoutByteOrderMark(xml).matchAll(DAY_CUBE)) {
    days++;
    const day = isoDay(asOf!);
    const rates = ratesOfDay(body!);
    if (Object.keys(rates).length > 0) {
      tables.push(ecbTable(day, rates));
    }
  }

  if (days === 0) {
    notAnEcbFile();
  }
  return newestFirst(tables);
}

/** The ISO date of year-month-day, or a SyntaxError when that day doesn't exist (32 November). */
function calendarDay(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new SyntaxError(`Not a calendar day: ${year}-${month}-${day}`);
  }
  return date.toISOString().slice(0, 10);
}

/** '2026-11-06', or '06 November 2026' as in the daily CSV, as an ISO date. */
function isoDay(text: string): string {
  const iso = ISO_DAY.exec(text);
  if (iso !== null) {
    return calendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const match = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(text);
  if (match === null) {
    notAnEcbFile();
  }
  const [, day, monthName, year] = match;
  const month = MONTHS.indexOf(monthName!.toLowerCase()) + 1;
  if (month === 0) {
    notAnEcbFile();
  }
  return calendarDay(Number(year), month, Number(day));
}

/**
 * Parses eurofxref.csv or eurofxref-hist.csv (from the ECB's zips) the way parseEcbXml does.
 * 'N/A' and blank cells (currencies not quoted that day) are skipped, and a day with no rates at
 * all is left out, so a lookback goes on to the day before.
 */
export function parseEcbCsv(csv: string): RateTable[] {
  const lines = withoutByteOrderMark(csv)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const columns = (lines[0] ?? '').split(',').map((cell) => cell.trim());
  if (columns[0] !== 'Date') {
    notAnEcbFile();
  }

  const tables: RateTable[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((cell) => cell.trim());
    const rates: Record<string, string> = {};
    for (let i = 1; i < columns.length; i++) {
      const currency = columns[i];
      const rate = cells[i];
      if (currency && rate && rate !== 'N/A') {
        rates[currency] = rate;
      }
    }
    const day = isoDay(cells[0]!);
    if (Object.keys(rates).length > 0) {
      tables.push(ecbTable(day, rates));
    }
  }
  return newestFirst(tables);
}
