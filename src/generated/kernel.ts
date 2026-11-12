// lean-sources sha256:681a4492224a78675f22cbadd91cfbe734b8519d6807a392df79d25fc270e319 content sha256:dc3d761f86eb9b865b2cfa6a6dba6e6b3853afdab3ec5c8811415f9942c6231c
// GENERATED from proofs/Ducat/Rounding.lean by `pnpm gen:kernel`. Do not edit.
import { RoundingError } from '../rounding-error.js';
import type { RoundingMode } from '../rounding.js';

const ROUNDING_NECESSARY = 'Rounding necessary: the result is not exact; pass a rounding mode';

/**
 * `dividend / divisor` rounded with `mode`; `divisor` must be positive.
 *
 * Each `case` is printed from the Lean kernel for that mode, which is proved correct in
 * proofs/Ducat/Rounding.lean: `kernel_sound` (the result satisfies the specification `Rounds`),
 * `rounds_unique` (only one value does) and `kernel_fails_iff` (it throws only for 'unnecessary' on an
 * inexact division), hence `kernel_correct`. Unknown modes throw a RangeError.
 */
export function divideAndRoundBigint(
  dividend: bigint,
  divisor: bigint,
  mode: RoundingMode,
): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend - quotient * divisor;
  return roundTruncatedQuotientBigint(dividend, divisor, quotient, remainder, mode);
}

/**
 * Rounds the truncated `quotient` of `dividend / divisor` (with `remainder = dividend - quotient * divisor`)
 * with `mode`; `divisor` must be positive.
 *
 * Each `case` is printed from the Lean kernel for that mode, which is proved correct in
 * proofs/Ducat/Rounding.lean: `kernel_sound` (the result satisfies the specification `Rounds`),
 * `rounds_unique` (only one value does) and `kernel_fails_iff` (it throws only for 'unnecessary' on an
 * inexact division), hence `kernel_correct`. Unknown modes throw a RangeError.
 */
function roundTruncatedQuotientBigint(
  dividend: bigint,
  divisor: bigint,
  quotient: bigint,
  remainder: bigint,
  mode: RoundingMode,
): bigint {
  if (remainder === 0n) {
    return quotient;
  }
  const twiceRemainder = remainder < 0n ? -2n * remainder : 2n * remainder;

  switch (mode) {
    // rounds to the nearest integer, ties away from zero
    case 'halfExpand': {
      if (divisor <= twiceRemainder) {
        if (dividend < 0n) {
          return quotient - 1n;
        }
        return quotient + 1n;
      }
      return quotient;
    }
    // rounds to the nearest integer, ties to the even neighbour
    case 'halfEven': {
      if (divisor < twiceRemainder || (twiceRemainder === divisor && quotient % 2n !== 0n)) {
        if (dividend < 0n) {
          return quotient - 1n;
        }
        return quotient + 1n;
      }
      return quotient;
    }
    // rounds to the nearest integer, ties towards zero
    case 'halfTrunc': {
      if (divisor < twiceRemainder) {
        if (dividend < 0n) {
          return quotient - 1n;
        }
        return quotient + 1n;
      }
      return quotient;
    }
    // rounds to the nearest integer, ties towards +infinity
    case 'halfCeil': {
      if (divisor < twiceRemainder || (twiceRemainder === divisor && !(dividend < 0n))) {
        if (dividend < 0n) {
          return quotient - 1n;
        }
        return quotient + 1n;
      }
      return quotient;
    }
    // rounds to the nearest integer, ties towards -infinity
    case 'halfFloor': {
      if (divisor < twiceRemainder || (twiceRemainder === divisor && dividend < 0n)) {
        if (dividend < 0n) {
          return quotient - 1n;
        }
        return quotient + 1n;
      }
      return quotient;
    }
    // rounds towards zero
    case 'trunc': {
      return quotient;
    }
    // rounds away from zero
    case 'expand': {
      if (dividend < 0n) {
        return quotient - 1n;
      }
      return quotient + 1n;
    }
    // rounds towards +infinity
    case 'ceil': {
      if (dividend < 0n) {
        return quotient;
      }
      return quotient + 1n;
    }
    // rounds towards -infinity
    case 'floor': {
      if (!(dividend < 0n)) {
        return quotient;
      }
      return quotient - 1n;
    }
    // rounds not at all: throws RoundingError unless the division is exact
    case 'unnecessary': {
      throw new RoundingError(ROUNDING_NECESSARY);
    }
  }
  throw new RangeError(`Unknown rounding mode "${String(mode)}"`);
}

/**
 * The same switch over `number`: rounds the truncated `quotient` of `dividend / divisor`, where
 * `remainder = dividend - quotient * divisor` exactly and `divisor` is positive. Every input must be a safe
 * integer. This copy is not proved; test/kernel.test.ts compares it with the `bigint` one.
 */
export function roundTruncatedQuotient(
  dividend: number,
  divisor: number,
  quotient: number,
  remainder: number,
  mode: RoundingMode,
): number {
  if (remainder === 0) {
    return quotient;
  }
  const twiceRemainder = remainder < 0 ? -2 * remainder : 2 * remainder;

  switch (mode) {
    // rounds to the nearest integer, ties away from zero
    case 'halfExpand': {
      if (divisor <= twiceRemainder) {
        if (dividend < 0) {
          return quotient - 1;
        }
        return quotient + 1;
      }
      return quotient;
    }
    // rounds to the nearest integer, ties to the even neighbour
    case 'halfEven': {
      if (divisor < twiceRemainder || (twiceRemainder === divisor && quotient % 2 !== 0)) {
        if (dividend < 0) {
          return quotient - 1;
        }
        return quotient + 1;
      }
      return quotient;
    }
    // rounds to the nearest integer, ties towards zero
    case 'halfTrunc': {
      if (divisor < twiceRemainder) {
        if (dividend < 0) {
          return quotient - 1;
        }
        return quotient + 1;
      }
      return quotient;
    }
    // rounds to the nearest integer, ties towards +infinity
    case 'halfCeil': {
      if (divisor < twiceRemainder || (twiceRemainder === divisor && !(dividend < 0))) {
        if (dividend < 0) {
          return quotient - 1;
        }
        return quotient + 1;
      }
      return quotient;
    }
    // rounds to the nearest integer, ties towards -infinity
    case 'halfFloor': {
      if (divisor < twiceRemainder || (twiceRemainder === divisor && dividend < 0)) {
        if (dividend < 0) {
          return quotient - 1;
        }
        return quotient + 1;
      }
      return quotient;
    }
    // rounds towards zero
    case 'trunc': {
      return quotient;
    }
    // rounds away from zero
    case 'expand': {
      if (dividend < 0) {
        return quotient - 1;
      }
      return quotient + 1;
    }
    // rounds towards +infinity
    case 'ceil': {
      if (dividend < 0) {
        return quotient;
      }
      return quotient + 1;
    }
    // rounds towards -infinity
    case 'floor': {
      if (!(dividend < 0)) {
        return quotient;
      }
      return quotient - 1;
    }
    // rounds not at all: throws RoundingError unless the division is exact
    case 'unnecessary': {
      throw new RoundingError(ROUNDING_NECESSARY);
    }
  }
  throw new RangeError(`Unknown rounding mode "${String(mode)}"`);
}
