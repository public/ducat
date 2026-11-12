// Malformed-input and boundary tests for the ECB parsers in src/ecb.ts: every month name, dates
// that don't exist, byte-order marks, attribute and element forms, padded cells, the DECIMALS
// caps, optional SDMX columns, and the messages that name the problem.
import { describe, expect, it } from 'vitest';
import { parseEcbCsv, parseEcbSdmxCsv, parseEcbSdmxDecimals, parseEcbXml } from '../src/ecb.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const csv = (...rows: string[]) => ['Date, USD, JPY', ...rows].join('\n');
const xml = (body: string) => `<gesmes:Envelope><Cube>${body}</Cube></gesmes:Envelope>`;
const day = (cubes: string, attributes = "time='2026-11-06'") =>
  `<Cube ${attributes}>${cubes}</Cube>`;
const notEcb = new SyntaxError('Not an ECB reference rate file');

describe('dates in the CSV files', () => {
  it('reads every month name, in any case', () => {
    MONTHS.forEach((month, i) => {
      const [table] = parseEcbCsv(csv(`05 ${month} 2026, 1.1, 170`));
      expect(table!.asOf).toBe(`2026-${String(i + 1).padStart(2, '0')}-05`);
    });
    expect(parseEcbCsv(csv('5 NOVEMBER 2026, 1.1, 170'))[0]!.asOf).toBe('2026-11-05');
    expect(parseEcbCsv(csv('2026-11-05, 1.1, 170'))[0]!.asOf).toBe('2026-11-05');
  });

  it('rejects other forms and days that do not exist', () => {
    for (const date of [
      '5 Nov 2026',
      '5-November-2026',
      'x2026-11-05',
      '2026-11-05x',
      'Smarch 1 2026',
    ]) {
      expect(() => parseEcbCsv(csv(`${date}, 1.1, 170`))).toThrow(notEcb);
    }
    expect(() => parseEcbCsv(csv('5 Smarch 2026, 1.1, 170'))).toThrow(notEcb);
    for (const [date, iso] of [
      ['31 November 2026', '2026-11-31'],
      ['29 February 2026', '2026-2-29'],
      ['2026-13-01', '2026-13-1'],
      ['2026-00-10', '2026-0-10'],
    ] as const) {
      expect(() => parseEcbCsv(csv(`${date}, 1.1, 170`))).toThrow(
        new SyntaxError(`Not a calendar day: ${iso}`),
      );
    }
    expect(parseEcbCsv(csv('29 February 2028, 1.1, 170'))[0]!.asOf).toBe('2028-02-29');
  });
});

describe('the CSV layout', () => {
  it('needs the Date header, ignores blank lines and a byte-order mark', () => {
    expect(() => parseEcbCsv('Day, USD\n05 November 2026, 1.1')).toThrow(notEcb);
    const tables = parseEcbCsv(`﻿${csv('05 November 2026, 1.1, 170', '   ', '')}`);
    expect(tables.map((table) => table.asOf)).toEqual(['2026-11-05']);
  });

  it('a short row leaves its last currencies missing, a bad cell names itself', () => {
    const [table] = parseEcbCsv(csv('05 November 2026, 1.1'));
    expect(table!.missing).toEqual(['JPY']);
    expect(() => parseEcbCsv(csv('05 November 2026, 1.1, abc'))).toThrow(
      new SyntaxError('Not a rate: "abc" (JPY on 2026-11-05)'),
    );
  });
});

describe('the XML layout', () => {
  it('reads a byte-order mark, spacing, and inner cubes written open or self-closed', () => {
    const tables = parseEcbXml(
      `﻿${xml(
        day("<Cube currency='USD' rate='1.1'></Cube>", "  time='2026-11-06' ") +
          day('<Cube currency="JPY" rate="170"/>', 'time="2026-11-05"'),
      )}`,
    );
    expect(tables.map((table) => [table.asOf, table.rates.map(String)])).toEqual([
      ['2026-11-06', ['1.1']],
      ['2026-11-05', ['170']],
    ]);
  });

  it('skips an empty inner cube, rejects a malformed one', () => {
    expect(parseEcbXml(xml(day("<Cube/><Cube currency='USD' rate='1.1'/>")))[0]!.rates.length).toBe(
      1,
    );
    for (const cube of [
      "<Cube currency='USD'/>",
      "<Cube rate='1.1'/>",
      "<Cube currency='usd' rate='1.1'/>",
      "<Cube currency='USDX' rate='1.1'/>",
      "<Cube currency='XUSD' rate='1.1'/>",
      "<Cube currency='USD' rate='1.1.1'/>",
      "<Cube currency='USD' rate='x1.1'/>",
      "<Cube currency='USD' rate='1.1x'/>",
    ]) {
      expect(() => parseEcbXml(xml(day(cube)))).toThrow(
        new SyntaxError(`Malformed ECB rate entry ${cube.replace('/>', '>')}`),
      );
    }
    expect(() => parseEcbXml('<Envelope/>')).toThrow(notEcb);
  });
});

describe('ECB publication time', () => {
  it('is 16:00 in Frankfurt, summer and winter', () => {
    const tables = parseEcbXml(
      xml(
        day("<Cube currency='USD' rate='1.1'/>", "time='2026-07-01'") +
          day("<Cube currency='USD' rate='1.1'/>", "time='2026-01-05'"),
      ),
      { availableAt: true },
    );
    expect(tables.map((table) => table.availableAt)).toEqual([
      '2026-07-01T14:00:00.000Z',
      '2026-01-05T15:00:00.000Z',
    ]);
  });
});

const HEADER = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE';
const row = (currency: string, date: string, value: string, type = 'SP00') =>
  `EXR.D.${currency}.EUR.${type}.A,D,${currency},EUR,${type},A,${date},${value}`;

describe('SDMX-CSV', () => {
  it('pads to DECIMALS, capped for THB, and reads 0 to 30', () => {
    const header = `${HEADER},DECIMALS`;
    const tables = parseEcbSdmxCsv(
      [
        header,
        `${row('USD', '2026-11-06', '1.1')},4`,
        `${row('THB', '2026-11-06', '37.4')},4`,
        `${row('JPY', '2026-11-06', '170')},30`,
        `${row('THB', '2026-11-05', '37.4')},2`,
      ].join('\n'),
    );
    expect(tables[0]!.rates.map(String)).toEqual(['1.1000', '37.400', '170.' + '0'.repeat(30)]);
    expect(tables[1]!.rates.map(String)).toEqual(['37.40']);
    for (const decimals of ['31', '100', 'x1', '1x']) {
      expect(() =>
        parseEcbSdmxCsv(`${header}\n${row('USD', '2026-11-06', '1.1')},${decimals}`),
      ).toThrow(new SyntaxError(`Malformed DECIMALS ${JSON.stringify(decimals)} (USD)`));
    }
    // an empty DECIMALS cell leaves the caller's decimals in charge
    const [given] = parseEcbSdmxCsv(`${header}\n${row('USD', '2026-11-06', '1.1')},`, {
      decimals: { USD: 3 },
    });
    expect(given!.rates.map(String)).toEqual(['1.100']);
  });

  it('parseEcbSdmxDecimals trims its cells and caps THB', () => {
    expect(parseEcbSdmxDecimals('CURRENCY,DECIMALS\n USD , 4 \nTHB,4\nJPY,2')).toEqual({
      USD: 4,
      THB: 3,
      JPY: 2,
    });
  });

  it('trims cells and takes missing optional columns as the defaults', () => {
    const tables = parseEcbSdmxCsv(
      [
        'CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,UNIT_MULT',
        ' USD , EUR ,2026-11-06, 1.1 ,',
      ].join('\n'),
    );
    expect(tables[0]!.rates.map((rate) => `${rate.to} ${rate}`)).toEqual(['USD 1.1']);
    const spaced = parseEcbSdmxCsv(
      `${HEADER}\nEXR.D.USD.EUR.SP00.A, D ,USD,EUR, SP00 , A ,2026-11-06,1.1`,
    );
    expect(spaced[0]!.rates.map(String)).toEqual(['1.1']);
  });

  it('rejects other series, malformed rows and UNIT_MULT', () => {
    const other = `${row('USD', '2026-11-06', '1.1', 'SP01')}`;
    expect(() => parseEcbSdmxCsv(`${HEADER}\n${other}`)).toThrow(
      new SyntaxError(`Not a daily EUR reference rate: ${other}`),
    );
    for (const [currency, date] of [
      ['USDX', '2026-11-06'],
      ['XUSD', '2026-11-06'],
      ['usd', '2026-11-06'],
      ['USD', '2026-11-6'],
    ] as const) {
      const bad = row(currency, date, '1.1');
      expect(() => parseEcbSdmxCsv(`${HEADER}\n${bad}`)).toThrow(
        new SyntaxError(`Malformed ECB SDMX-CSV row: ${bad}`),
      );
    }
    expect(() =>
      parseEcbSdmxCsv(`${HEADER},UNIT_MULT\n${row('USD', '2026-11-06', '1.1')},2`),
    ).toThrow(new SyntaxError('Unsupported UNIT_MULT 2 (USD on 2026-11-06)'));
  });

  it('leaves out a day with no values, and names a missing file or column', () => {
    const tables = parseEcbSdmxCsv(
      [
        HEADER,
        row('USD', '2026-11-06', '1.1'),
        row('USD', '2026-11-05', 'NaN'),
        row('JPY', '2026-11-05', ''),
      ].join('\n'),
    );
    expect(tables.map((table) => table.asOf)).toEqual(['2026-11-06']);
    expect(() => parseEcbSdmxCsv('')).toThrow(
      new SyntaxError('Not an ECB SDMX-CSV file: it is empty'),
    );
    expect(() => parseEcbSdmxCsv('CURRENCY,TIME_PERIOD,OBS_VALUE\nUSD,2026-11-06,1.1')).toThrow(
      new SyntaxError('Not an ECB SDMX-CSV file: no CURRENCY_DENOM column'),
    );
  });
});
