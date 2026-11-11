/**
 * The core Money methods (`a.add(b)`, `m.round('halfEven')`, `m.toDecimal()`...), installed on
 * import. The root entry (`@ducatjs/money`) and `/all` import this, so methods are always there for
 * them; `@ducatjs/money/fn` doesn't, so a program written with plain functions keeps only the
 * functions it uses. Each method is a thin wrapper over the free function of the same name, so
 * `a.add(b)` and `add(a, b)` are the same code. Operands are Money only: a bare number is never
 * guessed to mean major or minor units.
 */
// every ISO 4217 code, so the root entry and /all take any code as a string
import './iso.js';
import { formatScaled, type Factor } from '../decimal.js';
import type { Money } from '../index.js';
import {
  abs,
  add,
  clamp,
  compare,
  divide,
  equals,
  installCoreMethods,
  identical,
  majorPart,
  max,
  min,
  minorPart,
  multiply,
  negate,
  round,
  sign,
  subtract,
  toMinor,
  toMinorNumber,
  toNumber,
  toScale,
  type ToMinorNumberOptions,
  type RoundingInput,
  type RoundingPolicy,
} from '../money.js';
import type { RoundingMode } from '../rounding.js';
import { toBigInt } from '../scale.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /** this + other (same currency; any scale) */
    add(other: Money<C>): Money<C>;
    /** this - other */
    subtract(other: Money<C>): Money<C>;
    /**
     * this * factor, rounded to this scale. `factor` is exact: integer, decimal string ('1.075'),
     * bigint or ratio().
     */
    multiply(factor: Factor, rounding?: RoundingInput): Money<C>;
    /** this / divisor, rounded to this scale (or to a policy's scale and increment) */
    divide(divisor: Factor, rounding?: RoundingInput): Money<C>;
    negate(): Money<C>;
    abs(): Money<C>;
    /**
     * Rounds to the currency's exponent (or `scale`), or to a rounding policy. A scale is never
     * negative; round to tens or hundreds with a policy's `increment` or `roundToIncrement`.
     */
    round(rounding: RoundingMode, scale?: number): Money<C>;
    round(policy: RoundingPolicy): Money<C>;
    /**
     * Changes the scale (an integer from 0 to 1000); decreasing it rounds (default 'halfExpand').
     * For tens or hundreds, use an increment: a rounding policy or `roundToIncrement`.
     */
    toScale(scale: number, rounding?: RoundingMode): Money<C>;
    /** -1, 0 or 1; throws on currency mismatch */
    compare(other: Money<C>): -1 | 0 | 1;
    /** same currency and value; a different currency is simply not equal */
    equals(other: Money): boolean;
    lessThan(other: Money<C>): boolean;
    lessThanOrEqual(other: Money<C>): boolean;
    greaterThan(other: Money<C>): boolean;
    greaterThanOrEqual(other: Money<C>): boolean;
    isZero(): boolean;
    isPositive(): boolean;
    isNegative(): boolean;
    sign(): -1 | 0 | 1;
    min(...others: Money<C>[]): Money<C>;
    max(...others: Money<C>[]): Money<C>;
    clamp(lo: Money<C>, hi: Money<C>): Money<C>;
    /** Same currency, value and scale: 1.0 EUR is not identical to 1.00 EUR. */
    identical(other: Money): boolean;
    /**
     * Applies `operation` to this amount and returns its result, so a rounding policy or a
     * conversion reads as one step in a chain: `price.multiply('1.075').with(toCash)`.
     */
    with<R>(operation: (money: Money<C>) => R): R;
    /** The whole major units, truncated toward zero: 12 for 12.34 EUR, -12 for -12.34 EUR. */
    majorPart(): number | bigint;
    /** The rest in 10^-scale units, with the amount's sign: 34 for 12.34 EUR, -34 for -12.34. */
    minorPart(): number | bigint;
    /** Exact decimal string in major units: "12.34" */
    toDecimal(): string;
    /**
     * Units of the currency's minor unit as a bigint (cents for EUR), for BIGINT columns. Exact at
     * any scale; throws RoundingError if the amount has non-zero digits below the minor unit.
     */
    toMinor(): bigint;
    /**
     * Like `toMinor()`, as a number; also throws a RangeError beyond 2^53, unless `{ lossy: true }`
     * asks for the nearest double.
     */
    toMinorNumber(options?: ToMinorNumberOptions): number;
    /** The amount in major units as the nearest double (12.34): lossy, for display and charts. */
    toNumber(): number;
    /** Units of 10^-scale as a bigint: 12340n for 12.340 EUR at scale 3. Pair it with the scale. */
    toScaledUnits(): bigint;
  }
}

installCoreMethods({
  add(this: Money, other: Money) {
    return add(this, other);
  },
  subtract(this: Money, other: Money) {
    return subtract(this, other);
  },
  multiply(this: Money, factor: Factor, rounding?: RoundingInput) {
    return multiply(this, factor, rounding);
  },
  divide(this: Money, divisor: Factor, rounding?: RoundingInput) {
    return divide(this, divisor, rounding);
  },
  negate(this: Money) {
    return negate(this);
  },
  abs(this: Money) {
    return abs(this);
  },
  round(this: Money, rounding: RoundingInput, scale?: number) {
    // the free function handles both; the cast only picks its implementation signature
    return round(this, rounding as RoundingMode, scale);
  },
  toScale(this: Money, scale: number, rounding?: RoundingMode) {
    return toScale(this, scale, rounding);
  },
  compare(this: Money, other: Money) {
    return compare(this, other);
  },
  equals(this: Money, other: Money) {
    return equals(this, other);
  },
  lessThan(this: Money, other: Money) {
    return compare(this, other) < 0;
  },
  lessThanOrEqual(this: Money, other: Money) {
    return compare(this, other) <= 0;
  },
  greaterThan(this: Money, other: Money) {
    return compare(this, other) > 0;
  },
  greaterThanOrEqual(this: Money, other: Money) {
    return compare(this, other) >= 0;
  },
  isZero(this: Money) {
    return this.minor == 0;
  },
  isPositive(this: Money) {
    return this.minor > 0;
  },
  isNegative(this: Money) {
    return this.minor < 0;
  },
  sign(this: Money) {
    return sign(this);
  },
  min(this: Money, ...others: Money[]) {
    return min(this, ...others);
  },
  max(this: Money, ...others: Money[]) {
    return max(this, ...others);
  },
  clamp(this: Money, lo: Money, hi: Money) {
    return clamp(this, lo, hi);
  },
  identical(this: Money, other: Money) {
    return identical(this, other);
  },
  with<R>(this: Money, operation: (money: Money) => R) {
    return operation(this);
  },
  majorPart(this: Money) {
    return majorPart(this);
  },
  minorPart(this: Money) {
    return minorPart(this);
  },
  toDecimal(this: Money) {
    return formatScaled(this.minor, this.scale);
  },
  toMinor(this: Money) {
    return toMinor(this);
  },
  toMinorNumber(this: Money, options?: ToMinorNumberOptions) {
    return toMinorNumber(this, options);
  },
  toNumber(this: Money) {
    return toNumber(this);
  },
  toScaledUnits(this: Money) {
    return toBigInt(this.minor);
  },
});
