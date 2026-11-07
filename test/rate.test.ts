import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromMinor, money, ratio, type Money, type RoundingMode } from '../src/index.js';
import { divRoundBig } from '../src/rounding.js';
import { exchangeRate, isRate, mulRatioShift, rateFromJSON, type Rate } from '../src/rate.js';

const d = (m: Money) => m.toDecimal();
const MODES: RoundingMode[] = [
  'halfEven',
  'halfExpand',
  'halfTrunc',
  'halfCeil',
  'halfFloor',
  'expand',
  'trunc',
  'ceil',
  'floor',
];
const mode = fc.constantFrom(...MODES);
const minor = fc.oneof(
  fc.integer({ min: -1e9, max: 1e9 }),
  fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
  fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
);
// decimal-string rates as quoted: 1-9 significant digits, 0-8 decimals (ECB: 4-7 significant, 2-5 decimals)
const rateStr = fc
  .tuple(fc.bigInt({ min: 1n, max: 999_999_999n }), fc.integer({ min: 0, max: 8 }))
  .map(([digits, scale]) => {
    const s = digits.toString().padStart(scale + 1, '0');
    return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  });

/** the oracle: minor × Πrates × 10^shift, one bigint division */
function oracle(m: number | bigint, rates: Rate[], shift: number, rounding: RoundingMode): bigint {
  let num = BigInt(m),
    den = 1n;
  for (const r of rates) {
    num *= r.ratio.num;
    den *= r.ratio.den;
  }
  if (shift > 0) num *= 10n ** BigInt(shift);
  else den *= 10n ** BigInt(-shift);
  return divRoundBig(num, den, rounding);
}

describe('Rate', () => {
  it('converts with one rounding and checks the pair', () => {
    const eurUsd = exchangeRate('EUR', 'USD', '1.1165', { source: 'ECB', asOf: '2026-11-06', type: 'mid' });
    expect(d(eurUsd.convert(money('100', 'EUR'), 'halfEven'))).toBe('111.65');
    expect(d(eurUsd.convert(money('0.01', 'EUR'), 'halfEven'))).toBe('0.01');
    expect(d(exchangeRate('EUR', 'JPY', '162.457').convert(money('100', 'EUR'), 'halfEven'))).toBe('16246');
    expect(d(exchangeRate('JPY', 'KWD', '0.002034').convert(money('1000', 'JPY'), 'halfEven'))).toBe('2.034');
    expect(d(eurUsd.convert(money('1', 'EUR'), 'halfEven', { scale: 4 }))).toBe('1.1165');
    expect(() => eurUsd.convert(money('1', 'GBP') as never)).toThrow(/currency/i);
    expect(() => exchangeRate('EUR', 'USD', '0')).toThrow(RangeError);
    expect(() => exchangeRate('EUR', 'USD', '-1.2')).toThrow(RangeError);
    expect(() => eurUsd.convert(money('1', 'EUR'), 'unnecessary')).toThrow();
  });

  it('keeps every digit of a decimal-string rate, trailing zeros included', () => {
    expect(exchangeRate('EUR', 'HUF', '363.90').toString()).toBe('363.9');
    expect(exchangeRate('EUR', 'IDR', '20208.93').ratio).toMatchObject({ num: 2020893n, den: 100n });
    expect(exchangeRate('EUR', 'USD', 1.234).ratio).toMatchObject({ num: 617n, den: 500n }); // 1234/1000 reduced
    expect(exchangeRate('EUR', 'USD', '1.12345678901234567890').toString()).toBe('1.1234567890123456789');
  });

  it('inverts exactly, swapping bid and ask', () => {
    const eurUsd = exchangeRate('EUR', 'USD', '1.1165', { source: 'ECB', asOf: '2026-11-06', type: 'bid' });
    const inv = eurUsd.inverse();
    expect([inv.from, inv.to]).toEqual(['USD', 'EUR']);
    expect(inv.ratio).toMatchObject({ num: 2000n, den: 2233n });
    expect(inv.toString()).toBe('2000/2233');
    expect(inv.toDecimal(6)).toBe('0.895656');
    expect(inv.type).toBe('ask');
    expect(inv.inverse().type).toBe('bid');
    expect(inv.source).toBeUndefined();
    expect(inv.asOf).toBe('2026-11-06');
    expect(inv.derivedFrom).toEqual([eurUsd]);
    expect(exchangeRate('A', 'B', '2', { type: 'mid' }).inverse().type).toBe('mid');
  });

  it('composes exactly, with the oldest asOf and the earliest validUntil', () => {
    const eurUsd = exchangeRate('EUR', 'USD', '1.1165', { asOf: '2026-11-06', validUntil: '2026-11-09', type: 'mid' });
    const usdJpy = exchangeRate('USD', 'JPY', '158.33', { asOf: '2026-11-07T10:00:00Z', type: 'mid' });
    const eurJpy = eurUsd.andThen(usdJpy);
    expect([eurJpy.from, eurJpy.to]).toEqual(['EUR', 'JPY']);
    expect(eurJpy.toString()).toBe('176.775445');
    expect(eurJpy.asOf).toBe('2026-11-06');
    expect(eurJpy.validUntil).toBe('2026-11-09');
    expect(eurJpy.type).toBe('mid');
    expect(eurJpy.derivedFrom).toEqual([eurUsd, usdJpy]);
    expect(eurUsd.andThen(exchangeRate('USD', 'JPY', '158', { type: 'ask' })).type).toBeUndefined();
    expect(() => eurUsd.andThen(exchangeRate('GBP', 'JPY', '190') as never)).toThrow(/currency/i);
  });

  it('rounds once along a chain; hop-by-hop rounding can be off by a minor unit', () => {
    const two = exchangeRate('EUR', 'USD', '1.5');
    const three = exchangeRate('USD', 'GBP', '1.5');
    const one = money('0.01', 'EUR');
    expect(d(two.andThen(three).convert(one, 'halfExpand'))).toBe('0.02'); // 0.0225 -> 0.02
    expect(d(three.convert(two.convert(one, 'halfExpand'), 'halfExpand'))).toBe('0.03'); // 0.015 -> 0.02 -> 0.03
  });

  it('applies a margin exactly and rounds a rate only on request', () => {
    const r = exchangeRate('EUR', 'USD', '1.1165', { asOf: '2026-11-06', type: 'mid' });
    const marked = r.withMargin('-0.02');
    expect(marked.toString()).toBe('1.09417');
    expect(marked.type).toBeUndefined();
    expect(marked.asOf).toBe('2026-11-06');
    expect(marked.derivedFrom).toEqual([r]);
    expect(() => r.withMargin('-1')).toThrow(RangeError);
    const rounded = r.inverse().round(4);
    expect(rounded.toString()).toBe('0.8957');
    expect(rounded.derivedFrom?.[0]?.toString()).toBe('2000/2233');
    expect(r.inverse().toDecimal(4, 'floor')).toBe('0.8956');
  });

  it('normalises Date metadata to ISO strings', () => {
    const r = exchangeRate('EUR', 'USD', '1.1', { asOf: new Date(Date.UTC(2026, 10, 6, 15)) });
    expect(r.asOf).toBe('2026-11-06T15:00:00.000Z');
    expect('validUntil' in r).toBe(false);
  });

  it('round-trips through JSON with its audit chain', () => {
    const eurUsd = exchangeRate('EUR', 'USD', '1.1165', { source: 'ECB', asOf: '2026-11-06', type: 'mid' });
    const eurJpy = exchangeRate('EUR', 'JPY', '176.77', { source: 'ECB', asOf: '2026-11-06', type: 'mid' });
    const usdJpy = eurUsd.inverse().andThen(eurJpy);
    const j = JSON.parse(JSON.stringify(usdJpy));
    expect(j).toMatchObject({ from: 'USD', to: 'JPY', rate: '32140/203', asOf: '2026-11-06', type: 'mid' });
    expect(j.derivedFrom[0].derivedFrom[0]).toEqual({
      from: 'EUR',
      to: 'USD',
      rate: '1.1165',
      source: 'ECB',
      asOf: '2026-11-06',
      type: 'mid',
    });
    const back = rateFromJSON(j);
    expect(isRate(back)).toBe(true);
    expect(back.ratio).toEqual(usdJpy.ratio);
    expect(back.toJSON()).toEqual(usdJpy.toJSON());
  });

  it('is not a thenable, so it can be awaited and returned from async functions', async () => {
    const r = exchangeRate('EUR', 'USD', '1.1');
    expect(await Promise.resolve(r)).toBe(r);
  });
});

describe('Rate properties', () => {
  it('mulRatioShift equals one exact bigint division on every path', () => {
    fc.assert(
      fc.property(minor, rateStr, fc.integer({ min: -18, max: 18 }), mode, (m, s, shift, rm) => {
        const r = exchangeRate('A', 'B', s);
        expect(BigInt(mulRatioShift(m, r.ratio, shift, rm))).toBe(oracle(m, [r], shift, rm));
      }),
      { numRuns: 2000 },
    );
  });

  it('results are numbers whenever they are safe', () => {
    fc.assert(
      fc.property(minor, rateStr, fc.integer({ min: -4, max: 4 }), mode, (m, s, shift, rm) => {
        const v = mulRatioShift(m, ratio(s), shift, rm);
        expect(typeof v === 'number').toBe(Number.isSafeInteger(Number(v)) && BigInt(Number(v)) === BigInt(v));
      }),
    );
  });

  it('round-once: converting with a composed rate is one rounding of the exact product', () => {
    fc.assert(
      fc.property(minor, fc.array(rateStr, { minLength: 1, maxLength: 4 }), mode, (m, ss, rm) => {
        const legs = ss.map((s, i) => exchangeRate(`C${i}`, `C${i + 1}`, s));
        const chain = legs.reduce((a, b) => a.andThen(b as never));
        const src = fromMinor(m, chain.from, 2);
        const got = chain.convert(src as never, rm, { scale: 3 });
        expect(got.toMinor()).toBe(oracle(m, legs, 1, rm));
      }),
    );
  });

  it('inverse is exact: inverse twice is the identity, and a round trip is within half a unit', () => {
    fc.assert(
      fc.property(rateStr, minor, (s, m) => {
        const r = exchangeRate('EUR', 'USD', s);
        expect(r.inverse().inverse().ratio).toEqual(r.ratio);
        expect(r.andThen(r.inverse()).ratio).toMatchObject({ num: 1n, den: 1n });
        // round trip at a scale fine enough that the first rounding is below half a unit of m
        const src = fromMinor(m, 'EUR', 2);
        const fine = r.convert(src, 'halfEven', { scale: 40 });
        expect(r.inverse().convert(fine, 'halfEven', { scale: 2 }).toMinor()).toBe(BigInt(m));
      }),
    );
  });

  it('triangulation through a consistent base equals the direct rate', () => {
    fc.assert(
      fc.property(rateStr, rateStr, minor, mode, (a, b, m, rm) => {
        const eurUsd = exchangeRate('EUR', 'USD', a);
        const eurJpy = exchangeRate('EUR', 'JPY', b);
        const viaEur = eurUsd.inverse().andThen(eurJpy);
        const direct = exchangeRate('USD', 'JPY', ratio(b, a));
        expect(viaEur.ratio).toEqual(direct.ratio);
        const usd = fromMinor(m, 'USD');
        expect(viaEur.convert(usd, rm).toMinor()).toBe(direct.convert(usd, rm).toMinor());
      }),
    );
  });
});
