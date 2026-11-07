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
const RATE_CUBE = /currency=["']([A-Z]{3})["']\s+rate=["']([0-9.]+)["']/g;

function ecbTable(asOf: string, rates: Record<string, string>): RateTable {
  return rateTable({ base: 'EUR', asOf, source: 'ECB', type: 'reference', rates });
}

function notAnEcbFile(): never {
  throw new SyntaxError('Not an ECB reference rate file');
}

function newestFirst(tables: RateTable[]): RateTable[] {
  return tables.sort((table, other) => other.asOf!.localeCompare(table.asOf!));
}

/**
 * Parses eurofxref-daily.xml, eurofxref-hist-90d.xml or eurofxref-hist.xml into one EUR-based table
 * per day, newest first. Each rate is EUR → currency, with `source: 'ECB'`, `type: 'reference'` and
 * `asOf` the publication day.
 *
 *     const [latest] = parseEcbXml(await readFile('eurofxref-daily.xml', 'utf8'));
 */
export function parseEcbXml(xml: string): RateTable[] {
  const tables: RateTable[] = [];
  for (const [, asOf, body] of xml.matchAll(DAY_CUBE)) {
    const rates: Record<string, string> = {};
    for (const [, currency, rate] of body!.matchAll(RATE_CUBE)) {
      rates[currency!] = rate!;
    }
    tables.push(ecbTable(asOf!, rates));
  }

  if (tables.length === 0) {
    notAnEcbFile();
  }
  return newestFirst(tables);
}

/** '2026-11-06', or '06 November 2026' as in the daily CSV, as an ISO date. */
function isoDay(text: string): string {
  if (/^\d{4}-\d\d-\d\d$/.test(text)) {
    return text;
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
  return `${year}-${String(month).padStart(2, '0')}-${day!.padStart(2, '0')}`;
}

/**
 * Parses eurofxref.csv or eurofxref-hist.csv (from the ECB's zips) the way parseEcbXml does.
 * 'N/A' and blank cells (currencies not quoted that day) are skipped.
 */
export function parseEcbCsv(csv: string): RateTable[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
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
    tables.push(ecbTable(isoDay(cells[0]!), rates));
  }
  return newestFirst(tables);
}
