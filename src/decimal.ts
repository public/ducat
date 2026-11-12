// Exact decimal-string handling. No floating point is used on amounts: numbers given as factors are
// converted through their shortest round-trip decimal representation (String(x)), never multiplied.

import type { Fixed } from './fixed.js';

/** The largest minor-unit count held as a number (2^53 - 1); larger values are bigints. */
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;
const MAXN = /* @__PURE__ */ BigInt(MAX_SAFE_MINOR);

/**
 * An exact rational factor num/den (den > 0). `n`/`d` hold the same values as numbers when both are
 * safe.
 */
export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
  /** num as a number, or NaN when it is not a safe integer */
  readonly n: number;
  /** den as a number, or NaN when it is not a safe integer */
  readonly d: number;
}

/**
 * Anything accepted where a multiplier, rate or percentage is expected. A `Fixed` is read exactly,
 * as its scaled integer over 10^scale.
 */
export type Factor = number | bigint | string | Ratio | Fixed;

const POW10N: bigint[] = [];
/** 10^exponent as a bigint, cached. */
export function pow10n(exponent: number): bigint {
  return (POW10N[exponent] ??= 10n ** BigInt(exponent));
}
/** 10^e as a number for 0 <= e <= 15 (all exact and safe). */
export const POW10 = [
  1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15,
] as const;

/**
 * A bigint as a number when it is a safe integer, else unchanged: the representation Money keeps.
 */
export const normalizeMinor = (value: bigint): number | bigint =>
  value <= MAXN && value >= -MAXN ? Number(value) : value;

/**
 * Parses a plain decimal string ("-12.345", "+7", "0.50") into digits/10^scale. Returns the integer
 * of all digits (number when safe, else bigint) and the count of fraction digits. Hand-rolled (no
 * regex, no BigInt for short inputs): this is the hot path of `money("12.34", ...)`.
 */
export function parsePlainDecimal(
  input: string,
  // Stryker disable next-line BlockStatement: a null result falls back to parseDecimal
): { digits: number | bigint; scale: number } | null {
  const len = input.length;
  let i = 0;
  let neg = false;
  let code = input.charCodeAt(0);
  // Stryker disable next-line BlockStatement,LogicalOperator: a null result falls back to parseDecimal
  if (code === 45 /* - */ || code === 43 /* + */) {
    neg = code === 45;
    i = 1;
  }
  let acc = 0;
  let digitsSeen = 0;
  let scale = -1;
  // Stryker disable next-line BooleanLiteral: the bigint branch reads the same digits
  let big = false;
  const start = i;
  // Stryker disable next-line BlockStatement,ConditionalExpression,EqualityOperator,UpdateOperator: a null result falls back to parseDecimal
  for (; i < len; i++) {
    code = input.charCodeAt(i);
    // Stryker disable next-line BlockStatement: a null result falls back to parseDecimal
    if (code >= 48 && code <= 57) {
      digitsSeen++;
      // Stryker disable next-line BlockStatement,EqualityOperator: a null result falls back to parseDecimal
      if (scale >= 0) {
        scale++;
      }
      if (!big) {
        // 15 digits always fit exactly in a double; beyond that use BigInt
        // Stryker disable next-line EqualityOperator: the bigint branch reads the same digits
        if (digitsSeen > 15) {
          big = true;
        } else {
          acc = acc * 10 + (code - 48);
        }
      }
    } else if (code === 46 /* . */ && scale < 0 && digitsSeen > 0) {
      scale = 0;
    } else {
      return null;
    }
  }
  // "", "-" and "12." are not decimals
  if (digitsSeen === 0 || scale === 0) {
    return null;
  }
  // parseDecimal reports fractions longer than MAX_DECIMAL_SCALE
  if (scale > MAX_DECIMAL_SCALE) {
    return null;
  }
  if (scale < 0) {
    scale = 0;
  }
  if (big) {
    const raw = input.slice(start).replace('.', '');
    const value = BigInt(raw);
    return { digits: normalizeMinor(neg ? -value : value), scale };
  }
  return { digits: neg ? 0 - acc : acc, scale };
}

const EXP_RE = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * The largest exponent and number of fraction digits a decimal string may have. Far beyond any real
 * amount or rate, and it keeps input such as "1e999999999" from building enormous powers of ten.
 */
export const MAX_DECIMAL_SCALE = 1000;

/** Parses a decimal string, allowing exponent notation ("1e-7", as produced by String(1e-7)). */
export function parseDecimal(input: string): { digits: bigint; scale: number } {
  const match = EXP_RE.exec(input);
  if (!match) {
    throw new SyntaxError(`Invalid decimal string "${input}"`);
  }
  const [, sign, int, frac = '', exp = '0'] = match;
  const exponent = Number(exp);
  let scale = frac.length - exponent;
  if (!(Math.abs(exponent) <= MAX_DECIMAL_SCALE) || scale > MAX_DECIMAL_SCALE) {
    // The input itself is not quoted: it may be huge.
    throw new RangeError(`Decimal string exponent or fraction digits beyond ${MAX_DECIMAL_SCALE}`);
  }
  let digits = BigInt(int! + frac);
  if (scale < 0) {
    digits *= pow10n(-scale);
    scale = 0;
  }
  return { digits: sign === '-' ? -digits : digits, scale };
}

/**
 * A double holds 15 significant decimal digits faithfully (DBL_DIG): a number whose shortest form
 * has no more than that is the decimal its author wrote. 0.1 + 0.2 reads back as
 * 0.30000000000000004 and 1 / 0.52 as 1.9230769230769231 (17 digits): those are float artefacts.
 */
export const MAX_FAITHFUL_DIGITS = 15;

/**
 * A number's shortest decimal form, which must have at most 15 significant digits (see
 * MAX_FAITHFUL_DIGITS). `fix` says what to do instead, for the error message.
 */
export function faithfulDecimal(value: number, fix: string): string {
  // The shortest form has at most 15 digits exactly when rounding to 15 digits gives the same
  // double back: shortest means the fewest digits that round-trip.
  // Safe integers are exact whatever their digit count, and NaN and the infinities pass through
  // for the caller's parser to reject. (Today's callers take safe integers on a path of their own.)
  if (
    !Number.isSafeInteger(value) &&
    Number.isFinite(value) &&
    Number(value.toPrecision(MAX_FAITHFUL_DIGITS)) !== value
  ) {
    throw new RangeError(
      `${value} has more than ${MAX_FAITHFUL_DIGITS} significant digits; ${fix}`,
    );
  }
  return String(value);
}

/**
 * Returns `scale` if it is a valid scale: an integer from 0 to MAX_DECIMAL_SCALE. Scales are never
 * negative: round to tens or hundreds with an increment (`roundToIncrement`, a rounding policy).
 */
export function checkScale(scale: number): number {
  // On hot paths (Fixed, ExactMoney, policies), so one comparison does most of the work: `>>> 0`
  // leaves an integer from 0 to 2^32 - 1 unchanged and changes negatives, fractions, NaN and the
  // infinities.
  if (scale >>> 0 !== scale || scale > MAX_DECIMAL_SCALE) {
    invalidScale(scale);
  }
  return scale;
}

// Kept out of checkScale, so the check stays small enough to inline.
function invalidScale(scale: number): never {
  throw new RangeError(`Invalid scale ${scale}: use an integer from 0 to ${MAX_DECIMAL_SCALE}`);
}

function gcd(left: bigint, right: bigint): bigint {
  if (left < 0n) {
    left = -left;
  }
  // a temporary, not a destructuring swap: `[a, b] = [b, a % b]` builds an array per step until the
  // optimiser removes it, and this loop runs for every ratio that is built
  while (right) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

/** The value as a number when it is a safe integer, otherwise NaN (a Ratio's `n` and `d`). */
function safeNumberOrNaN(value: bigint): number {
  return value <= MAXN && value >= -MAXN ? Number(value) : NaN;
}

function makeRatio(num: bigint, den: bigint): Ratio {
  if (den === 0n) {
    throw new RangeError('Division by zero');
  }
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  // an integer (den 1) is already in lowest terms
  if (den !== 1n) {
    const divisor = gcd(num, den);
    if (divisor > 1n) {
      num /= divisor;
      den /= divisor;
    }
  }
  return { num, den, n: safeNumberOrNaN(num), d: safeNumberOrNaN(den) };
}

/**
 * The error for a value that isn't a factor. Untyped code passes all sorts here (a Fixed, a
 * `{ num: 1, den: 2 }` of numbers, null), and without this check they fail later with an unrelated
 * BigInt error, or are returned as if they were a Ratio.
 */
function notAFactor(value: unknown): TypeError {
  return new TypeError(
    `Expected a number, bigint, decimal string, Ratio or Fixed, got ${typeof value} ${String(value)}`,
  );
}

const cache = /* @__PURE__ */ new Map<string, Ratio>();
const INT_RATIOS: Ratio[] = [];

/** A factor as its caller wrote it, for error messages: '-150.5', 12, or 301/3 for a Ratio. */
export const describeFactor = (factor: Factor): string =>
  typeof factor === 'object' && 'num' in factor ? `${factor.num}/${factor.den}` : String(factor);

/**
 * Builds an exact ratio. `ratio('1.075')`, `ratio(3, 4)`, `ratio(10n)`, `ratio('1/3')`.
 * Numbers are taken at their shortest decimal representation: `ratio(0.1)` is exactly 1/10. One
 * with more than 15 significant digits (`1 / 0.52` is 1.9230769230769231) throws a RangeError,
 * since a float artefact can't be told from a decimal someone wrote; pass a string instead.
 * Pre-build ratios you use in hot loops; strings are also cached (up to 1024 entries).
 */
export function ratio(value: Factor, den?: Factor): Ratio {
  if (den !== undefined) {
    // two bigints (divide, percentages, tax): one reduction instead of three
    // Stryker disable next-line BlockStatement,StringLiteral: shortcut, the general path builds the same ratio
    if (typeof value === 'bigint' && typeof den === 'bigint') {
      return makeRatio(value, den);
    }
    const numeratorRatio = ratio(value);
    const denominatorRatio = ratio(den);
    return makeRatio(
      numeratorRatio.num * denominatorRatio.den,
      numeratorRatio.den * denominatorRatio.num,
    );
  }
  if (typeof value === 'object') {
    // A Ratio from ratio() passes straight through: the hot path for factors built once. A
    // hand-made { num, den } of bigints is rebuilt, so it is reduced and has `n` and `d`.
    const asRatio = value as Partial<Ratio> | null;
    if (typeof asRatio?.num === 'bigint' && typeof asRatio.den === 'bigint') {
      return typeof asRatio.n === 'number' && typeof asRatio.d === 'number'
        ? (asRatio as Ratio)
        : makeRatio(asRatio.num, asRatio.den);
    }
    // A Fixed, read through its scaled form rather than `instanceof`, so the core doesn't load
    // `/fixed`. The scale is checked because a lookalike object could carry any value.
    const scaled = (value as Partial<Fixed> | null)?.value;
    const scale = (value as Partial<Fixed> | null)?.scale;
    if (
      (typeof scaled === 'bigint' || Number.isSafeInteger(scaled)) &&
      // Stryker disable next-line ConditionalExpression: the scale checks below reject a non-number
      typeof scale === 'number' &&
      scale >>> 0 === scale &&
      scale <= MAX_DECIMAL_SCALE
    ) {
      return makeRatio(BigInt(scaled as number | bigint), pow10n(scale));
    }
    throw notAFactor(value);
  }
  if (typeof value === 'number') {
    // Stryker disable next-line BlockStatement: a safe integer parses to the same ratio
    if (Number.isSafeInteger(value)) {
      // Stryker disable next-line BlockStatement,ConditionalExpression,EqualityOperator,LogicalOperator: a cache only saves time
      if (value >= 0 && value < 128) {
        return (INT_RATIOS[value] ??= makeRatio(BigInt(value), 1n));
      }
      return makeRatio(BigInt(value), 1n);
    }
    if (!Number.isFinite(value)) {
      throw new RangeError(`Invalid factor ${value}`);
    }
    value = faithfulDecimal(value, 'pass it as a string');
  }
  if (typeof value === 'bigint') {
    return makeRatio(value, 1n);
  }
  if (typeof value !== 'string') {
    throw notAFactor(value);
  }
  let cached = cache.get(value);
  if (cached === undefined) {
    const slash = value.indexOf('/');
    if (slash > 0) {
      cached = ratio(value.slice(0, slash), value.slice(slash + 1));
    } else {
      const { digits, scale } = parseDecimal(value);
      cached = makeRatio(digits, pow10n(scale));
    }
    // Stryker disable next-line ConditionalExpression,EqualityOperator: a cache only saves time
    if (cache.size >= 1024) {
      cache.clear();
    }
    // Stryker disable next-line CallExpression: a cache only saves time
    cache.set(value, cached);
  }
  return cached;
}

/** num/den -> exact decimal string if the expansion terminates, else null. */
export function ratioToDecimal(value: Ratio): string | null {
  let remainingDenominator = value.den;
  let twos = 0;
  let fives = 0;
  while (remainingDenominator % 2n === 0n) {
    remainingDenominator /= 2n;
    twos++;
  }
  while (remainingDenominator % 5n === 0n) {
    remainingDenominator /= 5n;
    fives++;
  }
  if (remainingDenominator !== 1n) {
    return null;
  }
  const scale = Math.max(twos, fives);
  return formatScaled(value.num * (pow10n(scale) / value.den), scale);
}

// Zero padding for the fraction digits, built once: indexing it is faster than padStart.
const ZPAD = /* @__PURE__ */ Array.from({ length: 16 }, (_, length) => '0'.repeat(length));

/** Formats an integer at `scale` as a plain decimal string ("-0.05"). */
export function formatScaled(minor: number | bigint, scale: number): string {
  if (typeof minor === 'number' && scale <= 15) {
    if (scale === 0) {
      return String(minor);
    }
    // integer/fraction split with exact integer arithmetic (the float quotient is corrected)
    const magnitude = minor < 0 ? 0 - minor : minor;
    const unit = POW10[scale]!;
    if (magnitude + unit <= MAX_SAFE_MINOR) {
      let whole = Math.floor(magnitude / unit);
      let fraction = magnitude - whole * unit;
      if (fraction < 0) {
        whole -= 1;
        fraction += unit;
      } else if (fraction >= unit) {
        whole += 1;
        fraction -= unit;
      }
      let fractionDigits = String(fraction);
      if (fractionDigits.length < scale) {
        fractionDigits = ZPAD[scale - fractionDigits.length] + fractionDigits;
      }
      return (minor < 0 ? '-' : '') + whole + '.' + fractionDigits;
    }
  }
  const neg = minor < 0;
  let digits =
    typeof minor === 'number' ? String(neg ? 0 - minor : minor) : (neg ? -minor : minor).toString();
  if (scale > 0) {
    if (digits.length <= scale) {
      digits = '0'.repeat(scale - digits.length + 1) + digits;
    }
    digits = digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale);
  }
  return neg ? '-' + digits : digits;
}
