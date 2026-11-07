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

/** Thrown when an operation would have to round but the rounding mode is `'unnecessary'`. */
export class RoundingError extends RangeError {
  override name = 'RoundingError';
}

/**
 * Should a truncated quotient move one step away from zero?
 * `twiceRem` is 2*|remainder| (non-zero), `d` the divisor, `odd` whether |truncated quotient| is odd.
 */
const MAX = Number.MAX_SAFE_INTEGER;

function away(mode: RoundingMode, twiceRem: number | bigint, d: number | bigint, odd: boolean, neg: boolean): boolean {
  // twiceRem === d is an exact tie; otherwise the half modes round to the nearest.
  switch (mode) {
    case 'halfExpand':
      return twiceRem >= d;
    case 'halfEven':
      return twiceRem === d ? odd : twiceRem > d;
    case 'halfTrunc':
      return twiceRem > d;
    case 'halfCeil':
      return twiceRem === d ? !neg : twiceRem > d;
    case 'halfFloor':
      return twiceRem === d ? neg : twiceRem > d;
    case 'trunc':
      return false;
    case 'expand':
      return true;
    case 'ceil':
      return !neg;
    case 'floor':
      return neg;
    case 'unnecessary':
      throw new RoundingError('Inexact result; pass a rounding mode');
  }
  throw new RangeError(`Unknown rounding mode "${String(mode)}"`);
}

/** p / d rounded with `mode`; p, d safe integers, d > 0. Exact (never uses a float quotient unchecked). */
export function divRound(p: number, d: number, mode: RoundingMode): number {
  if (d === 1) return p;
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
  if (r === 0) return q + 0; // + 0 normalises -0
  const neg = p < 0;
  if (away(mode, Math.abs(r) * 2, d, q % 2 !== 0, neg)) q += neg ? -1 : 1;
  return q + 0;
}

/** p / d rounded with `mode`; d > 0n. */
export function divRoundBig(p: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d === 1n) return p;
  let q = p / d; // truncates towards zero
  const r = p - q * d;
  if (r === 0n) return q;
  const neg = p < 0n;
  if (away(mode, (neg ? -r : r) * 2n, d, (q & 1n) !== 0n, neg)) q += neg ? -1n : 1n;
  return q;
}
