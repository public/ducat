import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert.js';
import { money } from '../src/fn.js';
import { parseEcbCsv } from '../src/ecb.js';
import { quotedTable, rateFromQuote, rateHistory } from '../src/history.js';
import { rateTable, snapshotsFrom, via, type RateTable } from '../src/provider.js';
import { exchangeRate, rateFromJSON, type RateJSON } from '../src/rate.js';
import { readRateCell, withDecimals } from '../src/rate-text.js';

const DAY_MS = 86_400_000;

function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

function ecbDay(asOf: string, rates: Record<string, string | null>, availableAt?: string) {
  if (availableAt === undefined) {
    return rateTable({ base: 'EUR', source: 'ECB', asOf, rates });
  }
  return rateTable({ base: 'EUR', source: 'ECB', asOf, availableAt, rates });
}

describe('publication time (availableAt)', () => {
  const published = ecbDay('2026-11-06', { USD: '1.1165' }, '2026-11-06T15:00:00Z');

  it('a lookup before publication gets nothing; a date asks for the whole day', () => {
    expect(published.availableAt).toBe('2026-11-06T15:00:00.000Z');
    expect(published.rate('EUR', 'USD', { asOf: '2026-11-06T14:59:59Z' })).toBeUndefined();
    expect(published.rate('EUR', 'USD', { asOf: '2026-11-06T15:00:00Z' })?.toString()).toBe(
      '1.1165',
    );
    expect(published.rate('EUR', 'USD', { asOf: '2026-11-06' })).toBeDefined();
    expect(published.rate('EUR', 'USD')?.availableAt).toBe('2026-11-06T15:00:00.000Z');
  });

  it('Rate#isAvailable, and derived rates are available when their last input is', () => {
    const eurUsd = exchangeRate('EUR', 'USD', '1.1165', { availableAt: '2026-11-06T15:00:00Z' });
    const usdJpy = exchangeRate('USD', 'JPY', '158.33', { availableAt: '2026-11-07' });
    expect(eurUsd.isAvailable('2026-11-06T14:00:00Z')).toBe(false);
    expect(eurUsd.isAvailable('2026-11-06')).toBe(true);
    expect(eurUsd.isAvailable(new Date(Date.UTC(2026, 10, 6, 16)))).toBe(true);
    expect(exchangeRate('EUR', 'USD', '1').isAvailable('1999-01-01')).toBe(true);
    const eurJpy = eurUsd.andThen(usdJpy);
    expect(eurJpy.availableAt).toBe('2026-11-07');
    expect(eurJpy.isAvailable('2026-11-06T23:59:59Z')).toBe(false);
    expect(eurUsd.inverse().availableAt).toBe('2026-11-06T15:00:00.000Z');
    expect(eurUsd.withMargin('0.01').availableAt).toBe('2026-11-06T15:00:00.000Z');
  });

  it('snapshots pass over a table not yet published at the instant asked for', async () => {
    const thursday = ecbDay('2026-11-05', { USD: '1.1100' }, '2026-11-05T15:00:00Z');
    const oneDayHistory = snapshotsFrom([published, thursday]);
    expect(await oneDayHistory.at('2026-11-06T09:00:00Z')).toBe(thursday);
    expect(await oneDayHistory.at('2026-11-06T16:00:00Z')).toBe(published);
    expect(await oneDayHistory.at('2026-11-06')).toBe(published);
  });
});

describe('quote direction and per-unit quotes', () => {
  it('an inverted table stores exact inverses and keeps the published quote', () => {
    const boc = quotedTable({
      base: 'CAD',
      source: 'BoC',
      asOf: '2026-11-06',
      inverted: true,
      rates: { USD: '1.3654', JPY: { rate: '0.008770' } },
    });
    const cadUsd = boc.rate('CAD', 'USD')!;
    expect(cadUsd.toString()).toBe('5000/6827');
    expect(cadUsd.quote).toEqual({ rate: '1.3654', inverted: true });
    expect(cadUsd.inverse().toString()).toBe('1.3654');
    expect(cadUsd.convert(money('136.54', 'CAD'), 'halfEven').toDecimal()).toBe('100.00');
    expect(boc.rate('CAD', 'JPY')?.quote).toEqual({ rate: '0.008770', inverted: true });
  });

  it('per-100 quotes, and mixed directions in one table', () => {
    const nok = quotedTable({
      base: 'NOK',
      asOf: '2026-11-06',
      rates: {
        JPY: { rate: '6.50', per: 100, inverted: true }, // NOK per 100 JPY
        USD: { rate: '10.099', inverted: true },
        XAU: '0.0000037', // XAU per NOK, the table's own direction
      },
    });
    expect(nok.rate('NOK', 'JPY')?.toString()).toBe('200/13'); // 100 / 6.5
    expect(nok.rate('NOK', 'JPY')?.inverse().toString()).toBe('0.065');
    expect(nok.rate('NOK', 'JPY')?.quote).toEqual({ rate: '6.50', per: 100, inverted: true });
    expect(nok.rate('NOK', 'XAU')?.quote).toEqual({ rate: '0.0000037' });
    expect(convert(money('1000', 'JPY'), 'NOK', via('NOK', nok), 'halfEven').toDecimal()).toBe(
      '65.00',
    );
  });

  it('rateFromQuote, and quotes are checked against the rate', () => {
    expect(rateFromQuote('JPY', 'CHF', { rate: '0.5712', per: 100 }).toString()).toBe('0.005712');
    expect(rateFromQuote('EUR', 'USD', { rate: '1.1650' }).toString()).toBe('1.1650');
    expect(() => rateFromQuote('EUR', 'USD', { rate: '1e3' })).toThrow(RangeError);
    expect(() => rateFromQuote('EUR', 'USD', { rate: '1', per: 0 })).toThrow(RangeError);
    expect(() => rateFromQuote('EUR', 'USD', { rate: '1', per: 1.5 })).toThrow(RangeError);
    expect(() => exchangeRate('EUR', 'USD', '1.2', { quote: { rate: '1.3' } })).toThrow(RangeError);
    expect(() => quotedTable({ base: 'EUR', rates: { USD: '1,165' } })).toThrow(RangeError);
    // rateTable takes ready-made Rates too, as long as they are base → currency
    const table = rateTable({
      base: 'EUR',
      rates: { USD: rateFromQuote('EUR', 'USD', { rate: '1.10' }) },
    });
    expect(table.rate('EUR', 'USD')?.toString()).toBe('1.10');
  });

  it('the inverse of a quoted rate keeps the published digits', () => {
    const boc = quotedTable({ base: 'CAD', inverted: true, rates: { USD: '1.3650' } });
    const usdCad = boc.rate('CAD', 'USD')!.inverse();
    expect(usdCad.toString()).toBe('1.3650');
    expect(usdCad.inverse().quote).toEqual({ rate: '1.3650', inverted: true });
    const perHundred = rateFromQuote('JPY', 'NOK', { rate: '6.50', per: 100 });
    expect(perHundred.inverse().quote).toEqual({ rate: '6.50', per: 100, inverted: true });
    expect(perHundred.inverse().inverse().toString()).toBe('0.065');
    expect(rateFromQuote('EUR', 'USD', { rate: '1.10', per: 1, inverted: false }).quote).toEqual({
      rate: '1.10',
    });
    expect(rateFromQuote('EUR', 'USD', { rate: '1.10', per: 1 }).toString()).toBe('1.10');
  });

  it('per and inverted quotes are exact (property)', () => {
    const published = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.integer({ min: 0, max: 8 }))
      .map(([digits, scale]) => {
        const text = digits.toString().padStart(scale + 1, '0');
        if (scale === 0) {
          return text;
        }
        return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
      });
    const per = fc.constantFrom(1, 10, 100, 1000, 10_000);
    fc.assert(
      fc.property(published, per, fc.boolean(), (text, units, inverted) => {
        const rate = rateFromQuote('AAA', 'BBB', { rate: text, per: units, inverted });
        // published number = BBB per `units` AAA, or AAA per `units` BBB when inverted
        const direct = exchangeRate('AAA', 'BBB', `${text}/${units}`);
        const expected = inverted ? exchangeRate('BBB', 'AAA', `${text}/${units}`) : direct;
        if (inverted) {
          expect(rate.inverse().ratio).toEqual(expected.ratio);
        } else {
          expect(rate.ratio).toEqual(expected.ratio);
        }
        // the JSON form keeps the quote and the digits
        const back = rateFromJSON(JSON.parse(JSON.stringify(rate)) as RateJSON);
        expect(back.ratio).toEqual(rate.ratio);
        expect(back.quote ?? { rate: back.toString() }).toEqual(
          rate.quote ?? { rate: rate.toString() },
        );
      }),
    );
  });
});

describe('published digits', () => {
  it('a decimal-string rate prints as published, and round-trips through JSON', () => {
    const huf = exchangeRate('EUR', 'HUF', '363.90', { availableAt: '2026-11-06' });
    expect(huf.toString()).toBe('363.90');
    expect(huf.toJSON()).toEqual({
      from: 'EUR',
      to: 'HUF',
      rate: '363.90',
      availableAt: '2026-11-06',
    });
    const back = rateFromJSON(huf.toJSON());
    expect([back.toString(), back.availableAt]).toEqual(['363.90', '2026-11-06']);
    expect(exchangeRate('EUR', 'USD', '1.1165').quote).toBeUndefined(); // nothing extra to keep
    expect(exchangeRate('EUR', 'USD', '2.0').toString()).toBe('2.0');
    expect(exchangeRate('EUR', 'USD', '01.50').toString()).toBe('1.5'); // not a published form
    expect(exchangeRate('EUR', 'USD', '150').quote).toBeUndefined();
    expect(exchangeRate('EUR', 'HUF', '363.90').ratio).toEqual(
      exchangeRate('EUR', 'HUF', '363.9').ratio,
    );
  });

  it('decimals rebuild the digits a feed stripped', () => {
    const table = quotedTable({
      base: 'EUR',
      rates: { USD: { rate: '1.175', decimals: 4 }, JPY: { rate: '148', decimals: 2 } },
    });
    expect(table.rate('EUR', 'USD')?.toString()).toBe('1.1750');
    expect(table.rate('EUR', 'JPY')?.toString()).toBe('148.00');
    expect(withDecimals('1.17501', 4)).toBe('1.17501'); // never drops a digit
    expect(() => withDecimals('1', -1)).toThrow(RangeError);
  });

  it('withDecimals keeps the value and gives at least the stated decimals (property)', () => {
    const text = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 15n }), fc.integer({ min: 0, max: 10 }))
      .map(([digits, scale]) => exchangeRate('X', 'Y', `${digits}/${10n ** BigInt(scale)}`))
      .map((rate) => rate.toString());
    fc.assert(
      fc.property(text, fc.integer({ min: 0, max: 12 }), (published, decimals) => {
        const padded = withDecimals(published, decimals);
        expect(exchangeRate('X', 'Y', padded).ratio).toEqual(
          exchangeRate('X', 'Y', published).ratio,
        );
        const point = padded.indexOf('.');
        const places = point === -1 ? 0 : padded.length - point - 1;
        expect(places).toBeGreaterThanOrEqual(decimals);
      }),
    );
  });
});

describe('missing values', () => {
  it('every source marker reads as missing; garbage throws', () => {
    for (const marker of ['', ' ', 'ND', 'N/A', 'n/a', 'NA', '-', '—', 'NaN', 'null']) {
      expect(readRateCell(marker, 'test')).toBeNull();
    }
    expect(readRateCell(' 1.1650 ', 'test')).toBe('1.1650');
    expect(() => readRateCell('1,1650', 'USD on 2026-11-06')).toThrow(/USD on 2026-11-06/);
    expect(() => readRateCell('-1.2', 'test')).toThrow(SyntaxError);
  });

  it('a table lists missing currencies and answers nothing for them', () => {
    const table = ecbDay('2026-11-06', { USD: '1.1165', ISK: null });
    expect(table.missing).toEqual(['ISK']);
    expect(table.rate('EUR', 'ISK')).toBeUndefined();
    expect(table.rates.map((rate) => rate.to)).toEqual(['USD']);
    expect(ecbDay('2026-11-06', { USD: '1.1165' }).missing).toBeUndefined();
  });

  it('the ECB CSV marks N/A and blank cells as missing', () => {
    const [table] = parseEcbCsv('Date,USD,ISK,\n06 November 2026,1.1165,N/A,\n');
    expect(table!.missing).toEqual(['ISK']);
    expect(() => parseEcbCsv('Date,USD\n06 November 2026,1.1x\n')).toThrow(SyntaxError);
  });
});

describe('tables valid for a period', () => {
  const october = rateTable({
    base: 'GBP',
    source: 'HMRC',
    asOf: '2026-10-01',
    validUntil: '2026-10-31',
    rates: { USD: '1.3012' },
  });
  const november = rateTable({
    base: 'GBP',
    source: 'HMRC',
    asOf: '2026-11-01',
    validUntil: '2026-11-30',
    rates: { USD: '1.3207' },
  });

  it('a table answers for its period only', () => {
    expect(november.validUntil).toBe('2026-11-30');
    expect(november.rate('GBP', 'USD', { asOf: '2026-11-30T23:59:59Z' })).toBeDefined();
    expect(november.rate('GBP', 'USD', { asOf: '2026-12-01' })).toBeUndefined();
    expect(november.rate('GBP', 'USD', { asOf: '2026-10-31' })).toBeUndefined();
    expect(november.rate('GBP', 'USD')).toBeDefined(); // no asOf: no date check
  });

  it('a history of monthly tables answers any day in each month, without lookback', () => {
    const hmrc = rateHistory([october, november], { lookback: 0 });
    expect(hmrc.rate('GBP', 'USD', { asOf: '2026-11-29' })?.toString()).toBe('1.3207');
    expect(hmrc.rate('GBP', 'USD', { asOf: '2026-10-15' })?.toString()).toBe('1.3012');
    // the month's table is the table for every day in it: nothing was passed over
    expect(hmrc.lookup('GBP', 'USD', { asOf: '2026-10-15' }).skipped).toEqual([]);
    const december = hmrc.lookup('GBP', 'USD', { asOf: '2026-12-02' });
    expect(december.rate).toBeUndefined();
    expect(december.skipped).toEqual([{ day: '2026-12-02', reason: 'noTable' }]);
    // a table whose period ended inside the lookback is reported as expired
    const lastDay = rateTable({
      base: 'GBP',
      asOf: '2026-11-30',
      validUntil: '2026-11-30',
      rates: { USD: '1.3207' },
    });
    expect(
      rateHistory([lastDay], { lookback: 2 }).lookup('GBP', 'USD', { asOf: '2026-12-01' }),
    ).toEqual({
      rate: undefined,
      skipped: [
        { day: '2026-12-01', reason: 'noTable' },
        { day: '2026-11-30', reason: 'expired' },
        { day: '2026-11-29', reason: 'noTable' },
      ],
    });
  });
});

describe('rateHistory: daily and period tables together', () => {
  const annual = rateTable({
    base: 'GBP',
    asOf: '2026-01-01',
    validUntil: '2026-12-31',
    rates: { USD: '1.2500', JPY: '190.00' },
  });
  const daily = rateTable({ base: 'GBP', asOf: '2026-03-02', rates: { USD: '1.2600' } });
  const expiredMonth = rateTable({
    base: 'GBP',
    asOf: '2026-05-01',
    validUntil: '2026-05-31',
    rates: { USD: '1.2700' },
  });
  const tableHistory = rateHistory([annual, daily, expiredMonth]);

  it('an older period table still covers a day after newer tables are out of range', () => {
    const june = tableHistory.lookup('GBP', 'USD', { asOf: '2026-06-15' });
    expect(june.rate?.toString()).toBe('1.2500');
    expect(june.skipped).toEqual([]);
    // a daily table in the lookback wins over the period table: it is newer
    const march = tableHistory.lookup('GBP', 'USD', { asOf: '2026-03-04' });
    expect(march.rate?.toString()).toBe('1.2600');
    expect(march.skipped).toEqual([
      { day: '2026-03-04', reason: 'noTable' },
      { day: '2026-03-03', reason: 'noTable' },
    ]);
    // the daily table lacks JPY, so the year's table answers
    const yen = tableHistory.lookup('GBP', 'JPY', { asOf: '2026-03-02' });
    expect(yen.rate?.toString()).toBe('190.00');
    expect(yen.skipped).toEqual([{ day: '2026-03-02', reason: 'notQuoted' }]);
  });

  it("a table's own dates apply to ready-made Rate entries", () => {
    const table = rateTable({
      base: 'EUR',
      asOf: '2026-11-06',
      availableAt: '2026-11-06T15:00:00Z',
      validUntil: '2026-11-06',
      rates: { USD: exchangeRate('EUR', 'USD', '1.1165') },
    });
    expect(table.rate('EUR', 'USD', { asOf: '2026-11-06T09:00:00Z' })).toBeUndefined();
    expect(table.rate('EUR', 'USD', { asOf: '2026-11-06T16:00:00Z' })).toBeDefined();
    expect(table.rate('EUR', 'USD', { asOf: '2026-11-07' })).toBeUndefined();
    expect(table.rate('EUR', 'USD', { asOf: '2026-11-05' })).toBeUndefined();
    const fx = via('EUR', table);
    expect(fx.rate('USD', 'EUR', { asOf: '2026-11-06T09:00:00Z' })).toBeUndefined();
    // an entry must be base → its key
    expect(() =>
      rateTable({ base: 'GBP', rates: { USD: exchangeRate('GBP', 'JPY', '190') } }),
    ).toThrow(/GBP→USD/);
    expect(() =>
      rateTable({ base: 'GBP', rates: { USD: exchangeRate('EUR', 'USD', '1.1') } }),
    ).toThrow(TypeError);
  });

  it('reports the empty days before a daily table when a period table could not answer', () => {
    const unpublishedMonth = rateTable({
      base: 'GBP',
      asOf: '2026-06-15',
      validUntil: '2026-07-14',
      availableAt: '2026-06-15T12:00:00Z',
      rates: { USD: '1.2700' },
    });
    const dailyTable = rateTable({ base: 'GBP', asOf: '2026-06-13', rates: { USD: '1.2600' } });
    const found = rateHistory([unpublishedMonth, dailyTable], { lookback: 2 }).lookup(
      'GBP',
      'USD',
      {
        asOf: '2026-06-15T09:00:00Z',
      },
    );
    expect(found.rate?.asOf).toBe('2026-06-13');
    expect(found.skipped).toEqual([
      { day: '2026-06-15', reason: 'notYetAvailable' },
      { day: '2026-06-14', reason: 'noTable' },
    ]);
  });

  it('a table of ready-made Rates reports the reasons of its rates', () => {
    const table = rateTable({
      base: 'EUR',
      asOf: '2026-11-06',
      rates: {
        USD: exchangeRate('EUR', 'USD', '1.1165', {
          asOf: '2026-11-06',
          availableAt: '2026-11-06T15:00:00Z',
        }),
        JPY: exchangeRate('EUR', 'JPY', '176.77', {
          asOf: '2026-11-06',
          validUntil: '2026-11-06T12:00:00Z',
        }),
      },
    });
    const history = rateHistory([table], { lookback: 0 });
    expect(history.lookup('EUR', 'USD', { asOf: '2026-11-06T09:00:00Z' }).skipped).toEqual([
      { day: '2026-11-06', reason: 'notYetAvailable' },
    ]);
    expect(history.lookup('EUR', 'JPY', { asOf: '2026-11-06T13:00:00Z' }).skipped).toEqual([
      { day: '2026-11-06', reason: 'expired' },
    ]);
  });
});

describe('rateHistory: a date range in one call, with reasons', () => {
  const range: RateTable[] = [
    ecbDay('2026-11-02', { USD: '1.1000', ISK: '148.00' }),
    ecbDay('2026-11-03', { USD: '1.1010', ISK: '148.10' }),
    ecbDay('2026-11-04', { USD: '1.1020', ISK: null }),
    ecbDay('2026-11-05', { USD: '1.1030' }),
    ecbDay('2026-11-06', { USD: '1.1165', ISK: null }, '2026-11-06T15:00:00Z'),
  ];
  const history = rateHistory(range);

  it('takes the latest day at or before asOf and says why it fell back', () => {
    expect(history.tables.map((table) => table.asOf)).toEqual([
      '2026-11-06',
      '2026-11-05',
      '2026-11-04',
      '2026-11-03',
      '2026-11-02',
    ]);
    expect(history.rate('EUR', 'USD', { asOf: '2026-11-04' })?.asOf).toBe('2026-11-04');
    expect(history.lookup('EUR', 'USD', { asOf: '2026-11-08' })).toEqual({
      rate: range[4]!.rate('EUR', 'USD'),
      skipped: [
        { day: '2026-11-08', reason: 'noTable' },
        { day: '2026-11-07', reason: 'noTable' },
      ],
    });
    // each pair falls back on its own
    const isk = history.lookup('EUR', 'ISK', { asOf: '2026-11-06T16:00:00Z' });
    expect(isk.rate?.toString()).toBe('148.10');
    expect(isk.rate?.asOf).toBe('2026-11-03');
    expect(isk.skipped).toEqual([
      { day: '2026-11-06', reason: 'missing' },
      { day: '2026-11-05', reason: 'notQuoted' },
      { day: '2026-11-04', reason: 'missing' },
    ]);
    // before publication on the 6th, the 5th answers
    const early = history.lookup('EUR', 'USD', { asOf: '2026-11-06T09:00:00Z' });
    expect(early.rate?.asOf).toBe('2026-11-05');
    expect(early.skipped).toEqual([{ day: '2026-11-06', reason: 'notYetAvailable' }]);
    // no asOf: the newest table with the pair
    expect(history.rate('EUR', 'USD')?.asOf).toBe('2026-11-06');
    expect(history.rate('EUR', 'ISK')?.asOf).toBe('2026-11-03');
  });

  it('gives up after the lookback, and before the first table', () => {
    const short = rateHistory(range, { lookback: 1 });
    expect(short.lookup('EUR', 'USD', { asOf: '2026-11-09' })).toEqual({
      rate: undefined,
      skipped: [
        { day: '2026-11-09', reason: 'noTable' },
        { day: '2026-11-08', reason: 'noTable' },
      ],
    });
    expect(history.rate('EUR', 'USD', { asOf: '2026-11-01' })).toBeUndefined();
    expect(history.rate('EUR', 'GBP', { asOf: '2026-11-06' })).toBeUndefined();
    expect(rateHistory([]).lookup('EUR', 'USD')).toEqual({ rate: undefined, skipped: [] });
    expect(() => rateHistory([rateTable([exchangeRate('EUR', 'USD', '1')])])).toThrow(RangeError);
    expect(() => rateHistory(range, { lookback: -1 })).toThrow(RangeError);
  });

  it('works as a provider for conversion and triangulation', () => {
    const fx = via('EUR', history);
    const usd = money('110.30', 'USD');
    const eur = convert(usd, 'EUR', fx, 'halfEven', { asOf: '2026-11-05' });
    expect(eur.toDecimal()).toBe('100.00');
  });

  it('matches a brute-force search over daily and period tables (property)', () => {
    const start = '2026-01-01';
    const hour = (value: number) => `T${String(value).padStart(2, '0')}:00:00.000Z`;
    const table = fc.record({
      offset: fc.integer({ min: 0, max: 60 }),
      kind: fc.constantFrom('daily', 'daily', 'daily', 'period'),
      length: fc.integer({ min: 0, max: 30 }),
      // the period ends on a date (valid all day) or at an instant
      endsAt: fc.option(fc.integer({ min: 0, max: 23 })),
      // published on its day or the next, at an hour, or with no availableAt
      published: fc.option(
        fc.tuple(fc.integer({ min: 0, max: 1 }), fc.integer({ min: 0, max: 23 })),
      ),
      usd: fc.constantFrom('quoted', 'quoted', 'quoted', 'missing', 'absent'),
    });
    fc.assert(
      fc.property(
        fc.array(table, { maxLength: 15 }),
        fc.integer({ min: -2, max: 70 }),
        fc.option(fc.integer({ min: 0, max: 23 })),
        fc.integer({ min: 0, max: 6 }),
        (specs, queryOffset, queryHour, lookback) => {
          const built = specs.map((spec, i) => {
            const asOf = addDays(start, spec.offset);
            const rates: Record<string, string | null> = { JPY: '170.00' };
            if (spec.usd === 'quoted') {
              rates['USD'] = `1.${String(i).padStart(4, '0')}`;
            } else if (spec.usd === 'missing') {
              rates['USD'] = null;
            }
            let validUntil: string | undefined;
            if (spec.kind === 'period') {
              const lastDay = addDays(asOf, spec.length);
              validUntil = spec.endsAt === null ? lastDay : `${lastDay}${hour(spec.endsAt)}`;
            }
            let availableAt: string | undefined;
            if (spec.published !== null) {
              availableAt = `${addDays(asOf, spec.published[0])}${hour(spec.published[1])}`;
            }
            return {
              asOf,
              validUntil,
              availableAt,
              table: rateTable({
                base: 'EUR',
                asOf,
                ...(validUntil === undefined ? {} : { validUntil }),
                ...(availableAt === undefined ? {} : { availableAt }),
                rates,
              }),
            };
          });
          const queryDay = addDays(start, queryOffset);
          // a date asks for the whole day; an instant for that moment
          const query = queryHour === null ? queryDay : `${queryDay}${hour(queryHour)}`;
          const found = rateHistory(
            built.map((entry) => entry.table),
            { lookback },
          ).lookup('EUR', 'USD', { asOf: query });

          // brute force, written out without the library's date helpers
          const published = (availableAt: string | undefined) => {
            if (availableAt === undefined) {
              return true;
            }
            if (queryHour === null) {
              return availableAt.slice(0, 10) <= queryDay;
            }
            return availableAt <= query;
          };
          const stillValid = (validUntil: string | undefined) => {
            if (validUntil === undefined) {
              return true;
            }
            const instant = queryHour === null ? `${queryDay}T00:00:00.000Z` : query;
            if (validUntil.length === 10) {
              return instant.slice(0, 10) <= validUntil;
            }
            return instant <= validUntil;
          };
          const oldest = addDays(queryDay, -lookback);
          const candidates = built
            .map((entry, i) => ({ ...entry, i }))
            .filter((entry) => entry.asOf <= queryDay)
            .filter((entry) => stillValid(entry.validUntil))
            .filter((entry) => entry.asOf >= oldest || entry.validUntil !== undefined)
            .filter((entry) => published(entry.availableAt))
            .filter((entry) => entry.table.rate('EUR', 'USD') !== undefined)
            .sort((entry, other) => other.asOf.localeCompare(entry.asOf) || entry.i - other.i);
          expect(found.rate).toBe(candidates[0]?.table.rate('EUR', 'USD'));

          // the reasons: newest first, inside the window or a table's own day, never a day twice
          // for "noTable", and never older than the answer
          const days = found.skipped.map((fallback) => fallback.day);
          expect([...days].sort().reverse()).toEqual(days);
          const noTable = found.skipped.filter((fallback) => fallback.reason === 'noTable');
          expect(new Set(noTable.map((fallback) => fallback.day)).size).toBe(noTable.length);
          for (const fallback of noTable) {
            expect(fallback.day >= oldest && fallback.day <= queryDay).toBe(true);
            expect(built.some((entry) => entry.asOf === fallback.day)).toBe(false);
          }
          if (found.rate !== undefined) {
            expect(days.every((day) => day >= found.rate!.asOf!)).toBe(true);
          }
        },
      ),
    );
  });

  it('matches a day-by-day search (property)', () => {
    const start = '2026-01-01';
    const days = fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 20 });
    fc.assert(
      fc.property(
        days,
        fc.integer({ min: -2, max: 45 }),
        fc.integer({ min: 0, max: 6 }),
        (offsets, queryOffset, lookback) => {
          const tables = offsets.map((offset) =>
            ecbDay(addDays(start, offset), { USD: `1.${String(offset).padStart(4, '0')}` }),
          );
          const queryDay = addDays(start, queryOffset);
          const found = rateHistory(tables, { lookback }).lookup('EUR', 'USD', {
            asOf: queryDay,
          });

          // the oracle: walk back one day at a time
          let expected: string | undefined;
          const skipped: { day: string; reason: string }[] = [];
          for (let i = 0; i <= lookback; i++) {
            const day = addDays(queryDay, -i);
            if (offsets.some((offset) => addDays(start, offset) === day)) {
              expected = day;
              break;
            }
            skipped.push({ day, reason: 'noTable' });
          }
          expect(found.rate?.asOf).toBe(expected);
          expect(found.skipped).toEqual(skipped);
        },
      ),
    );
  });
});
