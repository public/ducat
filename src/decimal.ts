// Exact decimal-string handling. No floating point is used on amounts: numbers given as factors are
// converted through their shortest round-trip decimal representation (String(x)), never multiplied.

const MAX = Number.MAX_SAFE_INTEGER;
const MAXN = BigInt(MAX);

/** An exact rational factor num/den (den > 0). `n`/`d` hold the same values as numbers when both are safe. */
export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
  /** num as a number, or NaN when it is not a safe integer */
  readonly n: number;
  /** den as a number, or NaN when it is not a safe integer */
  readonly d: number;
}

/** Anything accepted where a multiplier, rate or percentage is expected. */
export type Factor = number | bigint | string | Ratio;

const POW10N: bigint[] = [];
export function pow10n(e: number): bigint {
  return (POW10N[e] ??= 10n ** BigInt(e));
}
/** 10^e as a number for 0 <= e <= 15 (all exact and safe). */
export const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15] as const;

export const toSafe = (v: bigint): number | bigint => (v <= MAXN && v >= -MAXN ? Number(v) : v);

/**
 * Parses a plain decimal string ("-12.345", "+7", "0.50") into digits/10^scale.
 * Returns the integer of all digits (number when safe, else bigint) and the count of fraction digits.
 * Hand-rolled (no regex, no BigInt for short inputs): this is the hot path of `money("12.34", ...)`.
 */
export function parsePlainDecimal(s: string): { digits: number | bigint; scale: number } | null {
  const len = s.length;
  let i = 0;
  let neg = false;
  let c = s.charCodeAt(0);
  if (c === 45 /* - */ || c === 43 /* + */) {
    neg = c === 45;
    i = 1;
  }
  let acc = 0;
  let digitsSeen = 0;
  let scale = -1;
  let big = false;
  const start = i;
  for (; i < len; i++) {
    c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      digitsSeen++;
      if (scale >= 0) scale++;
      if (!big) {
        if (digitsSeen > 15) big = true; // 15 digits always fit exactly; beyond that use BigInt
        else acc = acc * 10 + (c - 48);
      }
    } else if (c === 46 /* . */ && scale < 0 && digitsSeen > 0) {
      scale = 0;
    } else return null;
  }
  if (digitsSeen === 0 || scale === 0) return null; // "", "-", "12."
  if (scale > MAX_DECIMAL_SCALE) return null; // parseDecimal reports it
  if (scale < 0) scale = 0;
  if (big) {
    const raw = s.slice(start).replace('.', '');
    const v = BigInt(raw);
    return { digits: toSafe(neg ? -v : v), scale };
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
export function parseDecimal(s: string): { digits: bigint; scale: number } {
  const m = EXP_RE.exec(s.trim());
  if (!m) throw new SyntaxError(`Invalid decimal string "${s}"`);
  const [, sign, int, frac = '', exp = '0'] = m;
  const exponent = Number(exp);
  let scale = frac.length - exponent;
  if (!(Math.abs(exponent) <= MAX_DECIMAL_SCALE) || scale > MAX_DECIMAL_SCALE) {
    // Quote at most 40 characters: the input may be huge.
    let shown = s;
    if (shown.length > 40) {
      shown = shown.slice(0, 40) + '…';
    }
    throw new RangeError(`"${shown}" is outside the supported range`);
  }
  let digits = BigInt(int! + frac);
  if (scale < 0) {
    digits *= pow10n(-scale);
    scale = 0;
  }
  return { digits: sign === '-' ? -digits : digits, scale };
}

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  while (b) [a, b] = [b, a % b];
  return a;
}

function makeRatio(num: bigint, den: bigint): Ratio {
  if (den === 0n) throw new RangeError('Division by zero');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  if (g > 1n) {
    num /= g;
    den /= g;
  }
  const safe = (v: bigint) => (v <= MAXN && v >= -MAXN ? Number(v) : NaN);
  return { num, den, n: safe(num), d: safe(den) };
}

const cache = new Map<string, Ratio>();
const INT_RATIOS: Ratio[] = [];

/**
 * Builds an exact ratio. `ratio('1.075')`, `ratio(3, 4)`, `ratio(10n)`, `ratio('1/3')`.
 * Numbers are taken at their shortest decimal representation: `ratio(0.1)` is exactly 1/10.
 * Pre-build ratios you use in hot loops; strings are also cached (up to 1024 entries).
 */
export function ratio(x: Factor, den?: Factor): Ratio {
  if (den !== undefined) {
    const a = ratio(x),
      b = ratio(den);
    return makeRatio(a.num * b.den, a.den * b.num);
  }
  if (typeof x === 'object') return x;
  if (typeof x === 'number') {
    if (Number.isSafeInteger(x)) {
      if (x >= 0 && x < 128) return (INT_RATIOS[x] ??= makeRatio(BigInt(x), 1n));
      return makeRatio(BigInt(x), 1n);
    }
    if (!Number.isFinite(x)) throw new RangeError(`Invalid factor ${x}`);
    x = String(x);
  }
  if (typeof x === 'bigint') return makeRatio(x, 1n);
  let r = cache.get(x);
  if (r === undefined) {
    const slash = x.indexOf('/');
    if (slash > 0) r = ratio(x.slice(0, slash).trim(), x.slice(slash + 1).trim());
    else {
      const { digits, scale } = parseDecimal(x);
      r = makeRatio(digits, pow10n(scale));
    }
    if (cache.size >= 1024) cache.clear();
    cache.set(x, r);
  }
  return r;
}

/** num/den -> exact decimal string if the expansion terminates, else null. */
export function ratioToDecimal(r: Ratio): string | null {
  let d = r.den,
    twos = 0,
    fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  if (d !== 1n) return null;
  const scale = Math.max(twos, fives);
  return formatScaled(r.num * (pow10n(scale) / r.den), scale);
}

/** Formats an integer at `scale` as a plain decimal string ("-0.05"). */
const ZPAD = [
  '',
  '0',
  '00',
  '000',
  '0000',
  '00000',
  '000000',
  '0000000',
  '00000000',
  '000000000',
  '0000000000',
  '00000000000',
  '000000000000',
  '0000000000000',
  '00000000000000',
  '000000000000000',
];
export function formatScaled(v: number | bigint, scale: number): string {
  if (typeof v === 'number' && scale <= 15) {
    if (scale === 0) return String(v);
    // integer/fraction split with exact integer arithmetic (the float quotient is corrected)
    const a = v < 0 ? 0 - v : v;
    const p = POW10[scale]!;
    if (a + p <= MAX) {
      let q = Math.floor(a / p);
      let r = a - q * p;
      if (r < 0) {
        q -= 1;
        r += p;
      } else if (r >= p) {
        q += 1;
        r -= p;
      }
      let f = String(r);
      if (f.length < scale) f = ZPAD[scale - f.length] + f;
      return (v < 0 ? '-' : '') + q + '.' + f;
    }
  }
  const neg = v < 0;
  let s = typeof v === 'number' ? String(neg ? 0 - v : v) : (neg ? -v : v).toString();
  if (scale > 0) {
    if (s.length <= scale) s = '0'.repeat(scale - s.length + 1) + s;
    s = s.slice(0, s.length - scale) + '.' + s.slice(s.length - scale);
  }
  return neg ? '-' + s : s;
}
