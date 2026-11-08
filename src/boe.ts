// `@ducatjs/money/convert/boe`: an offline parser for the Bank of England's daily spot exchange
// rates against sterling. Parser only: see parseBankOfEnglandCsv on licensing.
import { quotedTable } from './history.js';
import type { RateTable } from './provider.js';
import { addDayRate, csvRows, isCalendarDay, newestFirst, readRateCell } from './rate-text.js';

// The Bank's daily spot series against sterling, by code (currency units per £1).
const BOE_SERIES: Readonly<Record<string, string>> = {
  XUDLADS: 'AUD',
  XUDLZOS3: 'BGN',
  XUDLCDS: 'CAD',
  XUDLBK89: 'CNY',
  XUDLBK25: 'CZK',
  XUDLDKS: 'DKK',
  XUDLERS: 'EUR',
  XUDLHDS: 'HKD',
  XUDLBK33: 'HUF',
  XUDLBK97: 'INR',
  XUDLBK78: 'ILS',
  XUDLJYS: 'JPY',
  XUDLBK83: 'MYR',
  XUDLNDS: 'NZD',
  XUDLNKS: 'NOK',
  XUDLBK47: 'PLN',
  XUDLZOS4: 'RON',
  XUDLSRS: 'SAR',
  XUDLSGS: 'SGD',
  XUDLZRS: 'ZAR',
  XUDLBK93: 'KRW',
  XUDLSKS: 'SEK',
  XUDLSFS: 'CHF',
  XUDLTWS: 'TWD',
  XUDLBK87: 'THB',
  XUDLBK95: 'TRY',
  XUDLUSS: 'USD',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function notBoe(why: string): never {
  throw new SyntaxError(`Not a Bank of England spot rates CSV file: ${why}`);
}

/** '22 Dec 2025' as an ISO date, or SyntaxError. */
function isoDate(text: string): string {
  const match = /^(\d\d) ([A-Z][a-z]{2}) (\d{4})$/.exec(text.trim());
  const month = match === null ? 0 : MONTHS.indexOf(match[2]!) + 1;
  const day = match === null ? '' : `${match[3]}-${String(month).padStart(2, '0')}-${match[1]}`;
  if (month === 0 || !isCalendarDay(day)) {
    notBoe(`bad date ${JSON.stringify(text)}`);
  }
  return day;
}

/** Options for parseBankOfEnglandCsv. */
export interface BankOfEnglandOptions {
  /**
   * The decimals the Bank publishes, rebuilt because its CSV strips trailing zeros ('1.35' for
   * 1.3500). Default 4, as its database shows every spot series.
   */
  readonly decimals?: number;
}

/**
 * Parses the Bank of England database's CSV of daily spot rates against sterling (series XUDL…,
 * downloaded with codes as column titles: `DATE,XUDLUSS,XUDLERS,…` and dates like `22 Dec 2025`)
 * into one GBP-based table per day, newest first. Rates are currency units per £1, with `source:
 * 'BoE'` and `type: 'spot'`. The CSV strips trailing zeros, so they are rebuilt to `decimals`
 * (default 4). Holidays have no row; an empty cell (before a series starts, or after it ends, as
 * for BGN) is a missing value. An unknown series code, a bad date, two different values for a day
 * or any other unreadable cell throws SyntaxError. No `availableAt` is set: the Bank says only
 * that daily rates are updated "no more than two working days after the date to which they
 * relate".
 *
 * **Licensing: check before you republish.** The database is under the Open Government Licence,
 * but the Bank's legal page says "selected exchange rate data and series are excluded from this
 * licence" and "reproduced by the Bank under licence from third parties", and its spot rates
 * page says LSEG and Bloomberg BFIX may be sources, with LSEG content not to be redistributed
 * without LSEG's consent. No series is named either way, so ducat ships no Bank of England data
 * and no fetcher: parse files you have downloaded and may use. The Bank also says these "are not
 * official rates". For a licensed UK source, see HMRC's monthly rates
 * (@ducatjs/money/convert/hmrc).
 */
export function parseBankOfEnglandCsv(csv: string, options?: BankOfEnglandOptions): RateTable[] {
  const decimals = options?.decimals ?? 4;
  const [header, ...rows] = csvRows(csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv);
  if (header === undefined || header[0]?.trim() !== 'DATE' || header.length < 2) {
    notBoe('no DATE column');
  }
  const currencies = header.slice(1).map((code) => {
    const currency = BOE_SERIES[code.trim()];
    if (currency === undefined) {
      notBoe(`unknown series ${code} (use the daily spot series against sterling, XUDL…)`);
    }
    return currency;
  });
  if (new Set(currencies).size !== currencies.length) {
    notBoe('a series appears twice');
  }

  // A download always has a row per business day, so none at all is a cut-off file, not a range
  // of holidays.
  if (rows.length === 0) {
    notBoe('no observations');
  }
  const days = new Map<string, Record<string, string | null>>();
  for (const cells of rows) {
    if (cells.length !== header.length) {
      notBoe(`a row has ${cells.length} cells, the header ${header.length}`);
    }
    const day = isoDate(cells[0]!);
    currencies.forEach((currency, i) => {
      addDayRate(days, day, currency, readRateCell(cells[i + 1]!, `${currency} on ${day}`));
    });
  }

  const tables: RateTable[] = [];
  for (const [day, rates] of days) {
    if (Object.values(rates).some((rate) => rate !== null)) {
      tables.push(
        quotedTable({ base: 'GBP', source: 'BoE', type: 'spot', asOf: day, decimals, rates }),
      );
    }
  }
  return newestFirst(tables);
}
