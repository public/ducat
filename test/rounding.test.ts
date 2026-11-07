import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { money, round, Rounding, RoundingError, toDecimal, type RoundingMode } from '../src/index.js';
import { divRound, divRoundBig } from '../src/rounding.js';
import { MODES, refDivRound } from './oracle.js';

// The table from java.math.RoundingMode's documentation (UP=expand, DOWN=trunc, HALF_UP=halfExpand ...).
const TABLE: Array<[string, Record<string, string>]> = [
  [
    '5.5',
    {
      expand: '6',
      trunc: '5',
      ceil: '6',
      floor: '5',
      halfExpand: '6',
      halfTrunc: '5',
      halfEven: '6',
      halfCeil: '6',
      halfFloor: '5',
    },
  ],
  [
    '2.5',
    {
      expand: '3',
      trunc: '2',
      ceil: '3',
      floor: '2',
      halfExpand: '3',
      halfTrunc: '2',
      halfEven: '2',
      halfCeil: '3',
      halfFloor: '2',
    },
  ],
  [
    '1.6',
    {
      expand: '2',
      trunc: '1',
      ceil: '2',
      floor: '1',
      halfExpand: '2',
      halfTrunc: '2',
      halfEven: '2',
      halfCeil: '2',
      halfFloor: '2',
    },
  ],
  [
    '1.1',
    {
      expand: '2',
      trunc: '1',
      ceil: '2',
      floor: '1',
      halfExpand: '1',
      halfTrunc: '1',
      halfEven: '1',
      halfCeil: '1',
      halfFloor: '1',
    },
  ],
  [
    '1.0',
    {
      expand: '1',
      trunc: '1',
      ceil: '1',
      floor: '1',
      halfExpand: '1',
      halfTrunc: '1',
      halfEven: '1',
      halfCeil: '1',
      halfFloor: '1',
    },
  ],
  [
    '-1.0',
    {
      expand: '-1',
      trunc: '-1',
      ceil: '-1',
      floor: '-1',
      halfExpand: '-1',
      halfTrunc: '-1',
      halfEven: '-1',
      halfCeil: '-1',
      halfFloor: '-1',
    },
  ],
  [
    '-1.1',
    {
      expand: '-2',
      trunc: '-1',
      ceil: '-1',
      floor: '-2',
      halfExpand: '-1',
      halfTrunc: '-1',
      halfEven: '-1',
      halfCeil: '-1',
      halfFloor: '-1',
    },
  ],
  [
    '-1.6',
    {
      expand: '-2',
      trunc: '-1',
      ceil: '-1',
      floor: '-2',
      halfExpand: '-2',
      halfTrunc: '-2',
      halfEven: '-2',
      halfCeil: '-2',
      halfFloor: '-2',
    },
  ],
  [
    '-2.5',
    {
      expand: '-3',
      trunc: '-2',
      ceil: '-2',
      floor: '-3',
      halfExpand: '-3',
      halfTrunc: '-2',
      halfEven: '-2',
      halfCeil: '-2',
      halfFloor: '-3',
    },
  ],
  [
    '-5.5',
    {
      expand: '-6',
      trunc: '-5',
      ceil: '-5',
      floor: '-6',
      halfExpand: '-6',
      halfTrunc: '-5',
      halfEven: '-6',
      halfCeil: '-5',
      halfFloor: '-6',
    },
  ],
];

describe('rounding modes (java.math.RoundingMode table)', () => {
  for (const [input, expected] of TABLE) {
    for (const [mode, out] of Object.entries(expected)) {
      it(`${input} ${mode} -> ${out}`, () => {
        const m = money(input, 'JPY', { scale: 1 });
        expect(toDecimal(round(m, mode as RoundingMode))).toBe(out);
      });
    }
  }
  it('unnecessary throws only when inexact', () => {
    expect(toDecimal(round(money('1.0', 'JPY', { scale: 1 }), 'unnecessary'))).toBe('1');
    expect(() => round(money('1.1', 'JPY', { scale: 1 }), 'unnecessary')).toThrow(RoundingError);
  });
  it('named aliases map to Intl strings', () => {
    expect(Rounding.HalfUp).toBe('halfExpand');
    expect(Rounding.Bankers).toBe('halfEven');
    expect(Rounding.Down).toBe('trunc');
  });
  it('0.125 EUR at 3dp: halfEven 0.12, halfExpand 0.13', () => {
    const m = money('0.125', 'EUR', { scale: 3 });
    expect(toDecimal(round(m, 'halfEven'))).toBe('0.12');
    expect(toDecimal(round(m, 'halfExpand'))).toBe('0.13');
    expect(toDecimal(round(money('0.135', 'EUR', { scale: 3 }), 'halfEven'))).toBe('0.14');
  });
});

describe('divRound agrees with an independent bigint oracle', () => {
  const safe = fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
  const small = fc.integer({ min: -1_000_000, max: 1_000_000 });
  const div = fc.oneof(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }));
  const mode = fc.constantFrom(...MODES);
  it('number path, full safe range (float quotient fix-up)', () => {
    fc.assert(
      fc.property(fc.oneof(safe, small), div, mode, (p, d, m) => {
        expect(divRound(p, d, m)).toBe(Number(refDivRound(BigInt(p), BigInt(d), m)));
      }),
      { numRuns: 20000 },
    );
  });
  it('bigint path', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }),
        fc.bigInt({ min: 1n, max: 10n ** 20n }),
        mode,
        (p, d, m) => {
          expect(divRoundBig(p, d, m)).toBe(refDivRound(p, d, m));
        },
      ),
      { numRuns: 5000 },
    );
  });
  it('near-integer quotients where p/d in floating point rounds across an integer', () => {
    // p = k*d - 1 with large k: the double quotient rounds up to k
    for (const d of [3, 7, 1000, 8191, 1_000_003]) {
      const k = Math.floor(Number.MAX_SAFE_INTEGER / d) - 1;
      for (const p of [k * d - 1, k * d + 1, -(k * d - 1), -(k * d + 1)]) {
        for (const m of MODES) expect(divRound(p, d, m)).toBe(Number(refDivRound(BigInt(p), BigInt(d), m)));
      }
    }
  });
  it('never returns -0', () => {
    expect(Object.is(divRound(-1, 3, 'trunc'), -0)).toBe(false);
    expect(Object.is(divRound(-1, 3, 'halfEven'), -0)).toBe(false);
  });
  it('mode invariants: floor <= x <= ceil, trunc towards zero, half modes within 1/2', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (p, d) => {
          const f = divRoundBig(p, d, 'floor'),
            c = divRoundBig(p, d, 'ceil');
          expect(f * d <= p && p <= c * d).toBe(true);
          expect(c - f <= 1n).toBe(true);
          const t = divRoundBig(p, d, 'trunc');
          expect((t < 0n ? -t : t) * d <= (p < 0n ? -p : p)).toBe(true);
          for (const m of ['halfEven', 'halfExpand', 'halfTrunc', 'halfCeil', 'halfFloor'] as const) {
            const q = divRoundBig(p, d, m);
            const err = q * d - p;
            expect(2n * (err < 0n ? -err : err) <= d).toBe(true);
          }
        },
      ),
    );
  });
});
