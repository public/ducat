// Offline parsers for the ECB euro foreign exchange reference rates (eurofxref). No I/O: fetch or
// read the files yourself, or use ducat/convert/fetch. Rates are kept exactly as published.
import { rateTable, type RateTable } from './provider.js';
import { readRateCell, withDecimals } from './rate-text.js';

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
 * The ECB's rates are typed 'reference', not 'mid': they are set once a day, around 14:10 CET, from
 * a regular concertation between central banks, and published for information only. They are not a
 * market mid-rate that anyone deals at.
 */
function ecbTable(asOf: string, rates: Record<string, string | null>): RateTable {
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
    if (
      currency === undefined ||
      !/^[A-Z]{3}$/.test(currency) ||
      rate === undefined ||
      !RATE_TEXT.test(rate)
    ) {
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
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
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
 * 'N/A' and blank cells (currencies not quoted that day) are listed in the table's `missing`, and a
 * day with no rates at all is left out, so a lookback goes on to the day before.
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
    const day = isoDay(cells[0]!);
    const rates: Record<string, string | null> = {};
    let quoted = 0;
    for (let i = 1; i < columns.length; i++) {
      const currency = columns[i];
      if (!currency) {
        continue;
      }
      const rate = readRateCell(cells[i] ?? '', `${currency} on ${day}`);
      rates[currency] = rate;
      if (rate !== null) {
        quoted++;
      }
    }
    if (quoted > 0) {
      tables.push(ecbTable(day, rates));
    }
  }
  return newestFirst(tables);
}

/** One CSV record per line, RFC 4180 quoting ("a, b" and "" for a quote inside quotes). */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.length > 1 || cells[0]!.trim() !== '');
}

// Series whose DECIMALS attribute says more than the ECB has ever published for them. Evidence:
// eurofxref-daily.xml publishes THB to 3 decimals (37.459 on 2026-11-06) while DECIMALS says 4,
// and eurofxref-hist.xml (1999 to 2026) never has more than 4 for LTL, whose DECIMALS says 5.
// Padding to the attribute would invent a digit. A cap only limits padding: a value published
// with more digits keeps them all (withDecimals never drops digits).
const PUBLISHED_DECIMALS: Readonly<Record<string, number>> = { THB: 3, LTL: 4 };

/** Options for parseEcbSdmxCsv. */
export interface EcbSdmxOptions {
  /**
   * The decimals each currency is published with, for a file without the DECIMALS column (as
   * fetched with `detail=dataonly`). A DECIMALS column in the file takes precedence.
   */
  readonly decimals?: Readonly<Record<string, number>>;
}

/** The columns of an SDMX-CSV file, by name, or SyntaxError when a required one is missing. */
function sdmxColumns(header: readonly string[], required: readonly string[]): Map<string, number> {
  const columns = new Map(header.map((name, i) => [name.trim(), i] as const));
  for (const name of required) {
    if (!columns.has(name)) {
      throw new SyntaxError(`Not an ECB SDMX-CSV file: no ${name} column`);
    }
  }
  return columns;
}

/**
 * The DECIMALS of each series in an ECB SDMX-CSV file: the data file itself with full detail, or
 * the series file the API returns with `detail=nodata`.
 */
export function parseEcbSdmxDecimals(csv: string): Record<string, number> {
  const [header, ...rows] = csvRows(withoutByteOrderMark(csv));
  const columns = sdmxColumns(header ?? [], ['CURRENCY', 'DECIMALS']);
  const decimals: Record<string, number> = {};
  for (const cells of rows) {
    const currency = cells[columns.get('CURRENCY')!]!.trim();
    const text = cells[columns.get('DECIMALS')!]?.trim() ?? '';
    if (/^\d{1,2}$/.test(text)) {
      decimals[currency] = Number(text);
    }
  }
  return decimals;
}

/** The value of an optional column, or undefined when the file doesn't have it. */
function optionalCell(cells: readonly string[], columns: Map<string, number>, name: string) {
  const index = columns.get(name);
  if (index === undefined) {
    return undefined;
  }
  return cells[index]?.trim();
}

/**
 * Parses the ECB Data Portal's SDMX-CSV (`format=csvdata`) for the daily euro reference rates
 * (dataflow EXR, key `D.<currencies>.EUR.SP00.A`) into one EUR-based table per day, newest first,
 * like parseEcbXml. Any date range back to 1999 comes in one file.
 *
 * The API strips trailing zeros ('136.8' for the published 136.80), so the published digits are
 * rebuilt from each series' DECIMALS attribute: in the file with full detail, or from `decimals`
 * (see parseEcbSdmxDecimals) for a `detail=dataonly` file. Two series overstate it (THB and LTL),
 * and are padded only to the decimals the ECB actually published. Without DECIMALS, the digits
 * stay as the file gives them; the values are exact either way. An empty or `NaN` value is a missing value.
 * A row for another frequency, rate type or base currency, or with a UNIT_MULT other than 0,
 * throws SyntaxError rather than being read as a daily rate. Discontinued series simply end, so
 * the tables of their last days include them.
 *
 *     const tables = parseEcbSdmxCsv(await (await fetch(url)).text());
 *     const history = rateHistory(tables); // from @ducatjs/money/convert/history
 */
export function parseEcbSdmxCsv(csv: string, options?: EcbSdmxOptions): RateTable[] {
  const [header, ...rows] = csvRows(withoutByteOrderMark(csv));
  const columns = sdmxColumns(header ?? [], [
    'CURRENCY',
    'CURRENCY_DENOM',
    'TIME_PERIOD',
    'OBS_VALUE',
  ]);
  const at = (cells: readonly string[], name: string): string =>
    cells[columns.get(name)!]?.trim() ?? '';

  const days = new Map<string, Record<string, string | null>>();
  for (const cells of rows) {
    const currency = at(cells, 'CURRENCY');
    const day = at(cells, 'TIME_PERIOD');
    const where = `${currency} on ${day}`;
    const unexpected =
      at(cells, 'CURRENCY_DENOM') !== 'EUR' ||
      (optionalCell(cells, columns, 'FREQ') ?? 'D') !== 'D' ||
      (optionalCell(cells, columns, 'EXR_TYPE') ?? 'SP00') !== 'SP00' ||
      (optionalCell(cells, columns, 'EXR_SUFFIX') ?? 'A') !== 'A';
    if (unexpected) {
      throw new SyntaxError(`Not a daily EUR reference rate: ${cells.join(',')}`);
    }
    if (!/^[A-Z]{3}$/.test(currency) || !ISO_DAY.test(day)) {
      throw new SyntaxError(`Malformed ECB SDMX-CSV row: ${cells.join(',')}`);
    }
    const multiplier = optionalCell(cells, columns, 'UNIT_MULT');
    if (multiplier !== undefined && multiplier !== '' && multiplier !== '0') {
      throw new SyntaxError(`Unsupported UNIT_MULT ${multiplier} (${where})`);
    }

    const value = at(cells, 'OBS_VALUE');
    let rate = readRateCell(value, where);
    if (rate !== null) {
      const stated = optionalCell(cells, columns, 'DECIMALS');
      let decimals = options?.decimals?.[currency];
      if (stated !== undefined && /^\d{1,2}$/.test(stated)) {
        decimals = Number(stated);
      }
      const published = PUBLISHED_DECIMALS[currency];
      if (decimals !== undefined && published !== undefined && published < decimals) {
        decimals = published;
      }
      if (decimals !== undefined) {
        rate = withDecimals(rate, decimals);
      }
    }

    const isoDay = calendarDay(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)),
      Number(day.slice(8)),
    );
    let rates = days.get(isoDay);
    if (rates === undefined) {
      rates = {};
      days.set(isoDay, rates);
    }
    rates[currency] = rate;
  }

  const tables: RateTable[] = [];
  for (const [day, rates] of days) {
    if (Object.values(rates).some((rate) => rate !== null)) {
      tables.push(ecbTable(day, rates));
    }
  }
  return newestFirst(tables);
}
