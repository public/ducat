// ExactMoney: an exact rational amount for chains of arithmetic that should round once, at the end.
// It has no formatting, JSON or minor units on purpose: it must be rounded back to Money before it
// leaves the process. The one exception is toNumber(), an explicitly lossy double for display.
import { currencyExponent } from './currency.js';
import {
  checkScale,
  MAX_DECIMAL_SCALE,
  pow10n,
  ratio,
  type Factor,
  type Ratio,
} from './decimal.js';
import {
  CurrencyMismatchError,
  make,
  roundWithPolicy,
  type Money,
  type RoundingInput,
  type RoundingPolicy,
} from './money.js';
import type { Rate } from './rate.js';
import {
  DEFAULT_ROUNDING,
  divideAndRoundBigint,
  RoundingError,
  type RoundingMode,
} from './rounding.js';

/**
 * A rounded value and what rounding left out: `value + residual` is exactly the unrounded amount.
 */
export interface Rounded<C extends string> {
  readonly value: Money<C>;
  readonly residual: ExactMoney<C>;
}

/**
 * An exact amount of `currency`: num/den major units, reduced, den > 0. Build it with `exact()`.
 */
export class ExactMoney<C extends string = string> {
  readonly currency: C;
  readonly num: bigint;
  readonly den: bigint;

  /** @internal use exact() */
  constructor(currency: C, numerator: bigint, denominator: bigint) {
    const reduced = ratio(numerator, denominator); // reduces and makes the denominator positive
    this.currency = currency;
    this.num = reduced.num;
    this.den = reduced.den;
  }

  /** this + other, exactly; `other` may be a Money of the same currency. */
  add(other: ExactMoney<C> | Money<C>): ExactMoney<C> {
    const right = toExact(other);
    assertSameCurrency(this, right);
    const numerator = this.num * right.den + right.num * this.den;
    return new ExactMoney(this.currency, numerator, this.den * right.den);
  }

  /** this − other, exactly; `other` may be a Money of the same currency. */
  subtract(other: ExactMoney<C> | Money<C>): ExactMoney<C> {
    return this.add(toExact(other).negate());
  }

  /** −this. */
  negate(): ExactMoney<C> {
    return new ExactMoney(this.currency, -this.num, this.den);
  }

  /** this × factor, exactly. */
  multiply(factor: Factor): ExactMoney<C> {
    const factorRatio = ratio(factor);
    return new ExactMoney(this.currency, this.num * factorRatio.num, this.den * factorRatio.den);
  }

  /** this ÷ divisor, exactly. */
  divide(divisor: Factor): ExactMoney<C> {
    const divisorRatio = ratio(divisor);
    if (divisorRatio.num === 0n) {
      throw new RangeError('Division by zero');
    }
    return new ExactMoney(this.currency, this.num * divisorRatio.den, this.den * divisorRatio.num);
  }

  /** Converts exactly at `rate`; nothing is rounded. */
  convert<To extends string>(rate: Rate<C, To>): ExactMoney<To> {
    if (rate.from !== this.currency) {
      throw new CurrencyMismatchError(rate.from, this.currency);
    }
    return new ExactMoney(rate.to, this.num * rate.ratio.num, this.den * rate.ratio.den);
  }

  /** |this|. */
  abs(): ExactMoney<C> {
    return this.num < 0n ? this.negate() : this;
  }

  /** percent% of this, exactly: `exact(m).percentage('7.7')`. */
  percentage(percent: Factor): ExactMoney<C> {
    const percentRatio = ratio(percent);
    return this.multiply(ratio(percentRatio.num, percentRatio.den * 100n));
  }

  /** The exact share this / total as a Ratio (same currency), as `ratioOf` in `/math`. */
  ratioOf(total: ExactMoney<C> | Money<C>): Ratio {
    const right = toExact(total);
    assertSameCurrency(this, right);
    if (right.num === 0n) {
      throw new RangeError('Division by zero');
    }
    return ratio(this.num * right.den, this.den * right.num);
  }

  /** −1, 0 or 1; `other` may be a Money of the same currency. */
  compare(other: ExactMoney<C> | Money<C>): -1 | 0 | 1 {
    const operand = toExact(other);
    assertSameCurrency(this, operand);
    // Both denominators are positive, so cross-multiplying keeps the order.
    const left = this.num * operand.den;
    const right = operand.num * this.den;
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  }

  /** Same currency and the same exact value; `other` may be a Money (at any scale). */
  equals(other: ExactMoney | Money): boolean {
    const operand = toExact(other);
    return (
      this.currency === operand.currency && this.num === operand.num && this.den === operand.den
    );
  }

  lessThan(other: ExactMoney<C> | Money<C>): boolean {
    return this.compare(other) < 0;
  }

  lessThanOrEqual(other: ExactMoney<C> | Money<C>): boolean {
    return this.compare(other) <= 0;
  }

  greaterThan(other: ExactMoney<C> | Money<C>): boolean {
    return this.compare(other) > 0;
  }

  greaterThanOrEqual(other: ExactMoney<C> | Money<C>): boolean {
    return this.compare(other) >= 0;
  }

  /** The smallest of this and `others` (same currency); the first one wins ties. */
  min(...others: (ExactMoney<C> | Money<C>)[]): ExactMoney<C> {
    return others.reduce<ExactMoney<C>>((smallest, other) => {
      const candidate = toExact(other);
      return candidate.compare(smallest) < 0 ? candidate : smallest;
    }, this);
  }

  /** The largest of this and `others` (same currency); the first one wins ties. */
  max(...others: (ExactMoney<C> | Money<C>)[]): ExactMoney<C> {
    return others.reduce<ExactMoney<C>>((largest, other) => {
      const candidate = toExact(other);
      return candidate.compare(largest) > 0 ? candidate : largest;
    }, this);
  }

  /** Limits this to [lo, hi]. */
  clamp(lo: ExactMoney<C> | Money<C>, hi: ExactMoney<C> | Money<C>): ExactMoney<C> {
    if (toExact(lo).compare(hi) > 0) {
      throw new RangeError('clamp: lo > hi');
    }
    return this.max(lo).min(hi);
  }

  /** −1, 0 or 1. */
  sign(): -1 | 0 | 1 {
    if (this.num > 0n) {
      return 1;
    }
    if (this.num < 0n) {
      return -1;
    }
    return 0;
  }

  /** Whether the amount is zero. */
  isZero(): boolean {
    return this.num === 0n;
  }

  /** Whether the amount is above zero. */
  isPositive(): boolean {
    return this.num > 0n;
  }

  /** Whether the amount is below zero. */
  isNegative(): boolean {
    return this.num < 0n;
  }

  /** Whether the amount fits `scale` (default: the currency's exponent) without rounding. */
  isExact(scale: number = currencyExponent(this.currency)): boolean {
    return (this.num * pow10n(checkScale(scale))) % this.den === 0n;
  }

  /** Rounds once to `scale` (default: the currency's exponent). */
  round(rounding?: RoundingMode, scale?: number): Money<C>;
  /** Rounds once to a policy's scale and increment: `exact(m).divide(3).round(cashPolicy('CHF'))`. */
  round(policy: RoundingPolicy): Money<C>;
  round(rounding: RoundingInput = DEFAULT_ROUNDING, scale?: number): Money<C> {
    if (typeof rounding === 'function') {
      // num/den is num units at scale 0 times 1/den: the policy rounds that product once.
      return roundWithPolicy(make(this.currency, this.num, 0), ratio(1n, this.den), rounding);
    }
    const resultScale = scale ?? currencyExponent(this.currency);
    const minor = divideAndRoundBigint(
      this.num * pow10n(checkScale(resultScale)),
      this.den,
      rounding,
    );
    return make(this.currency, minor, resultScale);
  }

  /**
   * The exact value as Money, at the smallest scale that holds it but at least `minimumScale`
   * (default: the currency's exponent): 1/8 EUR is 0.125 EUR. Throws a RoundingError when the
   * value has no finite decimal form (10/3), naming the need for round(), and a RangeError when it
   * needs more than 1000 decimal places.
   */
  toMoney(minimumScale: number = currencyExponent(this.currency)): Money<C> {
    checkScale(minimumScale);
    const scale = Math.max(minimumScale, decimalPlaces(this.den, this));
    return make(this.currency, (this.num * pow10n(scale)) / this.den, scale);
  }

  /** Rounds once and reports the difference, for booking it (e.g. an "FX rounding" ledger line). */
  roundWithResidual(rounding?: RoundingMode, scale?: number): Rounded<C>;
  roundWithResidual(policy: RoundingPolicy): Rounded<C>;
  roundWithResidual(rounding: RoundingInput = DEFAULT_ROUNDING, scale?: number): Rounded<C> {
    const value =
      typeof rounding === 'function' ? this.round(rounding) : this.round(rounding, scale);
    const residual = this.subtract(exact(value));
    return { value, residual };
  }

  /**
   * The amount in major units as the nearest double: 10/3 EUR is 3.3333333333333335. Lossy on
   * purpose, for display, charts and APIs that take numbers; never do arithmetic on the result.
   * Beyond the largest double it is ±Infinity, as Number() gives.
   */
  toNumber(): number {
    const magnitude = this.num < 0n ? -this.num : this.num;
    // Shift so the quotient has 65 or 66 bits: Number() then rounds it to 53 bits exactly once,
    // with a sticky low bit standing for a non-zero remainder, so no tie is invented.
    const shift = 65 - magnitude.toString(2).length + this.den.toString(2).length;
    const scaled = shift > 0 ? magnitude << BigInt(shift) : magnitude;
    const divisor = shift > 0 ? this.den : this.den << BigInt(-shift);
    const quotient = scaled / divisor;
    const half = -shift >> 1;
    // Two power-of-two steps, since 2 ** -shift alone can overflow or underflow; both are exact
    // unless the result is subnormal (below 2^-1022), far below any amount.
    const value =
      Number(quotient * divisor === scaled ? quotient : quotient | 1n) *
      2 ** half *
      2 ** (-shift - half);
    return this.num < 0n ? -value : value;
  }

  /** "10/3 EUR", for debugging only. */
  toString(): string {
    if (this.den === 1n) {
      return `${this.num} ${this.currency}`;
    }
    return `${this.num}/${this.den} ${this.currency}`;
  }

  /** Blocks `a + b` and `a > b`: round() first. */
  [Symbol.toPrimitive](hint: string): string {
    if (hint === 'string') {
      return this.toString();
    }
    throw new TypeError('ExactMoney cannot be converted to a number; round() it first');
  }
}

/** The decimal places 1/den needs (den > 0, reduced against the numerator), or a throw. */
function decimalPlaces(den: bigint, value: ExactMoney): number {
  // A fraction terminates exactly when its denominator is 2^twos × 5^fives; it then needs
  // max(twos, fives) places.
  let rest = den;
  let twos = 0;
  let fives = 0;
  while ((rest & 1n) === 0n) {
    rest >>= 1n;
    twos++;
  }
  while (rest % 5n === 0n) {
    rest /= 5n;
    fives++;
  }
  if (rest !== 1n) {
    throw new RoundingError(`${value} has no finite decimal form; round() it with a rounding mode`);
  }
  const places = Math.max(twos, fives);
  if (places > MAX_DECIMAL_SCALE) {
    throw new RangeError(`${value} needs ${places} decimal places, more than ${MAX_DECIMAL_SCALE}`);
  }
  return places;
}

/**
 * money × factor exactly, as Money: the scale grows to hold every digit (never below the amount's
 * own), so 10.00 EUR × 1.0775 is 10.775 EUR and 10.00 EUR × 2 stays 20.00 EUR. Throws a
 * RoundingError when the product has no finite decimal form (a factor such as 1/3); use
 * `multiply` with a rounding mode, or `exact()`, then.
 */
export function multiplyExact<C extends string>(money: Money<C>, factor: Factor): Money<C> {
  return exact(money).multiply(factor).toMoney(money.scale);
}

function toExact<C extends string>(amount: ExactMoney<C> | Money<C>): ExactMoney<C> {
  return amount instanceof ExactMoney ? amount : exact(amount);
}

function assertSameCurrency(money: ExactMoney, other: ExactMoney): void {
  if (money.currency !== other.currency) {
    throw new CurrencyMismatchError(money.currency, other.currency);
  }
}

/**
 * The exact value of `money`, for chained arithmetic: `exact(price).divide(3).round('halfEven')`.
 */
export function exact<C extends string>(money: Money<C>): ExactMoney<C> {
  return new ExactMoney(money.currency, BigInt(money.minor), pow10n(money.scale));
}

/**
 * The exact sum (zero of `currency` for an empty list). Round it once for a batch's rounding line.
 */
export function sumExact<C extends string>(
  items: readonly ExactMoney<C>[],
  currency?: C,
): ExactMoney<C> {
  const sumCurrency = currency ?? items[0]?.currency;
  if (sumCurrency === undefined) {
    throw new RangeError('sumExact of an empty list needs a currency');
  }
  let sum = new ExactMoney(sumCurrency, 0n, 1n);
  for (const item of items) {
    sum = sum.add(item);
  }
  return sum;
}

/** A tax split in exact amounts: net + tax is exactly gross, and nothing is rounded yet. */
export interface ExactTaxBreakdown<C extends string> {
  readonly net: ExactMoney<C>;
  readonly tax: ExactMoney<C>;
  readonly gross: ExactMoney<C>;
}

const asExact = <C extends string>(amount: Money<C> | ExactMoney<C>): ExactMoney<C> =>
  amount instanceof ExactMoney ? amount : exact(amount);

/**
 * Tax-exclusive, exactly: adds percent% tax to a net amount and rounds nothing.
 * addTaxExact(EUR 10.01, '7.7') -> net 10.01, tax 0.77077, gross 10.78077. Sum the parts over many
 * rows and round each total once.
 */
export function addTaxExact<C extends string>(
  net: Money<C> | ExactMoney<C>,
  percent: Factor,
): ExactTaxBreakdown<C> {
  const exactNet = asExact(net);
  const percentRatio = ratio(percent);
  const tax = exactNet.multiply(ratio(percentRatio.num, percentRatio.den * 100n));
  return { net: exactNet, tax, gross: exactNet.add(tax) };
}

/**
 * Tax-inclusive, exactly: the net is gross / (1 + percent/100), unrounded, and the tax the exact
 * rest. extractTaxExact(EUR 12, '20') -> net 10, tax 2; with 7.7% the net doesn't terminate, so a
 * report sums the exact nets and rounds once.
 */
export function extractTaxExact<C extends string>(
  gross: Money<C> | ExactMoney<C>,
  percent: Factor,
): ExactTaxBreakdown<C> {
  const exactGross = asExact(gross);
  const percentRatio = ratio(percent);
  // 1 / (1 + p/100) = 100 den / (100 den + num)
  const net = exactGross.multiply(
    ratio(100n * percentRatio.den, 100n * percentRatio.den + percentRatio.num),
  );
  return { net, tax: exactGross.subtract(net), gross: exactGross };
}

/** Whether `value` is an ExactMoney. */
export function isExactMoney(value: unknown): value is ExactMoney {
  return value instanceof ExactMoney;
}
