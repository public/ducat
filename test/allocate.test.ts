import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocate, chunk, fromMinor, instalments, money, schedule, split, sum, toDecimal, equals, type Money, type Remainder } from '../src/index.js';

const eur = (s: string) => money(s, 'EUR');
const dec = (ms: Money[]) => ms.map(toDecimal);

describe('allocate', () => {
  it('real-world vectors', () => {
    expect(dec(allocate(eur('100'), [1, 1, 1]))).toEqual(['33.34', '33.33', '33.33']);
    expect(dec(allocate(eur('0.05'), [70, 30]))).toEqual(['0.04', '0.01']);
    expect(dec(allocate(eur('0.05'), ['0.7', '0.3']))).toEqual(['0.04', '0.01']);
    expect(dec(allocate(eur('1'), [1, 1, 1], { remainder: 'last' }))).toEqual(['0.33', '0.33', '0.34']);
    expect(dec(allocate(eur('0.10'), [1, 1, 1, 1, 1, 1, 1]))).toEqual(['0.02', '0.02', '0.02', '0.01', '0.01', '0.01', '0.01']);
    // largest remainder favours the bucket with the biggest fractional share, not the first
    expect(dec(allocate(eur('0.10'), [1, 2, 4]))).toEqual(['0.01', '0.03', '0.06']);
    expect(dec(allocate(eur('0.10'), [1, 2, 4], { remainder: 'first' }))).toEqual(['0.02', '0.03', '0.05']);
    expect(dec(allocate(eur('0.10'), [1, 2, 4], { remainder: 'toLast' }))).toEqual(['0.01', '0.02', '0.07']);
    expect(dec(allocate(eur('-100'), [1, 1, 1]))).toEqual(['-33.34', '-33.33', '-33.33']);
    expect(dec(allocate(money('100', 'JPY'), [1, 1, 1]))).toEqual(['34', '33', '33']);
  });
  it('zero weights receive nothing, even remainder', () => {
    expect(dec(allocate(eur('1'), [0, 1, 1], { remainder: 'first' }))).toEqual(['0.00', '0.50', '0.50']);
    expect(dec(allocate(eur('0.01'), [0, 1], { remainder: 'toFirst' }))).toEqual(['0.00', '0.01']);
    expect(() => allocate(eur('1'), [0, 0])).toThrow();
    expect(() => allocate(eur('1'), [-1, 2])).toThrow();
  });
  it('bigint amounts and weights', () => {
    const big = fromMinor(10n ** 30n + 1n, 'EUR');
    const parts = allocate(big, [1n, 2n]);
    expect(BigInt(parts[0]!.minor) + BigInt(parts[1]!.minor)).toBe(10n ** 30n + 1n);
  });
  it('property: parts always sum to the whole, each within one unit of its ideal share, deterministic', () => {
    const modes: Remainder[] = ['largest', 'first', 'last', 'toFirst', 'toLast'];
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -1e9, max: 1e9 }), fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n })),
        fc.array(fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 2 ** 40 })), { minLength: 1, maxLength: 12 }),
        fc.constantFrom(...modes),
        (amt, ws, mode) => {
          fc.pre(ws.some((w) => w > 0));
          const m = fromMinor(amt, 'EUR');
          const parts = allocate(m, ws, { remainder: mode });
          expect(parts.length).toBe(ws.length);
          expect(equals(sum(parts), m)).toBe(true);
          const W = ws.reduce((a, b) => a + BigInt(b), 0n);
          const x = BigInt(amt);
          parts.forEach((p, i) => {
            const ideal = x * BigInt(ws[i]!); // ideal share * W
            const diff = BigInt(p.minor) * W - ideal;
            if (ws[i] === 0) expect(p.minor == 0).toBe(true);
            if (mode !== 'toFirst' && mode !== 'toLast') expect((diff < 0n ? -diff : diff) < W).toBe(true);
          });
          expect(dec(allocate(m, ws, { remainder: mode }))).toEqual(dec(parts));
        },
      ),
      { numRuns: 3000 },
    );
  });
  it('property: largest remainder never gives a unit to a smaller fraction before a larger one', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e6 }), fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 8 }), (amt, ws) => {
      const parts = allocate(fromMinor(amt, 'EUR'), ws);
      const W = ws.reduce((a, b) => a + b, 0);
      const fr = ws.map((w) => (amt * w) % W);
      const got = parts.map((p, i) => (p.minor as number) - Math.floor((amt * ws[i]!) / W));
      for (let i = 0; i < ws.length; i++) for (let j = 0; j < ws.length; j++)
        if (got[i] === 1 && got[j] === 0) expect(fr[i]! > fr[j]! || (fr[i] === fr[j] && i < j)).toBe(true);
    }));
  });
});

describe('split / instalments / schedule / chunk', () => {
  it('split', () => {
    expect(dec(split(eur('10'), 3))).toEqual(['3.34', '3.33', '3.33']);
    expect(dec(split(eur('10'), 3, { remainder: 'last' }))).toEqual(['3.33', '3.33', '3.34']);
  });
  it('instalments: one instalment absorbs the remainder', () => {
    expect(dec(instalments(eur('100'), 6))).toEqual(['16.70', '16.66', '16.66', '16.66', '16.66', '16.66']);
    expect(dec(instalments(eur('100'), 6, { remainder: 'toLast' }))).toEqual(['16.66', '16.66', '16.66', '16.66', '16.66', '16.70']);
    expect(dec(instalments(eur('100'), 3, { unit: eur('1') }))).toEqual(['34.00', '33.00', '33.00']);
    expect(dec(instalments(eur('100.50'), 3, { unit: eur('1') }))).toEqual(['34.50', '33.00', '33.00']);
    expect(dec(instalments(eur('1000'), 7, { unit: eur('10'), remainder: 'first' }))).toEqual(['150.00', '150.00', '140.00', '140.00', '140.00', '140.00', '140.00']);
    expect(dec(instalments(eur('-100'), 3))).toEqual(['-33.34', '-33.33', '-33.33']);
  });
  it('property: instalments sum to the total and regular ones are equal multiples of unit', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e10 }), fc.integer({ min: 1, max: 48 }), fc.integer({ min: 1, max: 10000 }), fc.constantFrom('toFirst', 'toLast', 'first', 'last' as const), (amt, n, unit, mode) => {
      const parts = instalments(fromMinor(amt, 'EUR'), n, { unit: fromMinor(unit, 'EUR'), remainder: mode });
      expect(BigInt(sum(parts).minor)).toBe(BigInt(amt));
      if (mode === 'toFirst') parts.slice(1).forEach((p) => { expect(p.minor).toBe(parts[1]!.minor); expect((p.minor as number) % unit).toBe(0); });
    }));
  });
  it('schedule: deposit + fixed + rest, caps', () => {
    expect(dec(schedule(eur('1000'), [{ percent: 30 }, { amount: eur('200') }, { rest: true }]))).toEqual(['300.00', '200.00', '500.00']);
    expect(dec(schedule(eur('100'), [{ percent: '33.3' }, { percent: '33.3' }, { percent: '33.4' }]))).toEqual(['33.30', '33.30', '33.40']);
    expect(dec(schedule(eur('100'), [{ percent: 50, cap: eur('20') }, { rest: true }]))).toEqual(['20.00', '80.00']);
    expect(dec(schedule(eur('0.01'), [{ percent: 50 }, { percent: 50 }]))).toEqual(['0.01', '0.00']);
    expect(() => schedule(eur('100'), [{ percent: 50 }])).toThrow(/unassigned/);
    expect(() => schedule(eur('100'), [{ amount: eur('150') }, { rest: true }])).toThrow(/exceed/);
    expect(() => schedule(eur('100'), [{ percent: 60 }, { percent: 50 }])).toThrow(/exceed 100/);
  });
  it('chunk', () => {
    expect(dec(chunk(eur('1000'), eur('300')))).toEqual(['300.00', '300.00', '300.00', '100.00']);
    expect(dec(chunk(eur('600'), eur('300')))).toEqual(['300.00', '300.00']);
    expect(dec(chunk(eur('0'), eur('300')))).toEqual(['0.00']);
  });
});
