// availableAt for the ECB parsers: opt-in, the ECB's documented 16:00 CET (Frankfurt time) or the
// caller's own, so historical lookups can't use a rate before it was published.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEcbCsv, parseEcbSdmxCsv, parseEcbXml } from '../src/ecb.js';
import { fetchEcb, fetchEcbRange, type Fetch } from '../src/fetch.js';
import { rateHistory } from '../src/history.js';

const fixture = (path: string) =>
  readFileSync(new URL(`fixtures/${path}`, import.meta.url), 'utf8');
const day = (time: string) => `<Cube time='${time}'><Cube currency='USD' rate='1.1000'/></Cube>`;
const envelope = (...days: string[]) =>
  `<gesmes:Envelope><Cube>${days.map(day).join('')}</Cube></gesmes:Envelope>`;

describe('ECB availableAt', () => {
  it('is not set by default', () => {
    const [table] = parseEcbXml(fixture('ecb/eurofxref-daily.xml'));
    expect(table!.availableAt).toBeUndefined();
    expect(table!.rate('EUR', 'USD')!.availableAt).toBeUndefined();
    expect(
      parseEcbXml(fixture('ecb/eurofxref-daily.xml'), { availableAt: false })[0]!.availableAt,
    ).toBeUndefined();
  });

  it('true gives 16:00 Frankfurt time: 15:00 UTC in winter, 14:00 UTC in summer', () => {
    const [table] = parseEcbXml(fixture('ecb/eurofxref-daily.xml'), { availableAt: true });
    expect(table!.availableAt).toBe('2026-11-06T15:00:00.000Z');
    expect(table!.rate('EUR', 'USD')!.availableAt).toBe('2026-11-06T15:00:00.000Z');
    // summer time starts on 29 March 2026 and ends on 25 October 2026
    const tables = parseEcbXml(
      envelope('2026-03-27', '2026-03-30', '2026-07-06', '2026-10-23', '2026-10-26'),
      { availableAt: true },
    );
    expect(tables.map((each) => [each.asOf, each.availableAt])).toEqual([
      ['2026-10-26', '2026-10-26T15:00:00.000Z'],
      ['2026-10-23', '2026-10-23T14:00:00.000Z'],
      ['2026-07-06', '2026-07-06T14:00:00.000Z'],
      ['2026-03-30', '2026-03-30T14:00:00.000Z'],
      ['2026-03-27', '2026-03-27T15:00:00.000Z'],
    ]);
  });

  it('a function gives the caller its own time, from the day', () => {
    const [table] = parseEcbXml(fixture('ecb/eurofxref-daily.xml'), {
      availableAt: (asOf) => `${asOf}T16:30:00Z`,
    });
    expect(table!.availableAt).toBe('2026-11-06T16:30:00.000Z');
  });

  it('a lookup before publication falls back to the day before', () => {
    const tables = parseEcbXml(fixture('ecb/eurofxref-hist-2d.xml'), { availableAt: true });
    const history = rateHistory(tables);
    const morning = history.lookup('EUR', 'USD', { asOf: '2026-11-06T10:00:00Z' });
    expect(morning.rate?.asOf).toBe('2026-11-05');
    expect(morning.skipped[0]?.reason).toBe('notYetAvailable');
    const evening = history.lookup('EUR', 'USD', { asOf: '2026-11-06T15:00:00Z' });
    expect(evening.rate?.asOf).toBe('2026-11-06');
    // without availableAt, the morning query gets the day's rate, published hours later
    const unaware = rateHistory(parseEcbXml(fixture('ecb/eurofxref-hist-2d.xml')));
    expect(unaware.lookup('EUR', 'USD', { asOf: '2026-11-06T10:00:00Z' }).rate?.asOf).toBe(
      '2026-11-06',
    );
  });

  it('the CSV and SDMX-CSV parsers take it too', () => {
    const [csv] = parseEcbCsv(fixture('ecb/eurofxref.csv'), { availableAt: true });
    expect(csv!.availableAt).toBe('2026-11-06T15:00:00.000Z');
    const sdmx = parseEcbSdmxCsv(fixture('ecb-sdmx/exr-d-full.csv'), { availableAt: true });
    for (const table of sdmx) {
      expect(table.availableAt?.slice(0, 10)).toBe(table.asOf);
      expect(table.availableAt?.slice(10)).toMatch(/^T1[45]:00:00\.000Z$/);
    }
    expect(parseEcbSdmxCsv(fixture('ecb-sdmx/exr-d-full.csv'))[0]!.availableAt).toBeUndefined();
  });

  it('fetchEcb and fetchEcbRange pass it to the parser', async () => {
    const answer = (bodies: string[]): Fetch => {
      let calls = 0;
      return async () => ({ ok: true, status: 200, text: async () => bodies[calls++]! });
    };
    const [latest] = await fetchEcb({
      fetch: answer([fixture('ecb/eurofxref-daily.xml')]),
      availableAt: true,
    });
    expect(latest!.availableAt).toBe('2026-11-06T15:00:00.000Z');
    const range = await fetchEcbRange({
      start: '2026-01-01',
      fetch: answer([fixture('ecb-sdmx/exr-d-nodata.csv'), fixture('ecb-sdmx/exr-d-dataonly.csv')]),
      availableAt: (asOf) => `${asOf}T18:00:00Z`,
    });
    expect(range.length).toBeGreaterThan(0);
    expect(range.every((table) => table.availableAt === `${table.asOf}T18:00:00.000Z`)).toBe(true);
  });

  it.each([
    ['a string', 'true', 'string'],
    ['a Date', new Date('2026-01-01'), 'object'],
    ['a number', 1, 'number'],
    ['null', null, 'object'],
  ])('rejects %s, even on a file with no days', (_name, value, kind) => {
    const message = `availableAt must be a boolean or a function, got ${kind}`;
    const options = { availableAt: value as never };
    expect(() => parseEcbXml(fixture('ecb/eurofxref-daily.xml'), options)).toThrow(TypeError);
    expect(() => parseEcbXml(envelope(), options)).toThrow(message);
    expect(() => parseEcbCsv(fixture('ecb/eurofxref.csv'), options)).toThrow(message);
    expect(() => parseEcbSdmxCsv('', options)).toThrow(message);
  });

  it('fetchEcb and fetchEcbRange reject it before making a request', async () => {
    let requests = 0;
    const counting: Fetch = async () => {
      requests++;
      return { ok: true, status: 200, text: async () => '' };
    };
    const availableAt = 'yes' as never;
    await expect(fetchEcb({ fetch: counting, availableAt })).rejects.toThrow(TypeError);
    await expect(
      fetchEcbRange({ start: '2026-01-01', fetch: counting, availableAt }),
    ).rejects.toThrow('availableAt must be a boolean or a function, got string');
    expect(requests).toBe(0);
  });
});
