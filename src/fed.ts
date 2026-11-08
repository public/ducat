// `@ducatjs/money/convert/fed`: an offline parser for the Federal Reserve Board's H.10 foreign
// exchange rates. Parser only, no fetcher: see parseFedH10Csv for where the files come from.
import { quotedTable } from './history.js';
import type { RateTable } from './provider.js';
import { addDayRate, csvRows, isCalendarDay, newestFirst, readRateCell } from './rate-text.js';

// RXI$US_N.B.EU is USD per euro; RXI_N.B.JA is yen per USD.
const SERIES = /^(?:H10\/H10\/)?RXI(\$US)?_N\.B\.([A-Z]{2,3})$/;

// The country codes in H.10 series IDs, and the currency each one's column must carry.
const FED_COUNTRIES: Readonly<Record<string, string>> = {
  AL: 'AUD',
  EU: 'EUR',
  NZ: 'NZD',
  UK: 'GBP',
  BZ: 'BRL',
  CA: 'CAD',
  CH: 'CNY',
  DN: 'DKK',
  HK: 'HKD',
  IN: 'INR',
  JA: 'JPY',
  MA: 'MYR',
  MX: 'MXN',
  NO: 'NOK',
  SF: 'ZAR',
  SI: 'SGD',
  KO: 'KRW',
  SL: 'LKR',
  SD: 'SEK',
  SZ: 'CHF',
  TA: 'TWD',
  TH: 'THB',
  VES: 'VEB',
};

function notH10(why: string): never {
  throw new SyntaxError(`Not a Federal Reserve H.10 CSV file: ${why}`);
}

/**
 * Parses the Federal Reserve Board's H.10 daily foreign exchange rates, as CSV from its Data
 * Download Program (DDP), into one USD-based table per day, newest first. These are the noon
 * buying rates in New York, certified by the New York Fed for customs purposes, with `source:
 * 'FRB'` and `type: 'noon buying'`, back to 1971.
 *
 * - **Direction.** H.10 quotes "currency units per U.S. dollar except as noted": AUD, EUR, NZD and
 *   GBP (series `RXI$US_N.B.*`) are USD per unit. Those four are stored as exact inverses, so
 *   every table is USD → currency, and the published quote stays on the rate:
 *   `rate('USD', 'EUR').inverse().toString()` is '1.1750' again.
 * - **Holidays** are rows of `ND` ("no data"); such a day is left out, so a lookback goes on to
 *   the day before, and a file of holidays only gives []. A single `ND` cell is a missing value.
 *   A file with no observation rows at all throws, as it is more likely cut short than empty.
 * - **Strict:** each column's Unit, Multiplier and Currency must be "Currency", 1 and the code
 *   its series ID stands for (EU is EUR), a currency can't have two columns, and two different
 *   values for one day throw.
 * - **Digits.** H.10 publishes four decimals and keeps trailing zeros; they are kept.
 * - **Codes.** The Fed's column codes are used as they are, so the bolivar is `VEB`, as the Fed
 *   labels it.
 * - **Publication.** The release is weekly (Mondays, 4:15 p.m. ET) and covers the week before,
 *   so a Tuesday's rate is known only up to six days later. The CSV doesn't say when each row was
 *   released, so no `availableAt` is set; give each table one yourself if a backtest needs it.
 *
 * **Where the data comes from.** The DDP at federalreserve.gov/datadownload (release H10, CSV,
 * "series in columns", with labels) serves these files today. The Board is retiring the DDP: the
 * "Build Your Package" feature goes in November 2026 and the rest later, and it points users to
 * FRED (fred.stlouisfed.org) instead. FRED needs an API key, and its terms forbid storing or
 * caching its content and any commercial use without consent, which is why ducat has no H.10
 * fetcher. Board data itself is public domain ("please cite to the Board as the source").
 *
 *     const tables = parseFedH10Csv(await readFile('FRB_H10.csv', 'utf8'));
 */
export function parseFedH10Csv(csv: string): RateTable[] {
  const rows = csvRows(csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv);
  const series =
    rows.find((cells) => cells[0]?.trim() === 'Time Period') ?? notH10('no "Time Period" row');
  const labelled = (label: string): string[] => {
    const row = rows.find((cells) => cells[0]?.trim() === label);
    if (row === undefined || row.length !== series.length) {
      notH10(`no "${label}" row matching the columns`);
    }
    return row;
  };
  const currencies = labelled('Currency:');
  const multipliers = labelled('Multiplier:');
  const units = labelled('Unit:');

  // Each column: its currency, and whether it is quoted as USD per unit (to be inverted).
  const columns: { currency: string; inverted: boolean }[] = [];
  for (let i = 1; i < series.length; i++) {
    const id = SERIES.exec(series[i]!.trim());
    const currency = currencies[i]!.trim();
    if (id === null || !/^[A-Z]{3}$/.test(currency) || currency === 'USD') {
      notH10(`column ${i + 1} is ${series[i]} for ${currency}`);
    }
    // The series ID names the country; it must agree with the currency code beside it.
    const expected = FED_COUNTRIES[id[2]!];
    if (expected !== undefined && expected !== currency) {
      notH10(`series ${series[i]} is ${expected}, not ${currency}`);
    }
    if (columns.some((column) => column.currency === currency)) {
      notH10(`${currency} has two columns`);
    }
    // Other units or a multiplier other than 1 would make the published number mean something else.
    if (units[i]!.trim() !== 'Currency' || multipliers[i]!.trim() !== '1') {
      throw new SyntaxError(
        `Unsupported H.10 unit ${units[i]} × ${multipliers[i]} for ${currency}`,
      );
    }
    columns.push({ currency, inverted: id[1] !== undefined });
  }

  const observations = rows.slice(rows.indexOf(series) + 1);
  if (observations.length === 0) {
    notH10('no observations');
  }
  const days = new Map<string, Record<string, string | null>>();
  for (const cells of observations) {
    const day = cells[0]!.trim();
    if (!isCalendarDay(day) || cells.length !== series.length) {
      throw new SyntaxError(`Malformed H.10 row: ${cells.join(',')}`);
    }
    columns.forEach(({ currency }, i) => {
      addDayRate(days, day, currency, readRateCell(cells[i + 1]!, `${currency} on ${day}`));
    });
  }

  const tables: RateTable[] = [];
  for (const [day, published] of days) {
    const rates: Record<string, { rate: string; inverted: boolean } | null> = {};
    let quoted = 0;
    for (const { currency, inverted } of columns) {
      const rate = published[currency] ?? null;
      rates[currency] = rate === null ? null : { rate, inverted };
      if (rate !== null) {
        quoted++;
      }
    }
    if (quoted > 0) {
      tables.push(
        quotedTable({ base: 'USD', source: 'FRB', type: 'noon buying', asOf: day, rates }),
      );
    }
  }
  return newestFirst(tables);
}
