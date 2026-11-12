import { currencyExponent, type CurrencyCode } from './currency.js';
import {
  formatScaled,
  faithfulDecimal,
  checkScale,
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
// MAX_DECIMAL_SCALE from decimal.ts, kept local: the scale checks below run on every toScale and on
// every fromMinor with a scale, where an imported constant (or a call into decimal.ts) costs a
// lookup. test/scale-validation.test.ts checks the two stay equal.
const MAX_SCALE = 1000;

/** A valid scale: an integer from 0 to MAX_SCALE (`>>> 0` changes negatives, fractions and NaN). */
// Stryker disable next-line ArrowFunction: checkScale makes the same decision
const isValidScale = (scale: number): boolean => scale >>> 0 === scale && scale <= MAX_SCALE;

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

/**
 * The other operand of an operation on a `Money<C>`: a Money of the same currency type, or a
 * `Money<string>` whose currency is only known at run time (from a database or an API), which is
 * checked at run time. A different literal currency (`Money<'USD'>` beside `Money<'EUR'>`) or a
 * union of them is a compile error; narrow it with `isMoneyIn` or `assertCurrency` first.
 */
export type MoneyOperand<C extends string, O extends string = C> =
  | Money<C>
  | (string extends O ? Money<O> : never);

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
const methodOwners = /* @__PURE__ */ new Map<string, string>();

/**
 * Names `extendMoney` refuses: the ones every object inherits, whose meaning other code relies on.
 * `toLocaleString` is allowed, since a formatting module may want to provide it.
 */
const RESERVED_NAMES = /* @__PURE__ */ new Set(
  /* @__PURE__ */ Object.getOwnPropertyNames(Object.prototype).filter(
    (name) => name !== 'toLocaleString',
  ),
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

// the names installCoreMethods has installed, so loading it again replaces its own methods only
const coreMethodNames = /* @__PURE__ */ new Set<string>();

/**
 * @internal Installs the core methods (src/plugins/core.ts) on Money.prototype, non-enumerable like
 * class methods. Kept apart from `extendMoney`, whose name checks the methods bundle doesn't need.
 */
export function installCoreMethods(methods: Record<string, unknown>): void {
  // A program that imports only /fn can extendMoney a core name; the root entry must not then
  // replace it silently. Reinstalling the core methods themselves (core.js loaded again, as hot
  // reload does) is fine. Every name is checked before any is installed, so a throw changes nothing.
  for (const name in methods) {
    if (Object.hasOwn(Money.prototype, name) && !coreMethodNames.has(name)) {
      throw new TypeError(`Money#${name} was defined before the core methods were installed`);
    }
  }
  for (const name in methods) {
    coreMethodNames.add(name);
    Object.defineProperty(Money.prototype, name, {
      value: methods[name],
      writable: true,
      configurable: true,
      enumerable: false,
    });
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

// Stryker disable next-line StringLiteral: BigInt() of a bigint is the same bigint
const toBigInt = (minor: number | bigint) => (typeof minor === 'bigint' ? minor : BigInt(minor));

// scaleUp and scaleDown have a copy in src/scale.ts, for Fixed, which must not load this module;
// test/fixed.test.ts checks that the copies agree.

/** v * 10^e exactly (e >= 0) */
export function scaleUp(minor: number | bigint, exponent: number): number | bigint {
  // Stryker disable next-line BlockStatement: fast path, the bigint path agrees
  if (exponent === 0) {
    return minor;
  }
  // Stryker disable next-line BlockStatement,StringLiteral: fast path, the bigint path agrees
  if (typeof minor === 'number' && exponent <= 15) {
    const scaled = minor * POW10[exponent]!;
    // Stryker disable next-line BlockStatement,UnaryOperator: fast path, the bigint path agrees
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
  // Stryker disable next-line BlockStatement: fast path, the bigint path agrees
  if (exponent === 0) {
    return minor;
  }
  // Stryker disable next-line BlockStatement,StringLiteral: fast path, the bigint path agrees
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
 * A string is an optional sign, ASCII digits, optionally a point with digits after it, and
 * optionally an exponent (`'1.5e3'`); `'.5'`, `'5.'`, grouping and surrounding whitespace throw a
 * SyntaxError (use `parse()` for text as people write it).
 *
 * Throws if the amount has more decimals than the currency (or `scale`) unless `rounding` is given,
 * so `money(0.1 + 0.2, 'EUR')` throws rather than silently becoming 0.30. Without `rounding`, a
 * number whose shortest form has more than 15 significant digits throws a RangeError too.
 */
export function money<C extends CurrencyInput>(
  amount: string | number | bigint,
  currency: C,
  options?: MoneyOptions,
): Money<C> {
  const scale = resolveScale(currency, options?.scale);
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
    // Stryker disable next-line BlockStatement: fast path, the bigint path agrees
    if (Number.isSafeInteger(amount)) {
      return make(currency, scaleUp(amount, scale), scale);
    }
    if (!Number.isFinite(amount)) {
      throw new RangeError(`Invalid amount ${amount}`);
    }
    const rounding = options?.rounding;
    const parsed = parseDecimal(String(amount));
    const result = fromScaled(
      currency,
      parsed.digits,
      parsed.scale,
      scale,
      rounding ?? 'unnecessary',
      amount,
    );
    // Only an explicit rounding mode says a float's extra digits may be dropped. Checked after
    // fromScaled, so 0.1 + 0.2 at EUR's scale is still a RoundingError for its decimals.
    if (rounding === undefined) {
      faithfulDecimal(amount, 'pass a string, or { rounding }');
    }
    return result;
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
  // Stryker disable next-line BlockStatement: shortcut, scaling by 10^0 agrees
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
  const resolvedScale = resolveScale(currency, scale);
  if (typeof minor === 'number') {
    if (!Number.isSafeInteger(minor)) {
      // A bigint only helps an integer too large to be safe; a fraction needs a different fix.
      throw new RangeError(
        Number.isInteger(minor)
          ? `Minor units must be a safe integer, got ${minor}; pass a bigint`
          : `Minor units must be an integer, got ${minor}`,
      );
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
  return new Money(currency, 0, resolveScale(currency, scale));
}

/**
 * @internal The scale to build a value at: `scale`, or the currency's exponent. The currency is
 * looked up either way, because an explicit scale doesn't make an unknown code valid.
 */
export function resolveScale(currency: string, scale: number | undefined): number {
  const exponent = currencyExponent(currency);
  if (scale === undefined || isValidScale(scale)) {
    return scale ?? exponent;
  }
  return checkScale(scale); // throws the shared message
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

function mismatch(money: Money, other: Money): never {
  // only reached on the error path, so this check costs correct calls nothing
  if (!((other as unknown) instanceof Money)) {
    throw new TypeError(`Expected Money, got ${typeof other}`);
  }
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
export function add<C extends string, O extends string = C>(
  money: Money<C>,
  other: MoneyOperand<NoInfer<C>, O>,
): Money<C> {
  if (money.currency !== other.currency) {
    mismatch(money, other);
  }
  const left = money.minor;
  const right = other.minor;
  // Stryker disable next-line BlockStatement,StringLiteral: fast path, the bigint path agrees
  if (typeof left === 'number' && typeof right === 'number' && money.scale === other.scale) {
    // exact whenever |sum| <= MAX_SAFE_MINOR: both inputs are safe integers
    const sum = left + right;
    // Stryker disable next-line BlockStatement,UnaryOperator: fast path, the bigint path agrees
    if (sum <= MAX_SAFE_MINOR && sum >= -MAX_SAFE_MINOR) {
      return new Money(money.currency, sum, money.scale);
    }
  }
  return addUsingBigInt(money, other, 1);
}

/** a - b */
export function subtract<C extends string, O extends string = C>(
  money: Money<C>,
  other: MoneyOperand<NoInfer<C>, O>,
): Money<C> {
  if (money.currency !== other.currency) {
    mismatch(money, other);
  }
  const left = money.minor;
  const right = other.minor;
  // Stryker disable next-line BlockStatement,StringLiteral: fast path, the bigint path agrees
  if (typeof left === 'number' && typeof right === 'number' && money.scale === other.scale) {
    const difference = left - right;
    // Stryker disable next-line BlockStatement,UnaryOperator: fast path, the bigint path agrees
    if (difference <= MAX_SAFE_MINOR && difference >= -MAX_SAFE_MINOR) {
      return new Money(money.currency, difference + 0, money.scale);
    }
  }
  return addUsingBigInt(money, other, -1);
}

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
/**
 * @internal Rejects arrays whose element type mixes several literal currencies, e.g. (Money<'EUR'>
 * | Money<'USD'>)[].
 */
export type SingleCurrency<C extends string> =
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
  // Stryker disable next-line StringLiteral: fast path, the bigint path agrees
  let fastTotal = typeof total.minor === 'number' ? total.minor : NaN;
  let i = 1;
  for (; i < count && fastTotal === fastTotal; i++) {
    const item = items[i]!;
    if (item.currency !== itemCurrency) {
      mismatch(total, item);
    }
    // Stryker disable next-line StringLiteral: fast path, the bigint path agrees
    if (typeof item.minor !== 'number' || item.scale !== scale) {
      break;
    }
    const next = fastTotal + item.minor;
    // Stryker disable next-line UnaryOperator: fast path, the bigint path agrees
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
    // Stryker disable next-line EqualityOperator,StringLiteral: fast path, the bigint path agrees
    typeof factor === 'number' &&
    Number.isSafeInteger(factor) &&
    // Stryker disable next-line StringLiteral: fast path, the bigint path agrees
    typeof minor === 'number' &&
    // Stryker disable next-line StringLiteral: fast path, the bigint path agrees
    typeof rounding === 'string'
    // Stryker disable next-line BlockStatement: fast path, the bigint path agrees
  ) {
    const product = minor * factor;
    // Stryker disable next-line BlockStatement,UnaryOperator: fast path, the bigint path agrees
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
    // Stryker disable next-line StringLiteral: fast path, the bigint path agrees
    typeof minor === 'number' &&
    scale === money.scale &&
    // Stryker disable next-line ConditionalExpression,EqualityOperator: a NaN part fails the bound check below
    factor.n === factor.n &&
    factor.d === factor.d
    // Stryker disable next-line BlockStatement: fast path, the bigint path agrees
  ) {
    // exact when |product| <= MAX_SAFE_MINOR (both factors are safe integers)
    const product = minor * factor.n;
    // Stryker disable next-line BlockStatement,UnaryOperator: fast path, the bigint path agrees
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
  // divideSafeByRatio in rounding.ts is the same steps as a function, for Fixed; a call here costs
  // about 4% on the divide benchmarks. test/divide.test.ts checks that the two copies agree.
  const minor = money.minor;
  const numerator = divisorRatio.n;
  const denominator = divisorRatio.d;
  if (
    // Stryker disable next-line StringLiteral: fast path, the bigint path agrees
    typeof minor === 'number' &&
    // Stryker disable next-line StringLiteral: fast path, the bigint path agrees
    typeof rounding === 'string' &&
    numerator === numerator &&
    // Stryker disable next-line ConditionalExpression,EqualityOperator: a NaN part fails the bound check below
    denominator === denominator
    // Stryker disable next-line BlockStatement: fast path, the bigint path agrees
  ) {
    let dividend = minor * denominator;
    // Stryker disable next-line BlockStatement,UnaryOperator: fast path, the bigint path agrees
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
 * 'halfEven')`. A scale is never negative: round to tens or hundreds with an increment
 * (`roundingPolicy({ scale: 0, increment: 100 })`, or `roundToIncrement` from `/cash`).
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
 * Scales are integers from 0 to 1000; for tens or hundreds, use an increment (a rounding policy, or
 * `roundToIncrement` from `/cash`).
 */
export function toScale<C extends string>(
  money: Money<C>,
  scale: number,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Money<C> {
  // a value's own scale is always valid, so this needs no check
  // Stryker disable next-line BlockStatement: shortcut, scaling by 10^0 agrees
  if (scale === money.scale) {
    return money;
  }
  if (!isValidScale(scale)) {
    checkScale(scale); // throws the shared message
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
export function compare<C extends string, O extends string = C>(
  money: Money<C>,
  other: MoneyOperand<NoInfer<C>, O>,
): -1 | 0 | 1 {
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
  // Stryker disable next-line BlockStatement: shortcut, compare() agrees
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
export const lessThan = <C extends string, O extends string = C>(
  money: Money<C>,
  other: MoneyOperand<NoInfer<C>, O>,
): boolean => compare(money, other) < 0;
/** money <= other */
export const lessThanOrEqual = <C extends string, O extends string = C>(
  money: Money<C>,
  other: MoneyOperand<NoInfer<C>, O>,
): boolean => compare(money, other) <= 0;
/** money > other */
export const greaterThan = <C extends string, O extends string = C>(
  money: Money<C>,
  other: MoneyOperand<NoInfer<C>, O>,
): boolean => compare(money, other) > 0;
/** money >= other */
export const greaterThanOrEqual = <C extends string, O extends string = C>(
  money: Money<C>,
  other: MoneyOperand<NoInfer<C>, O>,
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
export function min<C extends string, O extends string = C>(
  first: Money<C>,
  ...rest: MoneyOperand<NoInfer<C>, O>[]
): Money<C> {
  let smallest = first;
  // compare() checks each currency at run time, so the operands are Money<C> from here on
  for (const candidate of rest as Money<C>[]) {
    if (compare(candidate, smallest) < 0) {
      smallest = candidate;
    }
  }
  return smallest;
}
/** The largest of the amounts (same currency); the first one wins ties. */
export function max<C extends string, O extends string = C>(
  first: Money<C>,
  ...rest: MoneyOperand<NoInfer<C>, O>[]
): Money<C> {
  let largest = first;
  for (const candidate of rest as Money<C>[]) {
    if (compare(candidate, largest) > 0) {
      largest = candidate;
    }
  }
  return largest;
}
/** Limits m to [lo, hi]. */
export function clamp<C extends string, O extends string = C>(
  money: Money<C>,
  lo: MoneyOperand<NoInfer<C>, O>,
  hi: MoneyOperand<NoInfer<C>, O>,
): Money<C> {
  const low = lo as Money<C>;
  const high = hi as Money<C>;
  if (compare(low, high) > 0) {
    throw new RangeError('clamp(): lo > hi');
  }
  if (compare(money, low) < 0) {
    return low;
  }
  return compare(money, high) > 0 ? high : money;
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
  // Stryker disable next-line BlockStatement,StringLiteral: fast path, the bigint path agrees
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
  // Stryker disable next-line BlockStatement,StringLiteral: fast path, the bigint path agrees
  if (typeof minor === 'number' && money.scale <= 15) {
    // % on safe integers is exact and keeps the dividend's sign; `+ 0` turns -0 into 0.
    return (minor % POW10[money.scale]!) + 0;
  }
  return normalizeMinor(toBigInt(minor) % pow10n(money.scale));
}

/**
 * Whether the amount has a non-zero fractional part: true for 12.34 EUR, -0.05 EUR and 1.005 EUR,
 * false for 12.00 EUR and for 12.000 EUR at scale 3. Display code uses it to drop ".00" from whole
 * amounts; dinero.js calls it `hasSubUnits`.
 */
export function hasFraction(money: Money): boolean {
  const minor = money.minor;
  // Stryker disable next-line BlockStatement,StringLiteral: fast path, the bigint path agrees
  if (typeof minor === 'number' && money.scale <= 15) {
    return minor % POW10[money.scale]! !== 0;
  }
  return toBigInt(minor) % pow10n(money.scale) !== 0n;
}

/**
 * Units of the currency's minor unit (cents for EUR) as a bigint, for BIGINT columns and APIs that
 * take ISO 4217 minor units. Exact at any scale: 1.5 EUR at scale 1 is 150n, and 12.340 EUR at
 * scale 3 is 1234n. Throws RoundingError when the amount has non-zero digits below the minor unit
 * (12.345 EUR); round() it first. For units of the value's own scale, use `toScaledUnits`.
 */
export function toMinor(money: Money): bigint {
  const shift = currencyExponent(money.currency) - money.scale;
  const scaled = toBigInt(money.minor);

  // At or below the exponent, scaling up is exact.
  if (shift >= 0) {
    return scaled * pow10n(shift);
  }

  // Above it, the conversion is exact only when the extra digits are all zero.
  const divisor = pow10n(-shift);
  if (scaled % divisor !== 0n) {
    throw new RoundingError(`${money} has digits below the minor unit; round() it first`);
  }
  return scaled / divisor;
}

/** Options for `toMinorNumber`. */
export interface ToMinorNumberOptions {
  /**
   * Return the nearest double instead of throwing a RangeError beyond 2^53 (Number.MAX_SAFE_INTEGER):
   * lossy on purpose, for charts and APIs that take numbers, and ±Infinity beyond the largest
   * double. It waives only that check: digits below the minor unit still throw a RoundingError
   * (round() first, or use toNumber() for a float in major units).
   */
  readonly lossy?: boolean;
}

/**
 * Like `toMinor`, as a number. Throws RoundingError for digits below the minor unit, and a
 * RangeError when the result isn't a safe integer, unless `{ lossy: true }` asks for the nearest
 * double instead.
 */
export function toMinorNumber(money: Money, options?: ToMinorNumberOptions): number {
  // The common case, a number at the currency's exponent, needs no conversion.
  // Stryker disable next-line BlockStatement,StringLiteral: fast path, the bigint path agrees
  if (typeof money.minor === 'number' && money.scale === currencyExponent(money.currency)) {
    return money.minor;
  }

  const exactMinor = toMinor(money);
  const minor = normalizeMinor(exactMinor);
  if (typeof minor === 'bigint') {
    if (options?.lossy === true) {
      // Number(bigint) rounds to the nearest double, ties to even.
      return Number(exactMinor);
    }
    throw new RangeError(`${money} does not fit in a safe integer; use toMinor()`);
  }
  return minor;
}

/**
 * The amount in major units as the nearest double: 12.34 for 12.34 EUR. Lossy on purpose, for
 * display, charts and APIs that take numbers; beyond a double's 15 to 17 significant digits the
 * value is rounded (once, to the nearest double), and beyond the largest double it is ±Infinity, as
 * Number() and Fixed#toNumber() give. Never do arithmetic on the result.
 */
export function toNumber(money: Money): number {
  // Parsing the exact decimal string is correctly rounded; dividing minor by 10^scale rounds twice.
  return Number(formatScaled(money.minor, money.scale));
}

/**
 * The amount in units of 10^-scale, as a bigint: 12340n for 12.340 EUR at scale 3. Store it
 * together with the scale (as the scale-column helpers do); for the currency's minor units, use
 * `toMinor`.
 */
export function toScaledUnits(money: Money): bigint {
  return toBigInt(money.minor);
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
