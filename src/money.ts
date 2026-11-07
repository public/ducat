import { currencyExponent, type CurrencyCode } from './currency.js';
import {
  formatScaled,
  MAX,
  parseDecimal,
  parsePlainDecimal,
  POW10,
  pow10n,
  ratio,
  toSafe,
  type Factor,
  type Ratio,
} from './decimal.js';
import { DEFAULT_ROUNDING, divRound, divRoundBig, RoundingError, type RoundingMode } from './rounding.js';

/** Currency codes accepted by constructors: known codes autocomplete, any string is allowed. */
export type CurrencyInput = CurrencyCode | (string & {});

export interface MoneyJSON<C extends string = string> {
  /** Exact decimal string in major units, e.g. "12.34". */
  readonly amount: string;
  readonly currency: C;
}

/** Thrown when two amounts in different currencies are combined. */
export class CurrencyMismatchError extends TypeError {
  override name = 'CurrencyMismatchError';
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Currency mismatch: ${expected} vs ${actual}`);
  }
}

/**
 * An immutable amount of money: an integer number of 10^-scale units of `currency`.
 *
 * `minor` is a JS number whenever it is a safe integer (|v| <= 2^53 - 1) and a bigint otherwise,
 * so ordinary amounts never allocate a bigint, and huge or high-precision amounts never lose a digit.
 * `scale` is normally the currency's ISO exponent (2 for EUR) but can be larger for sub-minor precision
 * (unit prices, FX intermediates); `round()` brings it back.
 *
 * Instances are not frozen (Object.freeze costs 5-8x on construction in V8 and JSC; see bench/),
 * but every field is readonly and no operation mutates. Create values with `money()` / `fromMinor()`.
 *
 * The class carries the core methods only. Opt-in modules (`@ducatjs/money/allocate`, `@ducatjs/money/tax`, `@ducatjs/money/format`, ...)
 * add theirs when imported; see `extendMoney`.
 */
class Money<C extends string = string> {
  readonly currency: C;
  readonly minor: number | bigint;
  readonly scale: number;
  /** @internal */
  constructor(currency: C, minor: number | bigint, scale: number) {
    this.currency = currency;
    this.minor = minor;
    this.scale = scale;
  }
  /** "12.34 EUR" */
  toString(): string {
    return `${formatScaled(this.minor, this.scale)} ${this.currency}`;
  }
  toJSON(): MoneyJSON<C> {
    return { amount: formatScaled(this.minor, this.scale), currency: this.currency };
  }
  /** Blocks `a + b`, `a > b`, `+a`: arithmetic and comparison must go through the library. */
  [Symbol.toPrimitive](hint: string): string {
    if (hint === 'string') return this.toString();
    throw new TypeError('Money is not a number; use its methods');
  }

  // Methods. Each one is a thin wrapper over the free function of the same name (also exported), so
  // `a.add(b)` and `add(a, b)` are the same code. Operands are Money only: a bare number is never
  // guessed to mean major or minor units.

  // arithmetic
  /** this + other (same currency; any scale) */
  add(other: Money<C>): Money<C> {
    return add(this, other);
  }
  /** this - other */
  subtract(other: Money<C>): Money<C> {
    return subtract(this, other);
  }
  /** this * factor, rounded to this scale. `factor` is exact: integer, decimal string ('1.075'), bigint or ratio(). */
  multiply(factor: Factor, rounding?: RoundingMode): Money<C> {
    return multiply(this, factor, rounding);
  }
  /** this / divisor, rounded to this scale */
  divide(divisor: Factor, rounding?: RoundingMode): Money<C> {
    return divide(this, divisor, rounding);
  }
  negate(): Money<C> {
    return negate(this);
  }
  abs(): Money<C> {
    return abs(this);
  }
  /** Rounds to the currency's exponent (or `scale`). */
  round(rounding: RoundingMode, scale?: number): Money<C> {
    return round(this, rounding, scale);
  }
  /** Changes the scale; decreasing it rounds (default 'halfExpand'). */
  toScale(scale: number, rounding?: RoundingMode): Money<C> {
    return toScale(this, scale, rounding);
  }
  // comparison
  /** -1, 0 or 1; throws on currency mismatch */
  compare(other: Money<C>): -1 | 0 | 1 {
    return compare(this, other);
  }
  /** same currency and value; a different currency is simply not equal */
  equals(other: Money): boolean {
    return equals(this, other);
  }
  lessThan(other: Money<C>): boolean {
    return compare(this, other) < 0;
  }
  lessThanOrEqual(other: Money<C>): boolean {
    return compare(this, other) <= 0;
  }
  greaterThan(other: Money<C>): boolean {
    return compare(this, other) > 0;
  }
  greaterThanOrEqual(other: Money<C>): boolean {
    return compare(this, other) >= 0;
  }
  isZero(): boolean {
    return this.minor == 0;
  }
  isPositive(): boolean {
    return this.minor > 0;
  }
  isNegative(): boolean {
    return this.minor < 0;
  }
  sign(): -1 | 0 | 1 {
    return sign(this);
  }
  min(...others: Money<C>[]): Money<C> {
    return min(this, ...others);
  }
  max(...others: Money<C>[]): Money<C> {
    return max(this, ...others);
  }
  clamp(lo: Money<C>, hi: Money<C>): Money<C> {
    return clamp(this, lo, hi);
  }

  // output
  /** Exact decimal string in major units: "12.34" */
  toDecimal(): string {
    return formatScaled(this.minor, this.scale);
  }
  /** Minor units as a bigint (BIGINT columns) */
  toMinor(): bigint {
    return big(this.minor);
  }
  /** Minor units as a number; throws beyond 2^53 */
  toMinorNumber(): number {
    return toMinorNumber(this);
  }
}
export type { Money };

export function isMoney(x: unknown): x is Money {
  return x instanceof Money;
}

/**
 * Adds methods to every Money (this is how `@ducatjs/money/allocate`, `@ducatjs/money/format`, ... install theirs).
 * Declare their types with `declare module '@ducatjs/money' { interface Money<C extends string> { ... } }`.
 * The methods are non-enumerable, like class methods. Re-installing the same function is a no-op;
 * replacing a different one throws, so two plugins cannot silently fight over a name.
 */
export function extendMoney(methods: Record<string, (this: Money, ...args: never[]) => unknown>): void {
  const prototype = Money.prototype as unknown as Record<string, unknown>;

  for (const name of Object.keys(methods)) {
    const method = methods[name];

    // Installing the same function twice (a module imported through two paths) is harmless;
    // replacing a different one would silently change behaviour for every caller.
    if (name in prototype && prototype[name] !== method) {
      throw new TypeError(`Money#${name} is already defined`);
    }

    // Non-enumerable, like the class's own methods, so Object.keys and spreads see only the fields.
    Object.defineProperty(prototype, name, {
      value: method,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

/** @internal construct from a value that may be an unsafe bigint */
export function make<C extends string>(currency: C, v: number | bigint, scale: number): Money<C> {
  return new Money(currency, typeof v === 'bigint' ? toSafe(v) : v, scale);
}

const big = (v: number | bigint) => (typeof v === 'bigint' ? v : BigInt(v));

/** v * 10^e exactly (e >= 0) */
export function scaleUp(v: number | bigint, e: number): number | bigint {
  if (e === 0) return v;
  if (typeof v === 'number' && e <= 15) {
    const r = v * POW10[e]!;
    if (r <= MAX && r >= -MAX) return r;
  }
  return toSafe(big(v) * pow10n(e));
}

/** v / 10^e rounded (e >= 0) */
export function scaleDown(v: number | bigint, e: number, mode: RoundingMode): number | bigint {
  if (e === 0) return v;
  if (typeof v === 'number' && e <= 15) return divRound(v, POW10[e]!, mode);
  return toSafe(divRoundBig(big(v), pow10n(e), mode));
}

// ---------------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------------

export interface MoneyOptions {
  /** Decimal places to keep (default: the currency's exponent). */
  readonly scale?: number;
  /** How to round input with more decimals than `scale` (default 'unnecessary': throw). */
  readonly rounding?: RoundingMode;
}

/**
 * Creates money from an amount in major units.
 *
 *     money('12.34', 'EUR')   // exact decimal string: the recommended form
 *     money(12, 'EUR')        // integers are major units: 12.00 EUR
 *     money(12.34, 'EUR')     // non-integer numbers are read at their shortest decimal form ("12.34")
 *     money(10n ** 30n, 'USD')
 *
 * Throws if the amount has more decimals than the currency (or `scale`) unless `rounding` is given,
 * so `money(0.1 + 0.2, 'EUR')` throws rather than silently becoming 0.30.
 */
export function money<C extends CurrencyInput>(
  amount: string | number | bigint,
  currency: C,
  options?: MoneyOptions,
): Money<C> {
  const scale = options?.scale ?? currencyExponent(currency);
  if (typeof amount === 'string') {
    const p = parsePlainDecimal(amount) ?? parseDecimal(amount);
    return fromScaled(currency, p.digits, p.scale, scale, options?.rounding ?? 'unnecessary', amount);
  }
  if (typeof amount === 'number') {
    if (Number.isSafeInteger(amount)) return make(currency, scaleUp(amount, scale), scale);
    if (!Number.isFinite(amount)) throw new RangeError(`Invalid amount ${amount}`);
    const p = parseDecimal(String(amount));
    return fromScaled(currency, p.digits, p.scale, scale, options?.rounding ?? 'unnecessary', amount);
  }
  if (typeof amount === 'bigint') return make(currency, scaleUp(toSafe(amount), scale), scale);
  throw new TypeError(`Invalid amount ${String(amount)}`);
}

function fromScaled<C extends string>(
  currency: C,
  digits: number | bigint,
  from: number,
  to: number,
  mode: RoundingMode,
  input: unknown,
): Money<C> {
  if (typeof digits === 'bigint') digits = toSafe(digits);
  if (from === to) return new Money(currency, digits, to);
  if (from < to) return make(currency, scaleUp(digits, to - from), to);
  try {
    return make(currency, scaleDown(digits, from - to, mode), to);
  } catch (e) {
    if (e instanceof RoundingError)
      throw new RoundingError(
        `${String(input)} has over ${to} decimals for ${currency}; pass { rounding }`,
      );
    throw e;
  }
}

/**
 * Creates money from an integer count of minor units (cents): `fromMinor(1234, 'EUR')` is 12.34 EUR.
 * This is the form to read from a BIGINT column or a payment processor (but see `stripe`/`adyen`
 * for processors whose exponent differs from ISO).
 */
export function fromMinor<C extends CurrencyInput>(minor: number | bigint, currency: C, scale?: number): Money<C> {
  const s = scale ?? currencyExponent(currency);
  if (typeof minor === 'number') {
    if (!Number.isSafeInteger(minor))
      throw new RangeError(`Minor units must be a safe integer, got ${minor}; pass a bigint`);
    return new Money(currency, minor + 0, s);
  }
  if (typeof minor !== 'bigint') throw new TypeError(`Invalid minor units ${String(minor)}`);
  return make(currency, minor, s);
}

export function zero<C extends CurrencyInput>(currency: C, scale?: number): Money<C> {
  return new Money(currency, 0, scale ?? currencyExponent(currency));
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

function mismatch(a: Money, b: Money): never {
  throw new CurrencyMismatchError(a.currency, b.currency);
}

function addSlow<C extends string>(a: Money<C>, b: Money, sign: 1 | -1): Money<C> {
  const s = Math.max(a.scale, b.scale);
  const x = big(scaleUp(a.minor, s - a.scale));
  const y = big(scaleUp(b.minor, s - b.scale));
  return make(a.currency, sign === 1 ? x + y : x - y, s);
}

/** a + b. Mixing currencies is a type error for literal currency types and a runtime error otherwise. */
export function add<C extends string>(a: Money<C>, b: Money<NoInfer<C>>): Money<C> {
  if (a.currency !== b.currency) mismatch(a, b);
  const x = a.minor,
    y = b.minor;
  if (typeof x === 'number' && typeof y === 'number' && a.scale === b.scale) {
    const r = x + y; // exact whenever |r| <= MAX: both inputs are safe integers
    if (r <= MAX && r >= -MAX) return new Money(a.currency, r, a.scale);
  }
  return addSlow(a, b, 1);
}

/** a - b */
export function subtract<C extends string>(a: Money<C>, b: Money<NoInfer<C>>): Money<C> {
  if (a.currency !== b.currency) mismatch(a, b);
  const x = a.minor,
    y = b.minor;
  if (typeof x === 'number' && typeof y === 'number' && a.scale === b.scale) {
    const r = x - y;
    if (r <= MAX && r >= -MAX) return new Money(a.currency, r + 0, a.scale);
  }
  return addSlow(a, b, -1);
}

/** Sum of a list. An empty list needs `currency` (and returns zero). */
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
/** Rejects arrays whose element type mixes several literal currencies, e.g. (Money<'EUR'> | Money<'USD'>)[]. */
type SingleCurrency<C extends string> =
  true extends IsUnion<C> ? { readonly 'mixed currencies are not allowed': C } : unknown;

export function sum<C extends string>(items: readonly Money<C>[] & SingleCurrency<C>, currency?: NoInfer<C>): Money<C> {
  const n = items.length;
  if (n === 0) {
    if (currency === undefined) throw new RangeError('sum() of an empty list needs a currency');
    return zero(currency);
  }
  let acc = items[0]!;
  if (currency !== undefined && acc.currency !== currency) throw new CurrencyMismatchError(currency, acc.currency);
  let fast = typeof acc.minor === 'number' ? (acc.minor as number) : NaN;
  const cur = acc.currency,
    scale = acc.scale;
  let i = 1;
  // fast loop on plain numbers; falls back to add() at the first bigint, scale change or overflow
  for (; i < n && fast === fast; i++) {
    const m = items[i]!;
    if (m.currency !== cur) mismatch(acc, m);
    if (typeof m.minor !== 'number' || m.scale !== scale) break;
    const r = fast + m.minor;
    if (!(r <= MAX && r >= -MAX)) break;
    fast = r;
  }
  if (fast === fast) acc = new Money(cur, fast, scale);
  for (; i < n; i++) acc = add(acc, items[i]!);
  return acc;
}

export function negate<C extends string>(m: Money<C>): Money<C> {
  const v = m.minor;
  return new Money(m.currency, typeof v === 'number' ? 0 - v : toSafe(-v), m.scale);
}

export function abs<C extends string>(m: Money<C>): Money<C> {
  return m.minor < 0 ? negate(m) : m;
}

/**
 * m * factor, rounded to m's scale. `factor` is exact: an integer, a decimal string ('1.075'),
 * a bigint, or a `ratio()`. Rounding defaults to 'halfExpand' (ties away from zero); pass 'unnecessary' to throw instead.
 */
export function multiply<C extends string>(
  m: Money<C>,
  factor: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Money<C> {
  const x = m.minor;
  if (typeof factor === 'number' && Number.isSafeInteger(factor) && typeof x === 'number') {
    const p = x * factor;
    if (p <= MAX && p >= -MAX) return new Money(m.currency, p + 0, m.scale);
  }
  return mulRatio(m, ratio(factor), rounding);
}

/** @internal m * r, rounded */
export function mulRatio<C extends string>(m: Money<C>, r: Ratio, rounding: RoundingMode, scale = m.scale): Money<C> {
  const x = m.minor;
  if (typeof x === 'number' && scale === m.scale && r.n === r.n && r.d === r.d) {
    const p = x * r.n; // exact when |p| <= MAX (both factors are safe integers)
    if (p <= MAX && p >= -MAX) return new Money(m.currency, divRound(p, r.d, rounding), scale);
  }
  let num = big(x) * r.num;
  let den = r.den;
  if (scale > m.scale) num *= pow10n(scale - m.scale);
  else if (scale < m.scale) den *= pow10n(m.scale - scale);
  return make(m.currency, divRoundBig(num, den, rounding), scale);
}

/** m / divisor, rounded to m's scale (default 'halfExpand'). */
export function divide<C extends string>(
  m: Money<C>,
  divisor: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Money<C> {
  const r = ratio(divisor);
  if (r.num === 0n) throw new RangeError('Division by zero');
  return mulRatio(m, ratio(r.den, r.num), rounding);
}

/** Rounds to the currency's exponent (or `scale`): `round(money('1.005', 'EUR', {scale: 3}), 'halfEven')`. */
export function round<C extends string>(m: Money<C>, rounding: RoundingMode, scale?: number): Money<C> {
  return toScale(m, scale ?? currencyExponent(m.currency), rounding);
}

/** Changes the scale; increasing it is always exact, decreasing it rounds (default 'halfExpand'). */
export function toScale<C extends string>(
  m: Money<C>,
  scale: number,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Money<C> {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError(`Invalid scale ${scale}`);
  if (scale === m.scale) return m;
  if (scale > m.scale) return make(m.currency, scaleUp(m.minor, scale - m.scale), scale);
  return make(m.currency, scaleDown(m.minor, m.scale - scale, rounding), scale);
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

/** -1, 0 or 1. Throws on currency mismatch. Works across scales and number/bigint. */
export function compare<C extends string>(a: Money<C>, b: Money<NoInfer<C>>): -1 | 0 | 1 {
  if (a.currency !== b.currency) mismatch(a, b);
  let x = a.minor,
    y = b.minor;
  if (a.scale !== b.scale) {
    const s = Math.max(a.scale, b.scale);
    x = scaleUp(x, s - a.scale);
    y = scaleUp(y, s - b.scale);
  }
  // number < bigint comparisons are exact in JS
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Same currency and same value (1.0 EUR at scale 1 equals 1.00 EUR). Different currencies: false. */
export function equals(a: Money, b: Money): boolean {
  if (a.currency !== b.currency) return false;
  if (a.scale === b.scale) return a.minor == b.minor; // == compares number and bigint exactly
  return compare(a, b) === 0;
}

export const lessThan = <C extends string>(a: Money<C>, b: Money<NoInfer<C>>): boolean => compare(a, b) < 0;
export const lessThanOrEqual = <C extends string>(a: Money<C>, b: Money<NoInfer<C>>): boolean => compare(a, b) <= 0;
export const greaterThan = <C extends string>(a: Money<C>, b: Money<NoInfer<C>>): boolean => compare(a, b) > 0;
export const greaterThanOrEqual = <C extends string>(a: Money<C>, b: Money<NoInfer<C>>): boolean => compare(a, b) >= 0;

export const isZero = (m: Money): boolean => m.minor == 0;
export const isPositive = (m: Money): boolean => m.minor > 0;
export const isNegative = (m: Money): boolean => m.minor < 0;
export const sign = (m: Money): -1 | 0 | 1 => (m.minor > 0 ? 1 : m.minor < 0 ? -1 : 0);

export function min<C extends string>(first: Money<C>, ...rest: Money<NoInfer<C>>[]): Money<C> {
  let r = first;
  for (const m of rest) if (compare(m, r) < 0) r = m;
  return r;
}
export function max<C extends string>(first: Money<C>, ...rest: Money<NoInfer<C>>[]): Money<C> {
  let r = first;
  for (const m of rest) if (compare(m, r) > 0) r = m;
  return r;
}
/** Limits m to [lo, hi]. */
export function clamp<C extends string>(m: Money<C>, lo: Money<NoInfer<C>>, hi: Money<NoInfer<C>>): Money<C> {
  if (compare(lo, hi) > 0) throw new RangeError('clamp(): lo > hi');
  return compare(m, lo) < 0 ? lo : compare(m, hi) > 0 ? hi : m;
}

// ---------------------------------------------------------------------------------------------
// Serialisation primitives
// ---------------------------------------------------------------------------------------------

/** Exact decimal string in major units: "12.34", "-0.05", "1000" (JPY). For NUMERIC/DECIMAL columns. */
export function toDecimal(m: Money): string {
  return formatScaled(m.minor, m.scale);
}

/** Minor units as a bigint (always safe; use for BIGINT columns). */
export function toMinor(m: Money): bigint {
  return big(m.minor);
}

/** Minor units as a number; throws if not a safe integer. */
export function toMinorNumber(m: Money): number {
  if (typeof m.minor === 'bigint') throw new RangeError(`${m} is unsafe as a number; use toMinor()`);
  return m.minor;
}

/** Parses `{ amount: "12.34", currency: "EUR" }` (as produced by JSON.stringify(money)). */
export function fromJSON<C extends CurrencyInput = CurrencyInput>(
  json: MoneyJSON<C> | string,
  options?: MoneyOptions,
): Money<C> {
  const o = typeof json === 'string' ? (JSON.parse(json) as MoneyJSON<C>) : json;
  if (o === null || typeof o !== 'object' || typeof o.amount !== 'string' || typeof o.currency !== 'string')
    throw new TypeError('Expected { amount: string, currency: string }');
  return money(o.amount, o.currency, options);
}

export type { Factor, Ratio } from './decimal.js';
export { ratio } from './decimal.js';
