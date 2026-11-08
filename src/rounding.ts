import {
  divideAndRoundBigint as provedDivideAndRoundBigint,
  roundTruncatedQuotient,
} from './generated/kernel.js';
import type { Ratio } from './decimal.js';
import { RoundingError } from './rounding-error.js';

/**
 * Rounding modes. The string values are the ones `Intl.NumberFormat` uses for its `roundingMode`
 * option (ES2023), so a mode can be passed straight through to formatting. `Rounding` gives the
 * familiar names (HalfUp, HalfEven, ...) for the same strings.
 *
 * An invalid mode (possible only from untyped code) is reported, with a RangeError, only when
 * rounding is actually needed: an exact result is returned without looking at the mode, which keeps
 * the exact path as fast as it can be.
 */
export type RoundingMode =
  // ties to even ("banker's rounding"; IEEE 754 default, EU VAT practice in many states)
  | 'halfEven'
  | 'halfExpand' // ties away from zero ("half up" in commercial usage)
  | 'halfTrunc' // ties towards zero ("half down")
  | 'halfCeil' // ties towards +infinity
  | 'halfFloor' // ties towards -infinity
  | 'expand' // away from zero ("up")
  | 'trunc' // towards zero ("down")
  | 'ceil' // towards +infinity
  | 'floor' // towards -infinity
  // throw RoundingError if the result is inexact (the default for parsing and processor amounts)
  | 'unnecessary';

/**
 * Familiar names for the rounding modes (HalfUp, HalfEven, Bankers, ...), mapped to the mode
 * strings.
 */
export const Rounding = {
  HalfEven: 'halfEven',
  Bankers: 'halfEven',
  HalfUp: 'halfExpand',
  HalfDown: 'halfTrunc',
  HalfCeil: 'halfCeil',
  HalfFloor: 'halfFloor',
  Up: 'expand',
  Down: 'trunc',
  Ceil: 'ceil',
  Floor: 'floor',
  Unnecessary: 'unnecessary',
} as const satisfies Record<string, RoundingMode>;

/**
 * The rounding mode arithmetic uses when none is given: ties away from zero ('half up'). It is the
 * default of decimal.js, big.js, bignumber.js, Prisma.Decimal and Intl.NumberFormat, and what
 * Math.round-based money libraries (currency.js, js-money, ts-money) intend. Parsing
 * (`money('1.005', 'EUR')`, `fromDecimal`) and processor amounts (`toStripeAmount`, `toAdyen`) stay
 * strict: they throw unless a mode is passed.
 */
export const DEFAULT_ROUNDING: RoundingMode = 'halfExpand';

export { RoundingError };

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

/**
 * @internal `value / divisor` rounded with `mode`, for a safe-integer `value` and a reduced ratio
 * (`ratio()` makes its denominator positive): the number fast path of Fixed's divide, at the value's
 * own scale. Money's `divide` in money.ts inlines a copy of these steps, since a call there costs it
 * about 4% on its benchmarks; test/divide.test.ts checks that the copies agree in every mode, and
 * both against the proved kernel. It is `value × denominator / numerator`,
 * rounded once by `divideAndRound`, which is the same fraction the inverse ratio would give, without
 * building that ratio (bigint arithmetic and a gcd). Returns NaN when the number path doesn't apply,
 * so the caller takes the bigint path:
 * - a part that is NaN marks one that isn't a safe integer (`Ratio.n` and `Ratio.d`);
 * - `value` and `denominator` are safe integers, so a float product beyond 2^53 - 1 can't round
 *   back into the safe range, and the bound check rejects every inexact product.
 */
export function divideSafeByRatio(value: number, divisor: Ratio, mode: RoundingMode): number {
  const numerator = divisor.n;
  const denominator = divisor.d;
  // `x !== x` is true only for NaN
  if (numerator !== numerator || denominator !== denominator) {
    return NaN;
  }
  let dividend = value * denominator;
  if (!(dividend <= MAX_SAFE_MINOR && dividend >= -MAX_SAFE_MINOR)) {
    return NaN;
  }
  // divideAndRound needs a positive divisor: (−p)/(−n) is the same quotient
  let positiveDivisor = numerator;
  if (numerator < 0) {
    dividend = 0 - dividend;
    positiveDivisor = 0 - numerator;
  }
  return divideAndRound(dividend, positiveDivisor, mode);
}

/**
 * dividend / divisor rounded with `mode`, for safe-integer dividends and divisor > 0. Exact: the
 * float quotient is only a first guess, corrected until the remainder has the dividend's sign and
 * is smaller than the divisor.
 */
export function divideAndRound(dividend: number, divisor: number, mode: RoundingMode): number {
  if (divisor === 1) {
    return dividend + 0; // + 0 normalises -0 (0 * -1 from a caller)
  }
  // Beyond MAX_SAFE_MINOR the product quotient * divisor below could round, so take the bigint
  // path.
  if (!(Math.abs(dividend) + divisor <= MAX_SAFE_MINOR)) {
    return Number(divideAndRoundBigint(BigInt(dividend), BigInt(divisor), mode));
  }

  let quotient = Math.trunc(dividend / divisor);
  // exact: |quotient * divisor| <= |dividend| + divisor <= MAX_SAFE_MINOR
  let remainder = dividend - quotient * divisor;

  // The float quotient can be off by one ulp; fix it so the remainder has the dividend's sign and
  // is smaller than the divisor in magnitude.
  if (dividend >= 0) {
    if (remainder < 0) {
      quotient -= 1;
      remainder += divisor;
    } else if (remainder >= divisor) {
      quotient += 1;
      remainder -= divisor;
    }
  } else if (remainder > 0) {
    quotient += 1;
    remainder -= divisor;
  } else if (remainder <= -divisor) {
    quotient -= 1;
    remainder += divisor;
  }

  // The generated switch handles a zero remainder too; returning here saves the call on the hottest
  // path.
  if (remainder === 0) {
    return quotient + 0; // + 0 normalises -0
  }
  // quotient and remainder are now the exact truncated quotient and remainder, as the generated
  // switch expects
  return roundTruncatedQuotient(dividend, divisor, quotient, remainder, mode) + 0;
}

/**
 * dividend / divisor rounded with `mode`, for divisor > 0n. The bigint kernel is generated from the
 * Lean proofs in proofs/Ducat/Rounding.lean (`src/generated/kernel.ts`), and so is the mode switch
 * `divideAndRound` uses.
 */
export function divideAndRoundBigint(
  dividend: bigint,
  divisor: bigint,
  mode: RoundingMode,
): bigint {
  if (divisor === 1n) {
    return dividend;
  }
  return provedDivideAndRoundBigint(dividend, divisor, mode);
}
