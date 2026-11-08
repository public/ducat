import { currencyExponent, type CurrencyCode } from './currency.js';
import {
  formatScaled,
  parseDecimal,
  parsePlainDecimal,
  POW10,
  pow10n,
  ratio,
  normalizeMinor,
  type Factor,
  type Ratio,
} from './decimal.js';
import {
  DEFAULT_ROUNDING,
  divideAndRound,
  divideAndRoundBigint,
  RoundingError,
  type RoundingMode,
} from './rounding.js';

// A module-local constant, not an import: the hot loops (sum, add) read it on every iteration, and
// V8 reads an imported binding through an extra indirection.
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

/** Currency codes accepted by constructors: known codes autocomplete, any string is allowed. */
export type CurrencyInput = CurrencyCode | (string & {});

/** The JSON form of Money: an exact decimal string in major units plus the currency code. */
export interface MoneyJSON<C extends string = string> {
  /** Exact decimal string in major units, e.g. "12.34". */
  readonly amount: string;
  readonly currency: C;
}

/**
 * A reusable rounding rule: a scale, an increment at that scale and a rounding mode, such as "CHF
 * cash" (scale 2, increment 5, half up) or "4 decimals, half even". Build one with `roundingPolicy()`
 * from `@ducatjs/money/policy` (or `cashPolicy()` from `@ducatjs/money/cash`) and pass it wherever
 * a rounding mode is accepted: `m.multiply('1.075', policy)`, `m.round(policy)`. A policy is also
 * a function that rounds an amount, so `m.with(policy)` and `amounts.map(policy)` work too.
 *
 * Policies are plain values passed explicitly; they are never stored on amounts or set globally.
 */
export interface RoundingPolicy {
  /** Rounds `money` to this policy (exactly like `round(money, policy)`). */
  <C extends string>(money: Money<C>): Money<C>;
  /** Decimal places of the result; `undefined` means the currency's ISO exponent. */
  readonly scale: number | undefined;
  /** The result is a multiple of this many 10^-scale units (1 for plain rounding, 5 for 0.05). */
  readonly increment: number;
  /** How to round to the increment. */
  readonly rounding: RoundingMode;
  /** The one currency the policy is for, if any; other currencies throw `CurrencyMismatchError`. */
  readonly currency: string | undefined;
  /**
   * @internal money × factor, rounded once to this policy, under a key only this copy of the
   * package can build. The core calls it for every operation given a policy, so the policy code
   * stays out of bundles that never build one.
   */
  readonly [ROUND_PRODUCT]: <C extends string>(money: Money<C>, factor: Ratio) => Money<C>;
}

/**
 * @internal The key a policy's rounding function is stored under. Module-private, so only
 * `roundingPolicy` from this copy of the package makes values the core accepts as policies: a
 * lookalike function, or a policy from a second installed copy (whose results would be that copy's
 * Money), is rejected with a TypeError, as `isMoney` rejects the other copy's Money.
 */
export const ROUND_PRODUCT: unique symbol = Symbol();

/**
 * @internal money × factor rounded by a policy. Anything not built by `roundingPolicy` lacks the
 * private key, so calling it throws a TypeError; that is the whole check, kept this small because
 * it is in every bundle.
 */
export const roundWithPolicy = <C extends string>(
  money: Money<C>,
  factor: Ratio,
  policy: RoundingPolicy,
): Money<C> => policy[ROUND_PRODUCT](money, factor);

/** What rounding parameters accept: a mode such as `'halfEven'`, or a `RoundingPolicy`. */
export type RoundingInput = RoundingMode | RoundingPolicy;

/** Thrown when two amounts in different currencies are combined. */
export class CurrencyMismatchError extends TypeError {
  override name = 'CurrencyMismatchError';
  declare readonly expected: string;
  declare readonly actual: string;
  constructor(expected: string, actual: string) {
    super(`Currency mismatch: ${expected} vs ${actual}`);
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * An immutable amount of money: an integer number of 10^-scale units of `currency`.
 *
 * `minor` is a JS number whenever it is a safe integer (|v| <= 2^53 - 1) and a bigint otherwise, so
 * ordinary amounts never allocate a bigint, and huge or high-precision amounts never lose a digit.
 * `scale` is normally the currency's ISO exponent (2 for EUR) but can be larger for sub-minor
 * precision (unit prices, FX intermediates); `round()` brings it back.
 *
 * Instances are not frozen (Object.freeze costs 5-8x on construction in V8 and JSC; see bench/),
 * but every field is readonly and no operation mutates. Create values with `money()` /
 * `fromMinor()`.
 *
 * The class carries the core methods only. Opt-in modules (`@ducatjs/money/allocate`,
 * `@ducatjs/money/tax`, `@ducatjs/money/format`, ...) add theirs when imported; see `extendMoney`.
 */
class Money<C extends string = string> {
  declare readonly currency: C;
  declare readonly minor: number | bigint;
  declare readonly scale: number;
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
    if (hint === 'string') {
      return this.toString();
    }
    throw new TypeError(
      'Money cannot be converted to a number; use add(), compare(), toDecimal() etc.',
    );
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
  /**
   * this * factor, rounded to this scale. `factor` is exact: integer, decimal string ('1.075'),
   * bigint or ratio().
   */
  multiply(factor: Factor, rounding?: RoundingInput): Money<C> {
    return multiply(this, factor, rounding);
  }
  /** this / divisor, rounded to this scale (or to a policy's scale and increment) */
  divide(divisor: Factor, rounding?: RoundingInput): Money<C> {
    return divide(this, divisor, rounding);
  }
  negate(): Money<C> {
    return negate(this);
  }
  abs(): Money<C> {
    return abs(this);
  }
  /** Rounds to the currency's exponent (or `scale`), or to a rounding policy. */
  round(rounding: RoundingMode, scale?: number): Money<C>;
  round(policy: RoundingPolicy): Money<C>;
  round(rounding: RoundingInput, scale?: number): Money<C> {
    // the free function handles both; the cast only picks its implementation signature
    return round(this, rounding as RoundingMode, scale);
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

  /** Same currency, value and scale: 1.0 EUR is not identical to 1.00 EUR. */
  identical(other: Money): boolean {
    return identical(this, other);
  }
  /**
   * Applies `operation` to this amount and returns its result, so a rounding policy or a
   * conversion reads as one step in a chain: `price.multiply('1.075').with(toCash)`.
   */
  with<R>(operation: (money: Money<C>) => R): R {
    return operation(this);
  }

  // output
  /** The whole major units, truncated toward zero: 12 for 12.34 EUR, -12 for -12.34 EUR. */
  majorPart(): number | bigint {
    return majorPart(this);
  }
  /** The rest in 10^-scale units, with the amount's sign: 34 for 12.34 EUR, -34 for -12.34. */
  minorPart(): number | bigint {
    return minorPart(this);
  }
  /** Exact decimal string in major units: "12.34" */
  toDecimal(): string {
    return formatScaled(this.minor, this.scale);
  }
  /** Minor units as a bigint (BIGINT columns) */
  toMinor(): bigint {
    return toBigInt(this.minor);
  }
  /** Minor units as a number; throws beyond 2^53 */
  toMinorNumber(): number {
    return toMinorNumber(this);
  }
}
export type { Money };

/** Whether a value is a Money from this package. */
export function isMoney(value: unknown): value is Money {
  return value instanceof Money;
}

/**
 * Whether a value is a Money in `currency`. It narrows a currency known only at run time
 * (`Money<string>`, or `unknown`) to the literal type:
 *
 *     if (isMoneyIn(price, 'EUR')) { price.add(money('1', 'EUR')) }
 */
export function isMoneyIn<C extends CurrencyInput>(value: unknown, currency: C): value is Money<C> {
  return value instanceof Money && value.currency === currency;
}

/**
 * Narrows `money` to `Money<C>`, or throws a `CurrencyMismatchError` if it is in another
 * currency. Use it where a different currency is a bug rather than a branch.
 */
export function assertCurrency<C extends CurrencyInput>(
  money: Money,
  currency: C,
): asserts money is Money<C> {
  // A non-Money would otherwise pass when it happens to have a matching `currency` field.
  if (!(money instanceof Money)) {
    throw new TypeError(`Expected Money, got ${typeof money}`);
  }
  if (money.currency !== currency) {
    throw new CurrencyMismatchError(currency, money.currency);
  }
}

/**
 * Which module installed each added method, so a second copy of the same module can replace its
 * own.
 */
const methodOwners = new Map<string, string>();

/**
 * Names `extendMoney` refuses: the ones every object inherits, whose meaning other code relies on.
 * `toLocaleString` is allowed, since a formatting module may want to provide it.
 */
const RESERVED_NAMES = new Set(
  Object.getOwnPropertyNames(Object.prototype).filter((name) => name !== 'toLocaleString'),
);

/** Options for `extendMoney`. */
export interface ExtendMoneyOptions {
  /**
   * Who is installing the methods, e.g. '@ducatjs/money/allocate'. Installing again under the same
   * owner replaces that owner's methods, which happens when a module is loaded twice (hot reload,
   * two copies of the package). Without an owner, or under a different one, an existing name
   * throws.
   */
  readonly owner?: string;
}

/**
 * Adds methods to every Money (this is how `@ducatjs/money/allocate`, `@ducatjs/money/format`, ...
 * install theirs). Declare their types with `declare module '@ducatjs/money' { interface Money<C
 * extends string> { ... } }`. The methods are non-enumerable, like class methods. A name that Money
 * already has (one of its own methods, or one added by a different owner) throws, so two modules
 * cannot silently fight over it.
 */
export function extendMoney(
  methods: Record<string, (this: Money, ...args: never[]) => unknown>,
  options?: ExtendMoneyOptions,
): void {
  const prototype = Money.prototype as unknown as Record<string, unknown>;
  const owner = options?.owner;

  for (const name of Object.keys(methods)) {
    const method = methods[name];

    if (RESERVED_NAMES.has(name)) {
      throw new TypeError(`Money#${name} is reserved`);
    }

    // Replacing an existing method would silently change behaviour for every caller, unless it is
    // the same function or the same owner installing its own methods again.
    const previousOwner = methodOwners.get(name);
    const isOwnReinstall = owner !== undefined && previousOwner === owner;
    if (Object.hasOwn(prototype, name) && prototype[name] !== method && !isOwnReinstall) {
      throw new TypeError(`Money#${name} is already defined`);
    }

    // Non-enumerable, like the class's own methods, so Object.keys and spreads see only the fields.
    Object.defineProperty(prototype, name, {
      value: method,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    if (owner !== undefined) {
      methodOwners.set(name, owner);
    }
  }
}

/** @internal construct from a value that may be an unsafe bigint */
export function make<C extends string>(
  currency: C,
  minor: number | bigint,
  scale: number,
): Money<C> {
  return new Money(currency, typeof minor === 'bigint' ? normalizeMinor(minor) : minor, scale);
}

const toBigInt = (minor: number | bigint) => (typeof minor === 'bigint' ? minor : BigInt(minor));

/** v * 10^e exactly (e >= 0) */
export function scaleUp(minor: number | bigint, exponent: number): number | bigint {
  if (exponent === 0) {
    return minor;
  }
  if (typeof minor === 'number' && exponent <= 15) {
    const scaled = minor * POW10[exponent]!;
    if (scaled <= MAX_SAFE_MINOR && scaled >= -MAX_SAFE_MINOR) {
      return scaled;
    }
  }
  return normalizeMinor(toBigInt(minor) * pow10n(exponent));
}

/** v / 10^e rounded (e >= 0) */
export function scaleDown(
  minor: number | bigint,
  exponent: number,
  mode: RoundingMode,
): number | bigint {
  if (exponent === 0) {
    return minor;
  }
  if (typeof minor === 'number' && exponent <= 15) {
    return divideAndRound(minor, POW10[exponent]!, mode);
  }
  return normalizeMinor(divideAndRoundBigint(toBigInt(minor), pow10n(exponent), mode));
}

// ---------------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------------

/** Options for `money()` and `fromJSON()`: the scale to keep and how to round extra decimals. */
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
    const parsed = parsePlainDecimal(amount) ?? parseDecimal(amount);
    return fromScaled(
      currency,
      parsed.digits,
      parsed.scale,
      scale,
      options?.rounding ?? 'unnecessary',
      amount,
    );
  }
  if (typeof amount === 'number') {
    if (Number.isSafeInteger(amount)) {
      return make(currency, scaleUp(amount, scale), scale);
    }
    if (!Number.isFinite(amount)) {
      throw new RangeError(`Invalid amount ${amount}`);
    }
    const parsed = parseDecimal(String(amount));
    return fromScaled(
      currency,
      parsed.digits,
      parsed.scale,
      scale,
      options?.rounding ?? 'unnecessary',
      amount,
    );
  }
  if (typeof amount === 'bigint') {
    return make(currency, scaleUp(normalizeMinor(amount), scale), scale);
  }
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
  if (typeof digits === 'bigint') {
    digits = normalizeMinor(digits);
  }
  if (from === to) {
    return new Money(currency, digits, to);
  }
  if (from < to) {
    return make(currency, scaleUp(digits, to - from), to);
  }
  try {
    return make(currency, scaleDown(digits, from - to, mode), to);
  } catch (error) {
    if (error instanceof RoundingError) {
      throw new RoundingError(
        `${String(input)} has more than ${to} decimal places for ${currency}; pass { rounding } or { scale }`,
      );
    }
    throw error;
  }
}

/**
 * Creates money from an integer count of minor units (cents): `fromMinor(1234, 'EUR')` is 12.34
 * EUR. This is the form to read from a BIGINT column or a payment processor (but see
 * `stripe`/`adyen` for processors whose exponent differs from ISO).
 */
export function fromMinor<C extends CurrencyInput>(
  minor: number | bigint,
  currency: C,
  scale?: number,
): Money<C> {
  const resolvedScale = scale ?? currencyExponent(currency);
  if (typeof minor === 'number') {
    if (!Number.isSafeInteger(minor)) {
      throw new RangeError(`Minor units must be a safe integer, got ${minor}; pass a bigint`);
    }
    return new Money(currency, minor + 0, resolvedScale);
  }
  if (typeof minor !== 'bigint') {
    throw new TypeError(`Invalid minor units ${String(minor)}`);
  }
  return make(currency, minor, resolvedScale);
}

/** Zero in a currency, at its exponent (or `scale`). */
export function zero<C extends CurrencyInput>(currency: C, scale?: number): Money<C> {
  return new Money(currency, 0, scale ?? currencyExponent(currency));
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

function mismatch(money: Money, other: Money): never {
  throw new CurrencyMismatchError(money.currency, other.currency);
}

function addUsingBigInt<C extends string>(money: Money<C>, other: Money, sign: 1 | -1): Money<C> {
  const scale = Math.max(money.scale, other.scale);
  const left = toBigInt(scaleUp(money.minor, scale - money.scale));
  const right = toBigInt(scaleUp(other.minor, scale - other.scale));
  return make(money.currency, sign === 1 ? left + right : left - right, scale);
}

/**
 * a + b. Mixing currencies is a type error for literal currency types and a runtime error
 * otherwise.
 */
export function add<C extends string>(money: Money<C>, other: Money<NoInfer<C>>): Money<C> {
  if (money.currency !== other.currency) {
    mismatch(money, other);
  }
  const left = money.minor;
  const right = other.minor;
  if (typeof left === 'number' && typeof right === 'number' && money.scale === other.scale) {
    // exact whenever |sum| <= MAX_SAFE_MINOR: both inputs are safe integers
    const sum = left + right;
    if (sum <= MAX_SAFE_MINOR && sum >= -MAX_SAFE_MINOR) {
      return new Money(money.currency, sum, money.scale);
    }
  }
  return addUsingBigInt(money, other, 1);
}

/** a - b */
export function subtract<C extends string>(money: Money<C>, other: Money<NoInfer<C>>): Money<C> {
  if (money.currency !== other.currency) {
    mismatch(money, other);
  }
  const left = money.minor;
  const right = other.minor;
  if (typeof left === 'number' && typeof right === 'number' && money.scale === other.scale) {
    const difference = left - right;
    if (difference <= MAX_SAFE_MINOR && difference >= -MAX_SAFE_MINOR) {
      return new Money(money.currency, difference + 0, money.scale);
    }
  }
  return addUsingBigInt(money, other, -1);
}

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
/**
 * Rejects arrays whose element type mixes several literal currencies, e.g. (Money<'EUR'> |
 * Money<'USD'>)[].
 */
type SingleCurrency<C extends string> =
  true extends IsUnion<C> ? { readonly 'mixed currencies are not allowed': C } : unknown;

/** Sum of a list (same currency; any scale). An empty list needs `currency` and returns zero. */
export function sum<C extends string>(
  items: readonly Money<C>[] & SingleCurrency<C>,
  currency?: NoInfer<C>,
): Money<C> {
  const count = items.length;
  if (count === 0) {
    if (currency === undefined) {
      throw new RangeError('sum() of an empty list needs a currency');
    }
    return zero(currency);
  }

  let total = items[0]!;
  if (currency !== undefined && total.currency !== currency) {
    throw new CurrencyMismatchError(currency, total.currency);
  }
  const itemCurrency = total.currency;
  const scale = total.scale;

  // Fast loop on plain numbers: each partial sum of safe integers is exact while it stays within
  // MAX_SAFE_MINOR. It falls back to add() at the first bigint, scale change or overflow. NaN marks
  // "no fast total".
  let fastTotal = typeof total.minor === 'number' ? total.minor : NaN;
  let i = 1;
  for (; i < count && fastTotal === fastTotal; i++) {
    const item = items[i]!;
    if (item.currency !== itemCurrency) {
      mismatch(total, item);
    }
    if (typeof item.minor !== 'number' || item.scale !== scale) {
      break;
    }
    const next = fastTotal + item.minor;
    if (!(next <= MAX_SAFE_MINOR && next >= -MAX_SAFE_MINOR)) {
      break;
    }
    fastTotal = next;
  }
  if (fastTotal === fastTotal) {
    total = new Money(itemCurrency, fastTotal, scale);
  }

  for (; i < count; i++) {
    total = add(total, items[i]!);
  }
  return total;
}

/** -money */
export function negate<C extends string>(money: Money<C>): Money<C> {
  const minor = money.minor;
  return new Money(
    money.currency,
    typeof minor === 'number' ? 0 - minor : normalizeMinor(-minor),
    money.scale,
  );
}

/** |money| */
export function abs<C extends string>(money: Money<C>): Money<C> {
  return money.minor < 0 ? negate(money) : money;
}

/**
 * m * factor, rounded to m's scale. `factor` is exact: an integer, a decimal string ('1.075'), a
 * bigint, or a `ratio()`. Rounding defaults to 'halfExpand' (ties away from zero); pass
 * 'unnecessary' to throw instead.
 */
export function multiply<C extends string>(
  money: Money<C>,
  factor: Factor,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const minor = money.minor;
  // An integer product is exact at this scale, but a policy may ask for another scale or increment.
  if (
    typeof factor === 'number' &&
    Number.isSafeInteger(factor) &&
    typeof minor === 'number' &&
    typeof rounding === 'string'
  ) {
    const product = minor * factor;
    if (product <= MAX_SAFE_MINOR && product >= -MAX_SAFE_MINOR) {
      return new Money(money.currency, product + 0, money.scale);
    }
  }
  return multiplyByRatio(money, ratio(factor), rounding);
}

/** @internal m * r, rounded with a mode (at `scale`) or with a policy (at the policy's scale) */
export function multiplyByRatio<C extends string>(
  money: Money<C>,
  factor: Ratio,
  rounding: RoundingInput,
  scale = money.scale,
): Money<C> {
  if (typeof rounding === 'function') {
    return roundWithPolicy(money, factor, rounding);
  }
  const minor = money.minor;
  if (
    typeof minor === 'number' &&
    scale === money.scale &&
    factor.n === factor.n &&
    factor.d === factor.d
  ) {
    // exact when |product| <= MAX_SAFE_MINOR (both factors are safe integers)
    const product = minor * factor.n;
    if (product <= MAX_SAFE_MINOR && product >= -MAX_SAFE_MINOR) {
      return new Money(money.currency, divideAndRound(product, factor.d, rounding), scale);
    }
  }
  let numerator = toBigInt(minor) * factor.num;
  let denominator = factor.den;
  if (scale > money.scale) {
    numerator *= pow10n(scale - money.scale);
  } else if (scale < money.scale) {
    denominator *= pow10n(money.scale - scale);
  }
  return make(money.currency, divideAndRoundBigint(numerator, denominator, rounding), scale);
}

/** m / divisor, rounded to m's scale (default 'halfExpand'), or with a rounding policy. */
export function divide<C extends string>(
  money: Money<C>,
  divisor: Factor,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const divisorRatio = ratio(divisor);
  if (divisorRatio.num === 0n) {
    throw new RangeError('Division by zero');
  }

  // Fast path: m / (n/d) = m·d / n, rounded once by the same kernel the ratio path uses. Building
  // the inverse ratio d/n would cost bigint arithmetic and a gcd on every call; the divisor's own
  // ratio is cached for small integers and strings. Why it is exact:
  // - makeRatio guarantees d > 0 and n/d in lowest terms, so m·d / n is the same fraction the
  //   inverse ratio d/n would give, and only n's sign needs handling;
  // - `x === x` is false only for NaN, which is how a Ratio marks a part that is not a safe
  //   integer, so both parts are safe integers here;
  // - m and d are safe integers, so a float product beyond 2^53 - 1 cannot round back down into
  //   the safe range: the bound check below rejects every inexact product;
  // - divideAndRound corrects its float quotient exactly (and takes the bigint kernel itself when
  //   dividend + divisor exceeds the safe range).
  // A rounding policy (a function, not a mode string) must not take this path: it rounds to its own
  // scale and increment.
  const minor = money.minor;
  const numerator = divisorRatio.n;
  const denominator = divisorRatio.d;
  if (
    typeof minor === 'number' &&
    typeof rounding === 'string' &&
    numerator === numerator &&
    denominator === denominator
  ) {
    let dividend = minor * denominator;
    if (dividend <= MAX_SAFE_MINOR && dividend >= -MAX_SAFE_MINOR) {
      // divideAndRound needs a positive divisor: (−p)/(−n) is the same quotient
      let positiveDivisor = numerator;
      if (numerator < 0) {
        dividend = 0 - dividend;
        positiveDivisor = 0 - numerator;
      }
      return new Money(
        money.currency,
        divideAndRound(dividend, positiveDivisor, rounding),
        money.scale,
      );
    }
  }

  return multiplyByRatio(money, ratio(divisorRatio.den, divisorRatio.num), rounding);
}

/**
 * Rounds to the currency's exponent (or `scale`): `round(money('1.005', 'EUR', {scale: 3}),
 * 'halfEven')`.
 */
export function round<C extends string>(
  money: Money<C>,
  rounding: RoundingMode,
  scale?: number,
): Money<C>;
/** Rounds to a policy's scale and increment: `round(money('10.03', 'CHF'), cashPolicy('CHF'))`. */
export function round<C extends string>(money: Money<C>, policy: RoundingPolicy): Money<C>;
export function round<C extends string>(
  money: Money<C>,
  rounding: RoundingInput,
  scale?: number,
): Money<C> {
  if (typeof rounding === 'function') {
    return roundWithPolicy(money, ratio(1), rounding);
  }
  return toScale(money, scale ?? currencyExponent(money.currency), rounding);
}

/**
 * Changes the scale; increasing it is always exact, decreasing it rounds (default 'halfExpand').
 */
export function toScale<C extends string>(
  money: Money<C>,
  scale: number,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Money<C> {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`Invalid scale ${scale}`);
  }
  if (scale === money.scale) {
    return money;
  }
  if (scale > money.scale) {
    return make(money.currency, scaleUp(money.minor, scale - money.scale), scale);
  }
  return make(money.currency, scaleDown(money.minor, money.scale - scale, rounding), scale);
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

/** -1, 0 or 1. Throws on currency mismatch. Works across scales and number/bigint. */
export function compare<C extends string>(money: Money<C>, other: Money<NoInfer<C>>): -1 | 0 | 1 {
  if (money.currency !== other.currency) {
    mismatch(money, other);
  }
  let left = money.minor;
  let right = other.minor;
  if (money.scale !== other.scale) {
    const scale = Math.max(money.scale, other.scale);
    left = scaleUp(left, scale - money.scale);
    right = scaleUp(right, scale - other.scale);
  }
  // number < bigint comparisons are exact in JS
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/**
 * Same currency and same value (1.0 EUR at scale 1 equals 1.00 EUR). Different currencies: false.
 */
export function equals(money: Money, other: Money): boolean {
  if (money.currency !== other.currency) {
    return false;
  }
  if (money.scale === other.scale) {
    // == compares number and bigint exactly
    return money.minor == other.minor;
  }
  return compare(money, other) === 0;
}

/**
 * Same currency, same value *and* same scale, with number and bigint minor units counted as equal.
 * `equals` treats 1.0 EUR (scale 1) and 1.00 EUR as equal; `identical` does not. For round-trip
 * tests, where the scale must survive too.
 */
export function identical(money: Money, other: Money): boolean {
  return (
    money.currency === other.currency && money.scale === other.scale && money.minor == other.minor
  );
}

/** money < other (same currency; any scale). */
export const lessThan = <C extends string>(money: Money<C>, other: Money<NoInfer<C>>): boolean =>
  compare(money, other) < 0;
/** money <= other */
export const lessThanOrEqual = <C extends string>(
  money: Money<C>,
  other: Money<NoInfer<C>>,
): boolean => compare(money, other) <= 0;
/** money > other */
export const greaterThan = <C extends string>(money: Money<C>, other: Money<NoInfer<C>>): boolean =>
  compare(money, other) > 0;
/** money >= other */
export const greaterThanOrEqual = <C extends string>(
  money: Money<C>,
  other: Money<NoInfer<C>>,
): boolean => compare(money, other) >= 0;

/** Whether the amount is zero. */
export const isZero = (money: Money): boolean => money.minor == 0;
/** Whether the amount is greater than zero. */
export const isPositive = (money: Money): boolean => money.minor > 0;
/** Whether the amount is less than zero. */
export const isNegative = (money: Money): boolean => money.minor < 0;
/** 1, 0 or -1 for positive, zero and negative amounts. */
export const sign = (money: Money): -1 | 0 | 1 => {
  if (money.minor > 0) {
    return 1;
  }
  return money.minor < 0 ? -1 : 0;
};

/** The smallest of the amounts (same currency); the first one wins ties. */
export function min<C extends string>(first: Money<C>, ...rest: Money<NoInfer<C>>[]): Money<C> {
  let smallest = first;
  for (const candidate of rest) {
    if (compare(candidate, smallest) < 0) {
      smallest = candidate;
    }
  }
  return smallest;
}
/** The largest of the amounts (same currency); the first one wins ties. */
export function max<C extends string>(first: Money<C>, ...rest: Money<NoInfer<C>>[]): Money<C> {
  let largest = first;
  for (const candidate of rest) {
    if (compare(candidate, largest) > 0) {
      largest = candidate;
    }
  }
  return largest;
}
/** Limits m to [lo, hi]. */
export function clamp<C extends string>(
  money: Money<C>,
  lo: Money<NoInfer<C>>,
  hi: Money<NoInfer<C>>,
): Money<C> {
  if (compare(lo, hi) > 0) {
    throw new RangeError('clamp(): lo > hi');
  }
  if (compare(money, lo) < 0) {
    return lo;
  }
  return compare(money, hi) > 0 ? hi : money;
}

// ---------------------------------------------------------------------------------------------
// Serialisation primitives
// ---------------------------------------------------------------------------------------------

/**
 * Exact decimal string in major units: "12.34", "-0.05", "1000" (JPY). For NUMERIC/DECIMAL columns.
 */
export function toDecimal(money: Money): string {
  return formatScaled(money.minor, money.scale);
}

/**
 * The whole major units, truncated toward zero: 12 for 12.34 EUR and -12 for -12.34 EUR. A number
 * while it is a safe integer, a bigint beyond, like `minor`.
 */
export function majorPart(money: Money): number | bigint {
  const minor = money.minor;
  if (typeof minor === 'number' && money.scale <= 15) {
    // Taking the remainder out first leaves an exact multiple, so the division is exact. `+ 0`
    // turns -0 into 0.
    const unit = POW10[money.scale]!;
    return (minor - (minor % unit)) / unit + 0;
  }
  // bigint division truncates toward zero, like the fast path
  return normalizeMinor(toBigInt(minor) / pow10n(money.scale));
}

/**
 * What is left after `majorPart`, in 10^-scale units and with the amount's sign: 34 for 12.34
 * EUR, -34 for -12.34 EUR, 5 for 1.005 EUR at scale 3.
 */
export function minorPart(money: Money): number | bigint {
  const minor = money.minor;
  if (typeof minor === 'number' && money.scale <= 15) {
    // % on safe integers is exact and keeps the dividend's sign; `+ 0` turns -0 into 0.
    return (minor % POW10[money.scale]!) + 0;
  }
  return normalizeMinor(toBigInt(minor) % pow10n(money.scale));
}

/** Minor units as a bigint (always safe; use for BIGINT columns). */
export function toMinor(money: Money): bigint {
  return toBigInt(money.minor);
}

/** Minor units as a number; throws if not a safe integer. */
export function toMinorNumber(money: Money): number {
  if (typeof money.minor === 'bigint') {
    throw new RangeError(`${money} does not fit in a safe integer; use toMinor()`);
  }
  return money.minor;
}

/** Parses `{ amount: "12.34", currency: "EUR" }` (as produced by JSON.stringify(money)). */
export function fromJSON<C extends CurrencyInput = CurrencyInput>(
  json: MoneyJSON<C> | string,
  options?: MoneyOptions,
): Money<C> {
  const parsed = typeof json === 'string' ? (JSON.parse(json) as MoneyJSON<C>) : json;
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof parsed.amount !== 'string' ||
    typeof parsed.currency !== 'string'
  ) {
    throw new TypeError('Expected { amount: string, currency: string }');
  }
  return money(parsed.amount, parsed.currency, options);
}

export type { Factor, Ratio } from './decimal.js';
export { ratio } from './decimal.js';
