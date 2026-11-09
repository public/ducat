// Fixed-point decimals without a currency: the engine under Money, exposed on its own. A Fixed is
// an integer (a JS number while it is a safe integer, a bigint beyond) and a scale, the count of
// decimal places: `fixed('12.345')` is 12345 at scale 3. Arithmetic is exact, and every operation
// that has to drop digits rounds once, with an explicit or the default mode.
//
// `@ducatjs/money/fixed` points here and loads no Money: `toMoney()` needs
// `import '@ducatjs/money/fixed/money'` (src/plugins/fixed-money.ts).
import {
  formatScaled,
  faithfulDecimal,
  parseDecimal,
  parsePlainDecimal,
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
  divideSafeByRatio,
  RoundingError,
  type RoundingMode,
} from './rounding.js';
import { scaleDown, scaleUp } from './scale.js';

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

// The largest scale accepted. Scales cost memory and time in proportion (10^scale is a bigint with
// `scale` digits), so an untrusted '1e-999999999' must be refused before any work is done. toJSON
// never writes an exponent, so real data stays far below this.
const MAX_SCALE = 1000;
const EXPONENT = /[eE]([+-]?\d+)\s*$/;

// Passed to the constructor by this module only, so `new Fixed(1.5, 2)` from outside can't break
// the representation invariant. Values come from fixed(), fromScaled() and the methods.
const INTERNAL: unique symbol = Symbol('Fixed');

/** What `fixed()` accepts: a decimal string, a number, a bigint or a Fixed. */
export type FixedInput = string | number | bigint | Fixed;

/** Options for `fixed()`. */
export interface FixedOptions {
  /** Decimal places to keep (default: as many as the input has; 0 for integers). */
  readonly scale?: number;
  /** How to round input with more decimals than `scale` (default 'unnecessary': throw). */
  readonly rounding?: RoundingMode;
}

/** Options for multiply and divide. */
export interface ArithmeticOptions {
  /** The result's scale (default: the scale of the value being multiplied or divided). */
  readonly scale?: number;
}

/** The integer-and-scale form of a Fixed: `value / 10^scale`. */
export interface ScaledInteger {
  readonly value: number | bigint;
  readonly scale: number;
}

/** A number stays; a bigint becomes a number when it is safe (the representation invariant). */
function normalize(value: number | bigint): number | bigint {
  return typeof value === 'bigint' ? normalizeMinor(value) : value;
}

function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function checkScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError(`Invalid scale ${scale}: use an integer from 0 to ${MAX_SCALE}`);
  }
}

/** A Fixed from a value that already holds the invariant (an integer, safe when a number). */
function make(value: number | bigint, scale: number): Fixed {
  return new Fixed(INTERNAL, value, scale);
}

function resultScale(
  value: { readonly scale: number },
  options: ArithmeticOptions | undefined,
): number {
  const scale = options?.scale;
  if (scale === undefined) {
    return value.scale;
  }
  checkScale(scale);
  return scale;
}

/**
 * An exact fixed-point decimal: `value / 10^scale`. Immutable. Create one with `fixed()` or
 * `fromScaled()`. Mixed scales work as for Money: add, subtract and compare align to the larger
 * scale exactly, and multiply and divide keep this value's scale.
 *
 * `toMoney()` needs `import '@ducatjs/money/fixed/money'`, which also adds `Money#toFixedPoint()`:
 * `@ducatjs/money/fixed` alone doesn't load Money.
 */
export class Fixed {
  /** The scaled integer: a number while it is a safe integer, a bigint beyond. */
  readonly value: number | bigint;
  /** Decimal places. */
  readonly scale: number;

  /** @internal use fixed() or fromScaled() */
  constructor(token: typeof INTERNAL, value: number | bigint, scale: number) {
    if (token !== INTERNAL) {
      throw new TypeError('Use fixed() or fromScaled() to create a Fixed');
    }
    // `+ 0` turns -0 into 0, so no operation can leak a negative zero.
    this.value = typeof value === 'bigint' ? normalizeMinor(value) : value + 0;
    this.scale = scale;
  }

  // Arithmetic

  /** this + other, exactly, at the larger of the two scales. */
  add(other: FixedInput): Fixed {
    return addAligned(this, toFixed(other), 1);
  }

  /** this − other, exactly, at the larger of the two scales. */
  subtract(other: FixedInput): Fixed {
    return addAligned(this, toFixed(other), -1);
  }

  /**
   * this × factor, rounded once to this value's scale or `options.scale` (default 'halfExpand').
   * The factor is exact: an integer, a decimal string ('1.075'), a bigint, a `ratio()` or another
   * Fixed. Give `scale` rather than calling toScale afterwards, which would round twice.
   */
  multiply(
    factor: Factor | Fixed,
    rounding: RoundingMode = DEFAULT_ROUNDING,
    options?: ArithmeticOptions,
  ): Fixed {
    const value = this.value;
    const scale = resultScale(this, options);

    // An integer factor keeps the scale and can't need rounding, so a safe product is the answer.
    if (
      scale === this.scale &&
      typeof factor === 'number' &&
      Number.isSafeInteger(factor) &&
      typeof value === 'number'
    ) {
      const product = value * factor;
      if (product <= MAX_SAFE_MINOR && product >= -MAX_SAFE_MINOR) {
        return make(product + 0, this.scale);
      }
    }

    return multiplyByRatio(this, factorRatio(factor), rounding, scale);
  }

  /**
   * this ÷ divisor, rounded once to this value's scale or `options.scale` (default 'halfExpand'):
   * `fixed('9.990').divide('1.2', 'halfEven', { scale: 2 })` is 8.32.
   */
  divide(
    divisor: Factor | Fixed,
    rounding: RoundingMode = DEFAULT_ROUNDING,
    options?: ArithmeticOptions,
  ): Fixed {
    const scale = resultScale(this, options);
    const divisorRatio = factorRatio(divisor);
    if (divisorRatio.num === 0n) {
      throw new RangeError('Division by zero');
    }

    // The fast path Money's divide takes: a safe-integer value and a divisor whose ratio parts are
    // safe integers, at this value's scale, without building the inverse ratio.
    const value = this.value;
    if (typeof value === 'number' && scale === this.scale) {
      const quotient = divideSafeByRatio(value, divisorRatio, rounding);
      if (quotient === quotient) {
        return make(quotient, scale);
      }
    }

    return multiplyByRatio(this, ratio(divisorRatio.den, divisorRatio.num), rounding, scale);
  }

  /** −this */
  negate(): Fixed {
    const value = this.value;
    if (typeof value === 'number') {
      return make(0 - value, this.scale);
    }
    return make(-value, this.scale);
  }

  /** |this| */
  abs(): Fixed {
    return this.value < 0 ? this.negate() : this;
  }

  /**
   * Rounds to `scale` decimal places (default 0, an integer): `fixed('2.5').round('halfEven')` is
   * 2. Money's round() defaults to the currency's exponent; a Fixed has none, so the default is 0.
   */
  round(rounding: RoundingMode, scale = 0): Fixed {
    return this.toScale(scale, rounding);
  }

  /**
   * Changes the scale: increasing it is always exact, decreasing it rounds (default 'halfExpand').
   */
  toScale(scale: number, rounding: RoundingMode = DEFAULT_ROUNDING): Fixed {
    checkScale(scale);
    if (scale === this.scale) {
      return this;
    }
    if (scale > this.scale) {
      return make(scaleUp(this.value, scale - this.scale), scale);
    }
    return make(scaleDown(this.value, this.scale - scale, rounding), scale);
  }

  // Comparison

  /** −1, 0 or 1, exactly, across scales and number/bigint. */
  compare(other: FixedInput): -1 | 0 | 1 {
    const operand = toFixed(other);
    let first = this.value;
    let second = operand.value;
    if (this.scale !== operand.scale) {
      const scale = Math.max(this.scale, operand.scale);
      first = scaleUp(first, scale - this.scale);
      second = scaleUp(second, scale - operand.scale);
    }

    // Comparisons between a number and a bigint are exact in JS.
    if (first < second) {
      return -1;
    }
    if (first > second) {
      return 1;
    }
    return 0;
  }

  /** The same value, at any scale: 1.0 equals 1.00. */
  equals(other: FixedInput): boolean {
    const operand = toFixed(other);
    if (this.scale === operand.scale) {
      // == compares a number and a bigint exactly.
      return this.value == operand.value;
    }
    return this.compare(operand) === 0;
  }

  /** this < other */
  lessThan(other: FixedInput): boolean {
    return this.compare(other) < 0;
  }

  /** this ≤ other */
  lessThanOrEqual(other: FixedInput): boolean {
    return this.compare(other) <= 0;
  }

  /** this > other */
  greaterThan(other: FixedInput): boolean {
    return this.compare(other) > 0;
  }

  /** this ≥ other */
  greaterThanOrEqual(other: FixedInput): boolean {
    return this.compare(other) >= 0;
  }

  /** this = 0 */
  isZero(): boolean {
    return this.value == 0;
  }

  /** this > 0 */
  isPositive(): boolean {
    return this.value > 0;
  }

  /** this < 0 */
  isNegative(): boolean {
    return this.value < 0;
  }

  /** −1, 0 or 1 */
  sign(): -1 | 0 | 1 {
    if (this.value > 0) {
      return 1;
    }
    if (this.value < 0) {
      return -1;
    }
    return 0;
  }

  // Conversion

  /** The plain decimal string, with every decimal place of the scale: '12.340'. */
  toString(): string {
    return formatScaled(this.value, this.scale);
  }

  /** The decimal string, as toString(), so JSON round-trips exactly through `fixed()`. */
  toJSON(): string {
    return this.toString();
  }

  /** `{ value, scale }`, the exact integer form: value / 10^scale. */
  toScaled(): ScaledInteger {
    return { value: this.value, scale: this.scale };
  }

  /** Blocks `a + b`, `a > b` and `+a`: arithmetic and comparison go through the methods. */
  [Symbol.toPrimitive](hint: string): string {
    if (hint === 'string') {
      return this.toString();
    }
    throw new TypeError(
      'Fixed cannot be converted to a number; use add(), compare(), toString() etc.',
    );
  }
}

/** value × rate at `scale`, rounded once: the kernel of multiply and divide. */
function multiplyByRatio(
  fixedValue: Fixed,
  rate: Ratio,
  rounding: RoundingMode,
  scale: number,
): Fixed {
  const value = fixedValue.value;

  // Fast path: both factors are safe integers, so a product within the safe range is exact, and
  // divideAndRound then rounds the exact quotient.
  if (
    typeof value === 'number' &&
    scale === fixedValue.scale &&
    rate.n === rate.n &&
    rate.d === rate.d
  ) {
    const product = value * rate.n;
    if (product <= MAX_SAFE_MINOR && product >= -MAX_SAFE_MINOR) {
      return make(divideAndRound(product, rate.d, rounding), scale);
    }
  }

  // Slow path: the same single division, in bigint.
  let numerator = toBigInt(value) * rate.num;
  let denominator = rate.den;
  if (scale > fixedValue.scale) {
    numerator *= pow10n(scale - fixedValue.scale);
  } else if (scale < fixedValue.scale) {
    denominator *= pow10n(fixedValue.scale - scale);
  }
  return make(divideAndRoundBigint(numerator, denominator, rounding), scale);
}

/** first + sign × second, exactly, at the larger scale. */
function addAligned(first: Fixed, second: Fixed, sign: 1 | -1): Fixed {
  const firstValue = first.value;
  const secondValue = second.value;

  // Fast path: two safe integers at one scale have an exact sum whenever it is itself safe.
  if (
    typeof firstValue === 'number' &&
    typeof secondValue === 'number' &&
    first.scale === second.scale
  ) {
    const sum = sign === 1 ? firstValue + secondValue : firstValue - secondValue;
    if (sum <= MAX_SAFE_MINOR && sum >= -MAX_SAFE_MINOR) {
      return make(sum + 0, first.scale);
    }
  }

  const scale = Math.max(first.scale, second.scale);
  const aligned = toBigInt(scaleUp(firstValue, scale - first.scale));
  const alignedOther = toBigInt(scaleUp(secondValue, scale - second.scale));
  if (sign === 1) {
    return make(aligned + alignedOther, scale);
  }
  return make(aligned - alignedOther, scale);
}

/** A factor as an exact ratio; a Fixed is value / 10^scale. */
function factorRatio(factor: Factor | Fixed): Ratio {
  if (factor instanceof Fixed) {
    return ratio(toBigInt(factor.value), pow10n(factor.scale));
  }
  // A Ratio object is trusted as it is, as Money trusts it: build it with ratio(), once, for hot
  // loops.
  return ratio(factor);
}

function toFixed(input: FixedInput): Fixed {
  if (input instanceof Fixed) {
    return input;
  }
  return fixed(input);
}

/** Digits at `fromScale` as a Fixed at `targetScale`, rounding when decimals are dropped. */
function rescale(
  digits: number | bigint,
  fromScale: number,
  targetScale: number,
  rounding: RoundingMode,
  input: unknown,
): Fixed {
  if (fromScale === targetScale) {
    return make(digits, targetScale);
  }
  if (fromScale < targetScale) {
    return make(scaleUp(normalize(digits), targetScale - fromScale), targetScale);
  }
  try {
    return make(scaleDown(normalize(digits), fromScale - targetScale, rounding), targetScale);
  } catch (error) {
    if (error instanceof RoundingError) {
      throw new RoundingError(
        `${String(input)} has more than ${targetScale} decimal places; pass { rounding }`,
      );
    }
    throw error;
  }
}

/**
 * parseDecimal, refusing exponents that would make a scale (or a power of ten) beyond MAX_SCALE.
 */
function parseBoundedDecimal(text: string): { digits: bigint; scale: number } {
  const exponent = EXPONENT.exec(text);
  if (exponent !== null && Math.abs(Number(exponent[1])) > MAX_SCALE) {
    throw new RangeError(`${text}: the exponent is beyond ±${MAX_SCALE}`);
  }
  const parsed = parseDecimal(text);
  if (parsed.scale > MAX_SCALE) {
    throw new RangeError(`${text} has more than ${MAX_SCALE} decimal places`);
  }
  return parsed;
}

/**
 * Creates an exact fixed-point decimal.
 *
 *     fixed('12.340')                 // 12.340: a string keeps its scale (3)
 *     fixed('1.005', { scale: 2, rounding: 'halfEven' })   // 1.00
 *     fixed(12)                       // 12, scale 0
 *     fixed(0.25)                     // 0.25: read at its shortest decimal form
 *     fixed(10n ** 30n)
 *
 * Numbers are taken at their shortest decimal form, and only when that has at most 15 significant
 * digits, which a double always holds faithfully. So `fixed(0.1 + 0.2)` throws rather than becoming
 * 0.30000000000000004; pass the decimal as a string, or give `scale` and `rounding`. Input with
 * more decimals than `scale` throws unless `rounding` is given, and `rounding` needs a `scale`.
 * Scales run from 0 to 1000.
 */
export function fixed(value: FixedInput, options?: FixedOptions): Fixed {
  const scale = options?.scale;
  if (scale !== undefined) {
    checkScale(scale);
  } else if (options?.rounding !== undefined) {
    throw new RangeError('fixed(): `rounding` needs a `scale` to round to');
  }
  const rounding = options?.rounding ?? 'unnecessary';

  if (value instanceof Fixed) {
    return scale === undefined ? value : rescale(value.value, value.scale, scale, rounding, value);
  }

  if (typeof value === 'string') {
    const parsed = parsePlainDecimal(value) ?? parseBoundedDecimal(value);
    if (parsed.scale > MAX_SCALE) {
      throw new RangeError(`${value.slice(0, 40)}… has more than ${MAX_SCALE} decimal places`);
    }
    return rescale(parsed.digits, parsed.scale, scale ?? parsed.scale, rounding, value);
  }

  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) {
      return scale === undefined ? make(value + 0, 0) : make(scaleUp(value + 0, scale), scale);
    }
    if (!Number.isFinite(value)) {
      throw new RangeError(`Invalid number ${value}`);
    }
    // Only an explicit rounding mode says a float's extra digits may be dropped.
    const text =
      options?.rounding === undefined
        ? faithfulDecimal(value, 'pass a string, or { scale, rounding }')
        : String(value);
    const parsed = parseDecimal(text);
    return rescale(parsed.digits, parsed.scale, scale ?? parsed.scale, rounding, value);
  }

  if (typeof value === 'bigint') {
    return scale === undefined ? make(value, 0) : make(scaleUp(normalize(value), scale), scale);
  }

  throw new TypeError(`Invalid fixed-point value ${String(value)}`);
}

/** The Fixed `value / 10^scale`: `fromScaled(12345, 3)` is 12.345. `value` must be an integer. */
export function fromScaled(value: number | bigint, scale: number): Fixed {
  checkScale(scale);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        Number.isInteger(value)
          ? `The scaled value must be a safe integer, got ${value}; pass a bigint`
          : `The scaled value must be an integer, got ${value}`,
      );
    }
    return make(value + 0, scale);
  }
  if (typeof value !== 'bigint') {
    throw new TypeError(`Invalid scaled value ${String(value)}`);
  }
  return make(value, scale);
}

/** Whether `value` is a Fixed. */
export function isFixed(value: unknown): value is Fixed {
  return value instanceof Fixed;
}
