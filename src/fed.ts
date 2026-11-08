// `@ducatjs/money/convert/fed`: an offline parser for the Federal Reserve Board's H.10 foreign
// exchange rates. Parser only, no fetcher: see parseFedH10Csv for where the files come from.
import { quotedTable } from './history.js';
import type { RateTable } from './provider.js';
import { csvRows, readRateCell } from './rate-text.js';

const ISO_DAY = /^\d{4}-\d\d-\d\d$/;
// RXI$US_N.B.EU is USD per euro; RXI_N.B.JA is yen per USD.
const SERIES = /^(?:H10\/H10\/)?RXI(\$US)?_N\.B\.[A-Z]{2,3}$/;

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
 *   the day before. A single `ND` cell is a missing value.
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
  const labelled = (label: string) => rows.find((cells) => cells[0]?.trim() === label);
  const currencies = labelled('Currency:');
  const multipliers = labelled('Multiplier:');
  const series = labelled('Time Period') ?? notH10('no "Time Period" row');
  if (currencies === undefined || currencies.length !== series.length) {
    notH10('no "Currency:" row matching the columns');
  }

  // Each column: its currency, and whether it is quoted as USD per unit (to be inverted).
  const columns: { currency: string; inverted: boolean }[] = [];
  for (let i = 1; i < series.length; i++) {
    const id = SERIES.exec(series[i]!.trim());
    const currency = currencies[i]!.trim();
    if (id === null || !/^[A-Z]{3}$/.test(currency)) {
      notH10(`column ${i + 1} is ${series[i]} for ${currency}`);
    }
    // A multiplier other than 1 would make the published number mean something else.
    const multiplier = multipliers?.[i]?.trim();
    if (multiplier !== undefined && multiplier !== '1') {
      throw new SyntaxError(`Unsupported H.10 multiplier ${multiplier} for ${currency}`);
    }
    columns.push({ currency, inverted: id[1] !== undefined });
  }

  const tables: RateTable[] = [];
  for (const cells of rows.slice(rows.indexOf(series) + 1)) {
    const day = cells[0]!.trim();
    if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(day)) || cells.length !== series.length) {
      throw new SyntaxError(`Malformed H.10 row: ${cells.join(',')}`);
    }
    const rates: Record<string, { rate: string; inverted: boolean } | null> = {};
    let quoted = 0;
    columns.forEach(({ currency, inverted }, i) => {
      const rate = readRateCell(cells[i + 1]!, `${currency} on ${day}`);
      if (rate === null) {
        rates[currency] = null;
      } else {
        rates[currency] = { rate, inverted };
        quoted++;
      }
    });
    if (quoted > 0) {
      tables.push(
        quotedTable({ base: 'USD', source: 'FRB', type: 'noon buying', asOf: day, rates }),
      );
    }
  }
  return tables.sort((table, other) => other.asOf!.localeCompare(table.asOf!));
}
