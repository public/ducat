import { divideAndRoundBigint, roundTruncatedQuotient } from './generated/kernel.js';
import { RoundingError } from './rounding-error.js';

/**
 * Rounding modes. The string values are the ones `Intl.NumberFormat` uses for its `roundingMode`
 * option (ES2023), so a mode can be passed straight through to formatting. `Rounding` gives the
 * familiar names (HalfUp, HalfEven, ...) for the same strings.
 */
export type RoundingMode =
  | 'halfEven' // ties to even ("banker's rounding"; IEEE 754 default, EU VAT practice in many states)
  | 'halfExpand' // ties away from zero ("half up" in commercial usage)
  | 'halfTrunc' // ties towards zero ("half down")
  | 'halfCeil' // ties towards +infinity
  | 'halfFloor' // ties towards -infinity
  | 'expand' // away from zero ("up")
  | 'trunc' // towards zero ("down")
  | 'ceil' // towards +infinity
  | 'floor' // towards -infinity
  | 'unnecessary'; // throw RoundingError if the result is inexact (the default for parsing and processor amounts)

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
 * The rounding mode arithmetic uses when none is given: ties away from zero ('half up'). It is the default of
 * decimal.js, big.js, bignumber.js, Prisma.Decimal and Intl.NumberFormat, and what Math.round-based money
 * libraries (currency.js, js-money, ts-money) intend. Parsing (`money('1.005', 'EUR')`, `fromDecimal`) and
 * processor amounts (`toStripeAmount`, `toAdyen`) stay strict: they throw unless a mode is passed.
 */
export const DEFAULT_ROUNDING: RoundingMode = 'halfExpand';

export { RoundingError };

const MAX = Number.MAX_SAFE_INTEGER;

/** p / d rounded with `mode`; p, d safe integers, d > 0. Exact (never uses a float quotient unchecked). */
export function divRound(p: number, d: number, mode: RoundingMode): number {
  if (d === 1) {
    // still through the switch, so an unknown mode is rejected
    return roundTruncatedQuotient(p, 1, p, 0, mode) + 0;
  }
  if (!(Math.abs(p) + d <= MAX)) return Number(divRoundBig(BigInt(p), BigInt(d), mode));
  let q = Math.trunc(p / d);
  let r = p - q * d; // exact: |q*d| <= |p| + d <= MAX
  // the float quotient can be off by one ulp; fix so that r has the sign of p and |r| < d
  if (p >= 0) {
    if (r < 0) {
      q -= 1;
      r += d;
    } else if (r >= d) {
      q += 1;
      r -= d;
    }
  } else if (r > 0) {
    q += 1;
    r -= d;
  } else if (r <= -d) {
    q -= 1;
    r += d;
  }
  // q and r are now the exact truncated quotient and remainder, so the generated switch applies;
  // + 0 normalises -0
  return roundTruncatedQuotient(p, d, q, r, mode) + 0;
}

/**
 * p / d rounded with `mode`; d > 0n. The bigint kernel is generated from the Lean proofs in
 * proofs/Ducat/Rounding.lean (`src/generated/kernel.ts`), and so is the mode switch that `divRound` uses.
 */
export function divRoundBig(p: bigint, d: bigint, mode: RoundingMode): bigint {
  return divideAndRoundBigint(p, d, mode);
}
