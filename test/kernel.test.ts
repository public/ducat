// The bigint kernel in src/generated/kernel.ts is printed from Lean values whose behaviour is proved in
// proofs/Ducat/Rounding.lean. These tests cover what is not proved: the printer, the `divideAndRoundBigint` dispatch
// and the number fast path of `divideAndRound`, compared with the generated kernels and an independent oracle.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { divideAndRoundBigint as kernelDivideAndRoundBigint } from '../src/generated/kernel.js';
import {
  divideAndRound,
  divideAndRoundBigint,
  RoundingError,
  type RoundingMode,
} from '../src/rounding.js';
import { MODES, refDivRound } from './oracle.js';

const ALL_MODES: RoundingMode[] = [...MODES, 'unnecessary'];

type Outcome = bigint | 'throws';

/** The generated kernel's answer, or 'throws' (only 'unnecessary' on an inexact division may throw). */
function kernelOutcome(dividend: bigint, divisor: bigint, mode: RoundingMode): Outcome {
  try {
    return kernelDivideAndRoundBigint(dividend, divisor, mode);
  } catch (error) {
    expect(error).toBeInstanceOf(RoundingError);
    return 'throws';
  }
}

/** `divideAndRound` on JS numbers, which takes the number fast path whenever the inputs allow it. */
function numberPathOutcome(dividend: number, divisor: number, mode: RoundingMode): Outcome {
  try {
    return BigInt(divideAndRound(dividend, divisor, mode));
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
            mismatches.push(
              `${dividend} / ${divisor} ${mode}: kernel ${kernel}, number ${numberPath}, oracle ${oracle}`,
            );
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
        expect(numberPathOutcome(dividend, divisor, mode)).toBe(
          kernelOutcome(BigInt(dividend), BigInt(divisor), mode),
        );
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
      fc.property(
        quotients,
        divisors,
        offsets,
        fc.constantFrom(...ALL_MODES),
        (quotient, divisor, offset, mode) => {
          const sign = quotient < 0 ? -1 : 1;
          const dividend = quotient * divisor + sign * (Math.floor(divisor / 2) + offset);
          expect(numberPathOutcome(dividend, divisor, mode)).toBe(
            kernelOutcome(BigInt(dividend), BigInt(divisor), mode),
          );
        },
      ),
      { numRuns: 20_000 },
    );
  });

  it('agree with the oracle on bigints up to 10^30, and divideAndRoundBigint calls them', () => {
    const dividends = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });
    const divisors = fc.oneof(
      fc.bigInt({ min: 1n, max: 1000n }),
      fc.bigInt({ min: 1n, max: 10n ** 30n }),
    );
    fc.assert(
      fc.property(dividends, divisors, fc.constantFrom(...ALL_MODES), (dividend, divisor, mode) => {
        const kernel = kernelOutcome(dividend, divisor, mode);
        expect(kernel).toBe(oracleOutcome(dividend, divisor, mode));
        if (kernel === 'throws') {
          expect(() => divideAndRoundBigint(dividend, divisor, mode)).toThrow(RoundingError);
        } else {
          expect(divideAndRoundBigint(dividend, divisor, mode)).toBe(kernel);
        }
      }),
      { numRuns: 20_000 },
    );
  });

  it('treats negative odd quotients as odd on both paths (half-even ties)', () => {
    // -5/2 = -2.5 -> -2, -7/2 = -3.5 -> -4, -3/2 = -1.5 -> -2, -1/2 = -0.5 -> 0, -9/6 = -1.5 -> -2
    const ties: Array<[number, number, number]> = [
      [-5, 2, -2],
      [-7, 2, -4],
      [-3, 2, -2],
      [-1, 2, 0],
      [-9, 6, -2],
      [5, 2, 2],
      [7, 2, 4],
    ];
    for (const [dividend, divisor, expected] of ties) {
      expect(divideAndRound(dividend, divisor, 'halfEven')).toBe(expected);
      expect(divideAndRoundBigint(BigInt(dividend), BigInt(divisor), 'halfEven')).toBe(
        BigInt(expected),
      );
    }
    expect(Object.is(divideAndRound(-1, 2, 'halfEven'), 0)).toBe(true);
  });

  it('reports an unknown mode only when rounding is needed, on every path', () => {
    // a decision, documented on RoundingMode: exact results return before the mode is looked at
    for (const mode of [
      'nearest',
      'constructor',
      'toString',
      '__proto__',
    ] as string[] as RoundingMode[]) {
      expect(() => divideAndRound(7, 2, mode)).toThrow(/Unknown rounding mode/);
      expect(() => divideAndRoundBigint(7n, 2n, mode)).toThrow(/Unknown rounding mode/);
      expect(() => kernelDivideAndRoundBigint(7n, 2n, mode)).toThrow(/Unknown rounding mode/);
      for (const [dividend, divisor, quotient] of [
        [4, 2, 2],
        [-9, 3, -3],
        [4, 1, 4],
      ] as const) {
        expect(divideAndRound(dividend, divisor, mode)).toBe(quotient);
        expect(divideAndRoundBigint(BigInt(dividend), BigInt(divisor), mode)).toBe(
          BigInt(quotient),
        );
        expect(kernelDivideAndRoundBigint(BigInt(dividend), BigInt(divisor), mode)).toBe(
          BigInt(quotient),
        );
      }
    }
  });
});
