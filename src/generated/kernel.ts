// lean-sources sha256:b17263c6b0930babd30db8b3d21133e0dd50f11c6c4876d9a2740db3e91a9804 content sha256:498795f60a1d159dd96a1b71a255e40860d0968bc25c77f9bbd78754a43b39b7
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
export function divideAndRoundBigint(dividend: bigint, divisor: bigint, mode: RoundingMode): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend - quotient * divisor;
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
      if (divisor < twiceRemainder || (twiceRemainder === divisor && !((quotient / 2n) * 2n === quotient))) {
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
      if (remainder === 0n) {
        return quotient;
      }
      if (dividend < 0n) {
        return quotient - 1n;
      }
      return quotient + 1n;
    }
    // rounds towards +infinity
    case 'ceil': {
      if (remainder === 0n || dividend < 0n) {
        return quotient;
      }
      return quotient + 1n;
    }
    // rounds towards -infinity
    case 'floor': {
      if (remainder === 0n || !(dividend < 0n)) {
        return quotient;
      }
      return quotient - 1n;
    }
    // rounds not at all: throws RoundingError unless the division is exact
    case 'unnecessary': {
      if (remainder === 0n) {
        return quotient;
      }
      throw new RoundingError(ROUNDING_NECESSARY);
    }
  }
  throw new RangeError(`Unknown rounding mode "${String(mode)}"`);
}
