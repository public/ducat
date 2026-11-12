// Malformed-input and boundary tests for the Bank of England parser in src/boe.ts: every series
// code, every month, padding and byte-order marks, and the messages that name the problem.
import { describe, expect, it } from 'vitest';
import { parseBankOfEnglandCsv } from '../src/boe.js';

const SERIES: Record<string, string> = {
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
const notBoe = (why: string) =>
  new SyntaxError(`Not a Bank of England spot rates CSV file: ${why}`);

describe('parseBankOfEnglandCsv', () => {
  it('maps every daily spot series to its currency', () => {
    const codes = Object.keys(SERIES);
    const [table] = parseBankOfEnglandCsv(
      `DATE,${codes.join(',')}\n22 Dec 2025,${codes.map((_, i) => `${i + 1}.5`).join(',')}`,
    );
    expect(table!.rates.map((rate) => `${rate.from}→${rate.to} ${rate}`)).toEqual(
      codes.map((code, i) => `GBP→${SERIES[code]} ${i + 1}.5000`),
    );
  });

  it('reads every month, padding and a byte-order mark', () => {
    const rows = MONTHS.map((month) => ` 05 ${month} 2025 , 1.35`);
    const tables = parseBankOfEnglandCsv(`﻿ DATE , XUDLUSS \n${rows.join('\n')}`);
    expect(tables.map((table) => table.asOf).reverse()).toEqual(
      MONTHS.map((_, i) => `2025-${String(i + 1).padStart(2, '0')}-05`),
    );
  });

  it('rejects bad dates', () => {
    for (const date of [
      '5 Dec 2025',
      '05 Dec 25',
      'x05 Dec 2025',
      '05 Dec 2025x',
      '05 DEC 2025',
      '31 Nov 2025',
      '05 Smr 2025',
    ]) {
      expect(() => parseBankOfEnglandCsv(`DATE,XUDLUSS\n${date},1.35`)).toThrow(
        notBoe(`bad date ${JSON.stringify(date)}`),
      );
    }
  });

  it('names a malformed file', () => {
    expect(() => parseBankOfEnglandCsv('')).toThrow(notBoe('no DATE column'));
    expect(() => parseBankOfEnglandCsv('DAY,XUDLUSS\n05 Dec 2025,1.35')).toThrow(
      notBoe('no DATE column'),
    );
    expect(() => parseBankOfEnglandCsv('DATE\n05 Dec 2025')).toThrow(notBoe('no DATE column'));
    expect(() => parseBankOfEnglandCsv('DATE,XUDLFOO\n05 Dec 2025,1.35')).toThrow(
      notBoe('unknown series XUDLFOO (use the daily spot series against sterling, XUDL…)'),
    );
    expect(() => parseBankOfEnglandCsv('DATE,XUDLUSS, XUDLUSS\n05 Dec 2025,1.35,1.35')).toThrow(
      notBoe('a series appears twice'),
    );
    expect(() => parseBankOfEnglandCsv('DATE,XUDLUSS')).toThrow(notBoe('no observations'));
    expect(() => parseBankOfEnglandCsv('DATE,XUDLUSS,XUDLERS\n05 Dec 2025,1.35')).toThrow(
      notBoe('a row has 2 cells, the header 3'),
    );
    expect(() => parseBankOfEnglandCsv('DATE,XUDLUSS\n05 Dec 2025,')).toThrow(
      notBoe('no rates in any row'),
    );
  });
});
