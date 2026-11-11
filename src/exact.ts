// ExactMoney: an exact rational amount for chains of arithmetic that should round once, at the end.
// It has no formatting, JSON or minor units on purpose: it must be rounded back to Money before it
// leaves the process.
import { currencyExponent } from './currency.js';
import { checkScale, pow10n, ratio, type Factor } from './decimal.js';
import { CurrencyMismatchError, make, type Money } from './money.js';
import type { Rate } from './rate.js';
import { DEFAULT_ROUNDING, divideAndRoundBigint, type RoundingMode } from './rounding.js';

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

  /** this + other, exactly. */
  add(other: ExactMoney<C>): ExactMoney<C> {
    assertSameCurrency(this, other);
    const numerator = this.num * other.den + other.num * this.den;
    return new ExactMoney(this.currency, numerator, this.den * other.den);
  }

  /** this − other, exactly. */
  subtract(other: ExactMoney<C>): ExactMoney<C> {
    return this.add(other.negate());
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

  /** −1, 0 or 1. */
  compare(other: ExactMoney<C>): -1 | 0 | 1 {
    assertSameCurrency(this, other);
    // Both denominators are positive, so cross-multiplying keeps the order.
    const left = this.num * other.den;
    const right = other.num * this.den;
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  }

  /** Same currency and the same exact value. */
  equals(other: ExactMoney): boolean {
    return this.currency === other.currency && this.num === other.num && this.den === other.den;
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

  /** Whether the amount fits `scale` (default: the currency's exponent) without rounding. */
  isExact(scale: number = currencyExponent(this.currency)): boolean {
    return (this.num * pow10n(checkScale(scale))) % this.den === 0n;
  }

  /** Rounds once to `scale` (default: the currency's exponent). */
  round(
    rounding: RoundingMode = DEFAULT_ROUNDING,
    scale: number = currencyExponent(this.currency),
  ): Money<C> {
    const minor = divideAndRoundBigint(this.num * pow10n(checkScale(scale)), this.den, rounding);
    return make(this.currency, minor, scale);
  }

  /** Rounds once and reports the difference, for booking it (e.g. an "FX rounding" ledger line). */
  roundWithResidual(rounding: RoundingMode = DEFAULT_ROUNDING, scale?: number): Rounded<C> {
    const value = this.round(rounding, scale);
    const residual = this.subtract(exact(value));
    return { value, residual };
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
