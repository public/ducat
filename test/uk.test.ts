import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert.js';
import { parseBankOfEnglandCsv } from '../src/boe.js';
import { money } from '../src/fn.js';
import { rateHistory } from '../src/history.js';
import { parseHmrcMonthlyCsv } from '../src/hmrc.js';
import { via } from '../src/provider.js';
import { exchangeRate } from '../src/rate.js';

// Downloaded from trade-tariff.service.gov.uk on 2026-11-08 (Open Government Licence v3.0).
const november = readFileSync(
  new URL('fixtures/hmrc/monthly_csv_2026-11.csv', import.meta.url),
  'utf8',
);
const HMRC_HEADER =
  'Country/Territories,Currency,Currency Code,Currency Units per £1,Start date,End date';
const hmrcRow = (code: string, rate: string, start = '01/10/2026', end = '31/10/2026') =>
  `Somewhere,Unit,${code},${rate},${start},${end}`;

// Bank of England spot rates may be third-party data, so these tests use made-up numbers in the
// format of a download from the Bank's database, never real Bank of England data.
const BOE_HEADER = 'DATE,XUDLUSS,XUDLERS,XUDLJYS';
const boe = [
  BOE_HEADER,
  '05 Jan 2026,1.25,1.1111,200.5',
  '02 Jan 2026,1.2499,1.1112,200.4321',
  '31 Dec 2025,1.2498,,200.4',
].join('\n');

describe('parseHmrcMonthlyCsv', () => {
  it('one GBP table for the month, valid all month, published the penultimate Thursday before', () => {
    const [table, ...rest] = parseHmrcMonthlyCsv(november);
    expect(rest).toEqual([]);
    expect(table).toMatchObject({
      base: 'GBP',
      asOf: '2026-11-01',
      validUntil: '2026-11-30',
      availableAt: '2026-10-22',
    });
    expect(table!.rates.length).toBeGreaterThan(140);
    const gbpEur = table!.rate('GBP', 'EUR', { asOf: '2026-11-15T10:00:00Z' })!;
    expect(gbpEur).toMatchObject({ source: 'HMRC', type: 'customs' });
    expect(gbpEur.toString()).toBe('1.1930');
    expect(table!.rate('GBP', 'EUR', { asOf: '2026-12-01' })).toBeUndefined();
    expect(table!.rate('GBP', 'EUR', { asOf: '2026-10-21' })).toBeUndefined();
    // shared codes (the CFA francs, AED, XCD, XPF) agree, so they are one rate each
    expect(table!.rate('GBP', 'XOF')?.toString()).toBe('782.5263');
    expect(table!.rate('GBP', 'AED')?.toString()).toBe('4.9198');
  });

  it('works as a period table in rateHistory, through GBP', () => {
    const october = parseHmrcMonthlyCsv(
      [HMRC_HEADER, hmrcRow('EUR', '1.1500'), hmrcRow('USD', '1.3000')].join('\n'),
    );
    const history = rateHistory([...parseHmrcMonthlyCsv(november), ...october], { lookback: 0 });
    expect(history.rate('GBP', 'EUR', { asOf: '2026-10-31' })?.toString()).toBe('1.1500');
    expect(history.rate('GBP', 'EUR', { asOf: '2026-11-29' })?.toString()).toBe('1.1930');
    const usd = convert(money('115.00', 'EUR'), 'USD', via('GBP', history), 'halfEven', {
      asOf: '2026-10-15',
    });
    expect(usd.toDecimal()).toBe('130.00');
  });

  it('the penultimate Thursday, every month of a year', () => {
    const published = (start: string) =>
      parseHmrcMonthlyCsv([HMRC_HEADER, hmrcRow('EUR', '1.1', start, start)].join('\n'))[0]!
        .availableAt;
    expect(published('01/01/2027')).toBe('2026-12-24');
    expect(published('01/03/2026')).toBe('2026-02-19');
    expect(published('01/10/2026')).toBe('2026-09-17');
    for (let month = 1; month <= 12; month++) {
      const start = `01/${String(month).padStart(2, '0')}/2027`;
      const day = new Date(`${published(start)!}T00:00:00Z`);
      expect(day.getUTCDay()).toBe(4); // a Thursday
      const later = new Date(day.getTime() + 7 * 86_400_000);
      expect(later.getUTCMonth()).toBe(day.getUTCMonth()); // one more Thursday that month
      const twoLater = new Date(day.getTime() + 14 * 86_400_000);
      expect(twoLater.getUTCMonth()).not.toBe(day.getUTCMonth()); // but not two
    }
    const custom = parseHmrcMonthlyCsv([HMRC_HEADER, hmrcRow('EUR', '1.1')].join('\n'), {
      availableAt: () => '2026-09-24T12:00:00Z',
    });
    expect(custom[0]!.availableAt).toBe('2026-09-24T12:00:00.000Z');
    const none = parseHmrcMonthlyCsv([HMRC_HEADER, hmrcRow('EUR', '1.1')].join('\n'), {
      availableAt: false,
    });
    expect(none[0]!.availableAt).toBeUndefined();
  });

  it('refuses what it cannot read', () => {
    const file = (...rows: string[]) => [HMRC_HEADER, ...rows].join('\n');
    expect(() => parseHmrcMonthlyCsv('<html>')).toThrow(SyntaxError);
    expect(() => parseHmrcMonthlyCsv(HMRC_HEADER)).toThrow(/no rates/);
    expect(() => parseHmrcMonthlyCsv(file(hmrcRow('EUR', '1.1'), hmrcRow('EUR', '1.2')))).toThrow(
      /Two different values for EUR/,
    );
    expect(() => parseHmrcMonthlyCsv(file(hmrcRow('EUR', '1.1', '31/02/2026')))).toThrow(
      /bad date/,
    );
    expect(() =>
      parseHmrcMonthlyCsv(file(hmrcRow('EUR', '1.1', '01/11/2026', '31/10/2026'))),
    ).toThrow(/before it starts/);
    expect(() => parseHmrcMonthlyCsv(file(hmrcRow('GBP', '1')))).toThrow(SyntaxError);
    expect(() => parseHmrcMonthlyCsv(file(hmrcRow('Euro', '1.1')))).toThrow(SyntaxError);
    expect(() => parseHmrcMonthlyCsv(file(hmrcRow('EUR', '1,1')))).toThrow(SyntaxError);
    expect(() => parseHmrcMonthlyCsv(file('Somewhere,Unit,EUR,1.1,01/10/2026'))).toThrow(/cells/);
  });
});

describe('parseBankOfEnglandCsv', () => {
  it('one GBP table per day, newest first, with the stripped zeros put back', () => {
    const tables = parseBankOfEnglandCsv(boe);
    expect(tables.map((table) => table.asOf)).toEqual(['2026-01-05', '2026-01-02', '2025-12-31']);
    const [latest] = tables;
    expect(latest!.rate('GBP', 'USD')).toMatchObject({ source: 'BoE', type: 'spot' });
    expect(latest!.rate('GBP', 'USD')!.toString()).toBe('1.2500');
    expect(latest!.rate('GBP', 'USD')!.quote).toEqual({ rate: '1.2500' });
    expect(latest!.rate('GBP', 'JPY')!.toString()).toBe('200.5000');
    expect(tables[2]!.missing).toEqual(['EUR']);
    expect(parseBankOfEnglandCsv(boe, { decimals: 2 })[0]!.rate('GBP', 'USD')!.toString()).toBe(
      '1.25',
    );
  });

  it('feeds rateHistory: the missing holidays fall back', () => {
    const history = rateHistory(parseBankOfEnglandCsv(boe));
    const newYear = history.lookup('GBP', 'USD', { asOf: '2026-01-01' });
    expect(newYear.rate?.asOf).toBe('2025-12-31');
    expect(newYear.skipped).toEqual([{ day: '2026-01-01', reason: 'noTable' }]);
    // EUR is missing on the 31st, so it goes back further, and isn't in this file
    expect(history.lookup('GBP', 'EUR', { asOf: '2025-12-31' }).skipped[0]).toEqual({
      day: '2025-12-31',
      reason: 'missing',
    });
  });

  it('refuses what it cannot read', () => {
    expect(() => parseBankOfEnglandCsv('<html>')).toThrow(SyntaxError);
    expect(() => parseBankOfEnglandCsv(BOE_HEADER)).toThrow(/no observations/);
    expect(() => parseBankOfEnglandCsv('DATE,XUDLXXS\n05 Jan 2026,1')).toThrow(/unknown series/);
    expect(() => parseBankOfEnglandCsv('DATE,XUDLUSS,XUDLUSS\n05 Jan 2026,1,1')).toThrow(/twice/);
    expect(() => parseBankOfEnglandCsv(`${BOE_HEADER}\n2026-01-05,1,1,1`)).toThrow(/bad date/);
    expect(() => parseBankOfEnglandCsv(`${BOE_HEADER}\n31 Feb 2026,1,1,1`)).toThrow(/bad date/);
    expect(() => parseBankOfEnglandCsv(`${BOE_HEADER}\n05 Jan 2026,1,1`)).toThrow(/cells/);
    expect(() =>
      parseBankOfEnglandCsv(`${BOE_HEADER}\n05 Jan 2026,1.1,1,1\n05 Jan 2026,1.2,1,1`),
    ).toThrow(/Two different values for USD/);
    expect(() => parseBankOfEnglandCsv(`${BOE_HEADER}\n05 Jan 2026,1x,1,1`)).toThrow(
      /USD on 2026-01-05/,
    );
  });

  it('keeps every value exactly, padded to the decimals (property)', () => {
    const value = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 10n }), fc.integer({ min: 0, max: 4 }))
      .map(([digits, scale]) => exchangeRate('X', 'Y', `${digits}/${10n ** BigInt(scale)}`))
      .map((rate) => rate.toString());
    fc.assert(
      fc.property(value, (text) => {
        const [table] = parseBankOfEnglandCsv(`DATE,XUDLUSS\n05 Jan 2026,${text}`);
        const rate = table!.rate('GBP', 'USD')!;
        expect(rate.ratio).toEqual(exchangeRate('GBP', 'USD', text).ratio);
        expect(rate.toString().split('.')[1]?.length ?? 0).toBeGreaterThanOrEqual(4);
      }),
    );
  });
});
