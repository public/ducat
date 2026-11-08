import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert.js';
import { parseFedH10Csv } from '../src/fed.js';
import { money } from '../src/fn.js';
import { rateHistory } from '../src/history.js';
import { via } from '../src/provider.js';
import { exchangeRate } from '../src/rate.js';

// Downloaded from federalreserve.gov/datadownload on 2026-11-08: H.10, all 23 currencies,
// 20 December 2025 to 6 January 2026, CSV, series in columns, with labels.
const h10 = readFileSync(new URL('fixtures/fed/h10-daily.csv', import.meta.url), 'utf8');

const HEADER = [
  '"Series Description","Euro","Japanese Yen"',
  '"Unit:","Currency","Currency"',
  '"Multiplier:","1","1"',
  '"Currency:","EUR","JPY"',
  '"Unique Identifier: ","H10/H10/RXI$US_N.B.EU","H10/H10/RXI_N.B.JA"',
  '"Time Period","RXI$US_N.B.EU","RXI_N.B.JA"',
].join('\n');

describe('parseFedH10Csv', () => {
  it('one USD table per day, newest first, holidays left out', () => {
    const tables = parseFedH10Csv(h10);
    expect(tables.map((table) => table.asOf)).toEqual([
      '2026-01-06',
      '2026-01-05',
      '2026-01-02',
      '2025-12-31',
      '2025-12-30',
      '2025-12-29',
      '2025-12-26',
      '2025-12-24',
      '2025-12-23',
      '2025-12-22',
    ]);
    const [latest] = tables;
    expect(latest!.rates).toHaveLength(23);
    expect(latest!.rate('USD', 'JPY')).toMatchObject({
      source: 'FRB',
      type: 'noon buying',
      asOf: '2026-01-06',
    });
  });

  it('inverts the four USD-per-unit currencies exactly, keeping the published quote', () => {
    const oldest = parseFedH10Csv(h10).at(-1)!;
    for (const [currency, published] of [
      ['EUR', '1.1750'],
      ['GBP', '1.3457'],
      ['AUD', '0.6657'],
      ['NZD', '0.5798'],
    ] as const) {
      const usdTo = oldest.rate('USD', currency)!;
      expect(usdTo.quote).toEqual({ rate: published, inverted: true });
      expect(usdTo.inverse().toString()).toBe(published);
      expect(usdTo.inverse().ratio).toEqual(exchangeRate(currency, 'USD', published).ratio);
    }
    expect(oldest.rate('USD', 'EUR')!.toString()).toBe('40/47'); // 1 / 1.1750, exactly
    // the others are currency per USD, as published, trailing zeros kept
    expect(oldest.rate('USD', 'JPY')!.toString()).toBe('156.9300');
    expect(oldest.rate('USD', 'JPY')!.quote).toEqual({ rate: '156.9300' });
    expect(oldest.rate('USD', 'VEB')!.toString()).toBe('284.6889');
  });

  it('converts through USD and falls back over the ND holidays', () => {
    const history = rateHistory(parseFedH10Csv(h10));
    const christmas = history.lookup('USD', 'JPY', { asOf: '2025-12-25' });
    expect(christmas.rate?.asOf).toBe('2025-12-24');
    expect(christmas.skipped).toEqual([{ day: '2025-12-25', reason: 'noTable' }]);
    // 117.50 USD is 100 EUR at 1.1750, then 15693 JPY at 156.93
    const fx = via('USD', history);
    const yen = convert(money('100.00', 'EUR'), 'JPY', fx, 'halfEven', { asOf: '2025-12-22' });
    expect(yen.toDecimal()).toBe('18439');
  });

  it('a single ND is a missing value; malformed files throw', () => {
    const [table] = parseFedH10Csv(`${HEADER}\n2026-11-06,1.1650,ND\n`);
    expect(table!.missing).toEqual(['JPY']);
    expect(parseFedH10Csv(`${HEADER}\n2026-11-05,ND,ND\n`)).toEqual([]);
    expect(() => parseFedH10Csv('<html>')).toThrow(SyntaxError);
    expect(() => parseFedH10Csv(HEADER.replace('"Currency:","EUR","JPY"\n', ''))).toThrow(
      /Currency/,
    );
    expect(() => parseFedH10Csv(HEADER.replace('"RXI_N.B.JA"', '"XYZ"'))).toThrow(SyntaxError);
    expect(() =>
      parseFedH10Csv(HEADER.replace('"Multiplier:","1","1"', '"Multiplier:","1","100"')),
    ).toThrow(/multiplier 100 for JPY/);
    expect(() => parseFedH10Csv(`${HEADER}\n11/06/2026,1.1650,150.0000\n`)).toThrow(SyntaxError);
    expect(() => parseFedH10Csv(`${HEADER}\n2026-11-06,1.1650\n`)).toThrow(SyntaxError);
    expect(() => parseFedH10Csv(`${HEADER}\n2026-11-06,1.1650,n/q\n`)).toThrow(/JPY on 2026-11-06/);
  });

  it('every published rate survives exactly, both directions (property)', () => {
    const published = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 10n }), fc.integer({ min: 0, max: 6 }))
      .map(([digits, scale]) => {
        const text = digits.toString().padStart(scale + 1, '0');
        return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`;
      });
    fc.assert(
      fc.property(published, published, (euro, yen) => {
        const [table] = parseFedH10Csv(`${HEADER}\n2026-11-06,${euro},${yen}\n`);
        expect(table!.rate('USD', 'EUR')!.inverse().toString()).toBe(euro);
        expect(table!.rate('USD', 'JPY')!.toString()).toBe(yen);
        expect(table!.rate('USD', 'EUR')!.inverse().inverse().ratio).toEqual(
          table!.rate('USD', 'EUR')!.ratio,
        );
      }),
    );
  });
});
