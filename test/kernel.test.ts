// The bigint kernels in src/generated/kernel.ts are printed from Lean values whose behaviour is proved
// (proofs/Ducat/Rounding.lean). These tests check what is not proved: the number fast path of `divRound`,
// the printer, and the `divRoundBig` dispatch, against the generated kernels and an independent oracle.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIV_ROUND_BIG } from '../src/generated/kernel.js';
import { divRound, divRoundBig, RoundingError, type RoundingMode } from '../src/rounding.js';
import { MODES, refDivRound } from './oracle.js';

const ALL: RoundingMode[] = [...MODES, 'unnecessary'];

/** The generated kernel's answer, or 'fail' when it throws (only `unnecessary` on an inexact division). */
function kernel(p: bigint, d: bigint, mode: RoundingMode): bigint | 'fail' {
  try {
    return DIV_ROUND_BIG[mode]!(p, d);
  } catch (e) {
    expect(e).toBeInstanceOf(RoundingError);
    return 'fail';
  }
}

function numberPath(p: number, d: number, mode: RoundingMode): bigint | 'fail' {
  try {
    return BigInt(divRound(p, d, mode));
  } catch (e) {
    expect(e).toBeInstanceOf(RoundingError);
    return 'fail';
  }
}

function oracle(p: bigint, d: bigint, mode: RoundingMode): bigint | 'fail' {
  if (mode === 'unnecessary') return p % d === 0n ? p / d : 'fail';
  return refDivRound(p, d, mode);
}

describe('generated kernel', () => {
  it('has one kernel per rounding mode', () => {
    expect(Object.keys(DIV_ROUND_BIG).sort()).toEqual([...ALL].sort());
  });

  it('matches the number path and the oracle exhaustively on p in [-300, 300], d in [1, 40]', () => {
    let mismatches = 0;
    for (const mode of ALL)
      for (let d = 1; d <= 40; d++)
        for (let p = -300; p <= 300; p++) {
          const k = kernel(BigInt(p), BigInt(d), mode);
          if (k !== numberPath(p, d, mode) || k !== oracle(BigInt(p), BigInt(d), mode)) {
            if (mismatches++ < 5) expect({ p, d, mode, k }).toEqual({ p, d, mode, k: oracle(BigInt(p), BigInt(d), mode) });
          }
        }
    expect(mismatches).toBe(0);
  });

  it('matches the number path over the safe range', () => {
    const safe = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
    const div = fc.oneof(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }));
    fc.assert(
      fc.property(safe, div, fc.constantFrom(...ALL), (p, d, mode) => {
        expect(numberPath(p, d, mode)).toBe(kernel(BigInt(p), BigInt(d), mode));
      }),
      { numRuns: 20_000 },
    );
  });

  it('matches the number path on ties and near-ties over the safe range', () => {
    // p = q*d + r with r near d/2 hits the tie-breaking branches far more often than uniform sampling
    const q = fc.integer({ min: -(2 ** 26), max: 2 ** 26 });
    const d = fc.integer({ min: 1, max: 2 ** 26 });
    fc.assert(
      fc.property(q, d, fc.integer({ min: -1, max: 1 }), fc.constantFrom(...ALL), (q, d, off, mode) => {
        const p = q * d + Math.sign(q || 1) * (Math.floor(d / 2) + off);
        expect(numberPath(p, d, mode)).toBe(kernel(BigInt(p), BigInt(d), mode));
      }),
      { numRuns: 20_000 },
    );
  });

  it('matches the oracle on bigints up to 10^30, and divRoundBig dispatches to it', () => {
    const big = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });
    const div = fc.oneof(fc.bigInt({ min: 1n, max: 1000n }), fc.bigInt({ min: 1n, max: 10n ** 30n }));
    fc.assert(
      fc.property(big, div, fc.constantFrom(...ALL), (p, d, mode) => {
        const k = kernel(p, d, mode);
        expect(k).toBe(oracle(p, d, mode));
        if (k === 'fail') expect(() => divRoundBig(p, d, mode)).toThrow(RoundingError);
        else expect(divRoundBig(p, d, mode)).toBe(k);
      }),
      { numRuns: 20_000 },
    );
  });

  it('divRoundBig rejects an unknown mode', () => {
    expect(() => divRoundBig(7n, 2n, 'nearest' as RoundingMode)).toThrow(/Unknown rounding mode/);
  });
});
