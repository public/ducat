// The bigint kernel in src/generated/kernel.ts is printed from Lean values whose behaviour is proved in
// proofs/Ducat/Rounding.lean. These tests cover what is not proved: the printer, the `divRoundBig` dispatch
// and the number fast path of `divRound`, compared with the generated kernels and an independent oracle.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { divideAndRoundBigint } from '../src/generated/kernel.js';
import { divRound, divRoundBig, RoundingError, type RoundingMode } from '../src/rounding.js';
import { MODES, refDivRound } from './oracle.js';

const ALL_MODES: RoundingMode[] = [...MODES, 'unnecessary'];

type Outcome = bigint | 'throws';

/** The generated kernel's answer, or 'throws' (only 'unnecessary' on an inexact division may throw). */
function kernelOutcome(dividend: bigint, divisor: bigint, mode: RoundingMode): Outcome {
  try {
    return divideAndRoundBigint(dividend, divisor, mode);
  } catch (error) {
    expect(error).toBeInstanceOf(RoundingError);
    return 'throws';
  }
}

/** `divRound` on JS numbers, which takes the number fast path whenever the inputs allow it. */
function numberPathOutcome(dividend: number, divisor: number, mode: RoundingMode): Outcome {
  try {
    return BigInt(divRound(dividend, divisor, mode));
  } catch (error) {
    expect(error).toBeInstanceOf(RoundingError);
    return 'throws';
  }
}

function oracleOutcome(dividend: bigint, divisor: bigint, mode: RoundingMode): Outcome {
  if (mode === 'unnecessary') {
    return dividend % divisor === 0n ? dividend / divisor : 'throws';
  }
  return refDivRound(dividend, divisor, mode);
}

describe('generated rounding kernel', () => {
  it('agree with the number path and the oracle for every dividend in [-300, 300] and divisor in [1, 40]', () => {
    const mismatches: string[] = [];
    for (const mode of ALL_MODES) {
      for (let divisor = 1; divisor <= 40; divisor++) {
        for (let dividend = -300; dividend <= 300; dividend++) {
          const kernel = kernelOutcome(BigInt(dividend), BigInt(divisor), mode);
          const numberPath = numberPathOutcome(dividend, divisor, mode);
          const oracle = oracleOutcome(BigInt(dividend), BigInt(divisor), mode);
          if (kernel !== numberPath || kernel !== oracle) {
            mismatches.push(`${dividend} / ${divisor} ${mode}: kernel ${kernel}, number ${numberPath}, oracle ${oracle}`);
          }
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('agree with the number path over the whole safe-integer range', () => {
    const dividends = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
    const divisors = fc.oneof(
      fc.integer({ min: 1, max: 1000 }),
      fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
    );
    fc.assert(
      fc.property(dividends, divisors, fc.constantFrom(...ALL_MODES), (dividend, divisor, mode) => {
        expect(numberPathOutcome(dividend, divisor, mode)).toBe(kernelOutcome(BigInt(dividend), BigInt(divisor), mode));
      }),
      { numRuns: 20_000 },
    );
  });

  it('agree with the number path on ties and near-ties', () => {
    // dividend = quotient * divisor + (about half a divisor): uniform sampling rarely lands on a tie
    const quotients = fc.integer({ min: -(2 ** 26), max: 2 ** 26 });
    const divisors = fc.integer({ min: 1, max: 2 ** 26 });
    const offsets = fc.integer({ min: -1, max: 1 });
    fc.assert(
      fc.property(quotients, divisors, offsets, fc.constantFrom(...ALL_MODES), (quotient, divisor, offset, mode) => {
        const sign = quotient < 0 ? -1 : 1;
        const dividend = quotient * divisor + sign * (Math.floor(divisor / 2) + offset);
        expect(numberPathOutcome(dividend, divisor, mode)).toBe(kernelOutcome(BigInt(dividend), BigInt(divisor), mode));
      }),
      { numRuns: 20_000 },
    );
  });

  it('agree with the oracle on bigints up to 10^30, and divRoundBig calls them', () => {
    const dividends = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });
    const divisors = fc.oneof(fc.bigInt({ min: 1n, max: 1000n }), fc.bigInt({ min: 1n, max: 10n ** 30n }));
    fc.assert(
      fc.property(dividends, divisors, fc.constantFrom(...ALL_MODES), (dividend, divisor, mode) => {
        const kernel = kernelOutcome(dividend, divisor, mode);
        expect(kernel).toBe(oracleOutcome(dividend, divisor, mode));
        if (kernel === 'throws') {
          expect(() => divRoundBig(dividend, divisor, mode)).toThrow(RoundingError);
        } else {
          expect(divRoundBig(dividend, divisor, mode)).toBe(kernel);
        }
      }),
      { numRuns: 20_000 },
    );
  });

  it('rejects an unknown mode, including names inherited from Object.prototype', () => {
    for (const mode of ['nearest', 'constructor', 'toString', '__proto__']) {
      expect(() => divRoundBig(7n, 2n, mode as RoundingMode)).toThrow(/Unknown rounding mode/);
      expect(() => divideAndRoundBigint(7n, 2n, mode as RoundingMode)).toThrow(/Unknown rounding mode/);
    }
  });
});
