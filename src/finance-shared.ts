/**
 * Internal helpers shared by `/finance` and `/excel`: rounding a fraction once, checking options,
 * flows as integers, the rate bisection, and the annuities' exact values. Not an entry: nothing
 * outside the two modules imports it.
 */
import { currencyExponent } from './currency.js';
import { pow10n, ratio, type Factor, type Ratio } from './decimal.js';
import { ExactMoney } from './exact.js';

import {
  CurrencyMismatchError,
  make,
  multiplyByRatio,
  type Money,
  type RoundingInput,
} from './money.js';

/**
 * numerator / denominator major units (denominator > 0) rounded once: with a mode, to the
 * currency's exponent; with a policy, to the policy's scale and increment. The fraction is not
 * reduced first: rounding divides once either way, and a gcd of the thousands-of-bits integers a
 * long schedule or NPV builds would cost more than everything else.
 */
export function roundQuotient<C extends string>(
  currency: C,
  numerator: bigint,
  denominator: bigint,
  rounding: RoundingInput,
): Money<C> {
  // one major unit times the fraction, so the rounding applies to the fraction itself
  return multiplyAndRound(make(currency, 1, 0), unreducedRatio(numerator, denominator), rounding);
}

/** money × factor rounded once, at the currency's exponent or the policy's scale. */
export function multiplyAndRound<C extends string>(
  money: Money<C>,
  factor: Ratio,
  rounding: RoundingInput,
): Money<C> {
  return multiplyByRatio(money, factor, rounding, currencyExponent(money.currency));
}

/**
 * A ratio built without a gcd, for rounding once: multiplyByRatio divides by it, which gives the
 * same result for any representation of the fraction.
 */
export function unreducedRatio(numerator: bigint, denominator: bigint): Ratio {
  const toNumber = (value: bigint) =>
    value <= 9_007_199_254_740_991n && value >= -9_007_199_254_740_991n ? Number(value) : NaN;
  return { num: numerator, den: denominator, n: toNumber(numerator), d: toNumber(denominator) };
}

/**
 * The most periods a schedule or compounding may have: (1 + r)^n has about n times the bits of
 * 1 + r, so this bounds the integers (a 30-year daily schedule is about 11,000 periods).
 */
export const MAX_PERIODS = 100_000;

export function assertPeriods(periods: number, minimum: number): void {
  if (!(Number.isInteger(periods) && periods >= minimum && periods <= MAX_PERIODS)) {
    invalid('periods', periods);
  }
}

/** Whether `money` is a whole number of `unit`s (both of one currency, unit positive). */
export function isMultipleOf(money: Money, unit: Money): boolean {
  const scale = Math.max(money.scale, unit.scale);
  const minor = BigInt(money.minor) * pow10n(scale - money.scale);
  const unitMinor = BigInt(unit.minor) * pow10n(scale - unit.scale);
  return minor % unitMinor === 0n;
}

/** Throws a RangeError naming the option and the value it was given. */
export function invalid(name: string, value: unknown): never {
  throw new RangeError(`Invalid ${name} ${String(value)}`);
}

export function assertPositiveInteger(value: number, name: string): void {
  if (!(Number.isSafeInteger(value) && value >= 1)) {
    invalid(name, value);
  }
}

export function assertSameCurrency(money: Money, other: Money): void {
  if (money.currency !== other.currency) {
    throw new CurrencyMismatchError(money.currency, other.currency);
  }
}

/** The integer `power`th root of a positive integer, if it is a perfect `power`th power. */
export function exactRoot(value: bigint, power: bigint): bigint | undefined {
  // value has `bits` bits, so its root lies in [2^⌊(bits−1)/power⌋, 2^(⌊(bits−1)/power⌋ + 1))
  const bits = BigInt(value.toString(2).length);
  if (power >= bits) {
    // 2^power alone has more bits than value: only 1 can be its root
    return value === 1n ? 1n : undefined;
  }
  const shift = (bits - 1n) / power;
  let low = 1n << shift;
  let high = low << 1n;
  while (high - low > 1n) {
    const middle = (low + high) >> 1n;
    if (middle ** power <= value) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low ** power === value ? low : undefined;
}

/** The flows' minor units at one common scale, checked to share a currency. */
export function flowMinors<C extends string>(
  flows: readonly Money<C>[],
): { minors: bigint[]; scale: number } {
  if (flows.length === 0) {
    throw new RangeError('At least one cash flow is needed');
  }
  const first = flows[0]!;
  let scale = 0;
  for (const flow of flows) {
    assertSameCurrency(first, flow);
    if (flow.scale > scale) {
      scale = flow.scale;
    }
  }
  const minors = flows.map((flow) => BigInt(flow.minor) * pow10n(scale - flow.scale));
  return { minors, scale };
}

/**
 * Σ flowₜ · bᵗ · q^(n−t) for a rate of (q − b)/b: the NPV times q^n, by Horner's rule. q^n is
 * positive for a rate above −1, so this has the NPV's sign.
 */
export function scaledPresentValue(
  minors: readonly bigint[],
  growthNumerator: bigint,
  base: bigint,
): bigint {
  let accumulator = minors[0]!;
  let basePower = 1n;
  for (let i = 1; i < minors.length; i++) {
    basePower *= base;
    accumulator = accumulator * growthNumerator + minors[i]! * basePower;
  }
  return accumulator;
}

/**
 * The flows' discounted value in major units as an unreduced fraction (denominator positive), the
 * first flow at period 0, or at period 1 when `fromPeriodOne`.
 */
export function discountedValue(
  discountRate: Factor,
  flows: readonly Money[],
  fromPeriodOne: boolean,
): [bigint, bigint] {
  const { minors, scale } = flowMinors(flows);
  const rateRatio = ratio(discountRate);
  const growthNumerator = rateRatio.num + rateRatio.den;
  if (growthNumerator <= 0n) {
    throw new RangeError(`The rate must be above -1; got ${discountRate}`);
  }
  let numerator = scaledPresentValue(minors, growthNumerator, rateRatio.den);
  let denominator = growthNumerator ** BigInt(minors.length - 1) * pow10n(scale);
  if (fromPeriodOne) {
    // one more period: divide by 1 + rate = growthNumerator / den
    numerator *= rateRatio.den;
    denominator *= growthNumerator;
  }
  return [numerator, denominator];
}

export function signOf(value: bigint): -1 | 0 | 1 {
  if (value > 0n) {
    return 1;
  }
  if (value < 0n) {
    return -1;
  }
  return 0;
}

/** Sign changes in the flows, zeros skipped, and the sign of the first non-zero flow. */
export function signChanges(minors: readonly bigint[]): { changes: number; firstSign: -1 | 0 | 1 } {
  let changes = 0;
  let firstSign: -1 | 0 | 1 = 0;
  let previous: -1 | 0 | 1 = 0;
  for (const minor of minors) {
    const sign = signOf(minor);
    if (sign === 0) {
      continue;
    }
    if (firstSign === 0) {
      firstSign = sign;
    }
    if (previous !== 0 && sign !== previous) {
      changes++;
    }
    previous = sign;
  }
  return { changes, firstSign };
}

/**
 * The most times `bisectRate` doubles its upper end looking for a positive root: a rate above
 * 2^1024 (a 10^308-fold return per period) throws rather than search on.
 */
export const MAX_DOUBLINGS = 1024;

/**
 * The bisection the rate solvers share, on the grid of `unit`ths: from the caller's bracket, or
 * with one sign change from 0 (the root is negative when the value at 0 has the first flow's sign,
 * else positive, found by doubling, at most 1,024 times). Each bisection step halves an interval
 * of at most 2^1024 · unit grid points, so the steps are bounded too. `signAt` takes a grid point,
 * `signAtRate` an exact rate.
 */
export function bisectRate<R>(
  signAt: (grid: bigint) => -1 | 0 | 1,
  result: (grid: bigint) => R,
  unit: bigint,
  firstSign: -1 | 0 | 1,
  bracket: readonly [Factor, Factor] | undefined,
  signAtRate: (rate: Ratio) => -1 | 0 | 1,
): R {
  let low: bigint;
  let high: bigint;
  let lowSign: -1 | 0 | 1;
  if (bracket !== undefined) {
    const bracketed = bracketToGrid(bracket, signAtRate, unit, signAt);
    if (typeof bracketed === 'bigint') {
      return result(bracketed);
    }
    [low, high, lowSign] = bracketed;
  } else {
    // One sign change: exactly one IRR above −1 (Descartes' rule in 1/(1 + rate)). The NPV has the
    // first flow's sign for large rates and the last flow's sign near −1.
    const zeroSign = signAt(0n);
    if (zeroSign === 0) {
      return result(0n);
    }
    if (zeroSign === firstSign) {
      // the IRR is negative: between −1 (excluded, where the NPV has the last flow's sign) and 0
      low = -unit;
      high = 0n;
      lowSign = -firstSign as -1 | 1;
    } else {
      // the IRR is positive: double the upper end until the NPV takes the first flow's sign
      low = 0n;
      high = unit;
      lowSign = zeroSign;
      let doublings = 0;
      for (;;) {
        const highSign = signAt(high);
        if (highSign === 0) {
          return result(high);
        }
        if (highSign !== lowSign) {
          break;
        }
        if (++doublings > MAX_DOUBLINGS) {
          throw new RangeError('The rate is above 2^1024; no root was found below it');
        }
        low = high;
        high *= 2n;
      }
    }
  }

  // Bisection on the grid: the bracket's ends stay `digits`-place decimals, so the integers stay
  // bounded by the digits asked for, and each step halves the bracket.
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    const middleSign = signAt(middle);
    if (middleSign === 0) {
      return result(middle);
    }
    if (middleSign === lowSign) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return result(low);
}

/**
 * The caller's bracket narrowed to the grid of `unit`ths: the NPV's signs are taken at the exact
 * bracket ends first, so the root found is one inside the bracket. Returns the grid point at or
 * below the root when the root is already pinned to one grid step, else the grid bracket to bisect
 * and the sign at its lower end.
 */
export function bracketToGrid(
  bracket: readonly [Factor, Factor],
  signAtRate: (rate: Ratio) => -1 | 0 | 1,
  unit: bigint,
  signAt: (grid: bigint) => -1 | 0 | 1,
): bigint | [bigint, bigint, -1 | 1] {
  const lowRate = ratio(bracket[0]);
  const highRate = ratio(bracket[1]);
  if (!(lowRate.num * highRate.den < highRate.num * lowRate.den)) {
    throw new RangeError('The bracket must be two increasing rates');
  }
  if (lowRate.num + lowRate.den <= 0n) {
    throw new RangeError('The bracket must be above -1');
  }
  const lowSign = signAtRate(lowRate);
  const highSign = signAtRate(highRate);
  // an end that is itself a root: the grid point at or below it
  if (lowSign === 0) {
    return floorDivide(lowRate.num * unit, lowRate.den);
  }
  if (highSign === 0) {
    return floorDivide(highRate.num * unit, highRate.den);
  }
  if (lowSign === highSign) {
    throw new RangeError('The NPV has the same sign at both ends of the bracket');
  }

  // the grid points inside the bracket
  const gridLow = -floorDivide(-lowRate.num * unit, lowRate.den);
  const gridHigh = floorDivide(highRate.num * unit, highRate.den);
  if (gridLow > gridHigh) {
    // no grid point inside: the root is between the two around the bracket
    return gridHigh;
  }
  const gridLowSign = signAt(gridLow);
  if (gridLowSign === 0) {
    return gridLow;
  }
  if (gridLowSign !== lowSign) {
    // the sign changes between the bracket's low end and the first grid point
    return gridLow - 1n;
  }
  const gridHighSign = gridHigh === gridLow ? gridLowSign : signAt(gridHigh);
  if (gridHighSign === 0) {
    return gridHigh;
  }
  if (gridHighSign === lowSign) {
    // the sign changes between the last grid point and the bracket's high end
    return gridHigh;
  }
  return [gridLow, gridHigh, lowSign];
}

export function floorDivide(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  // bigint division truncates; step down when a negative quotient left a remainder
  return dividend % divisor !== 0n && dividend < 0n !== divisor < 0n ? quotient - 1n : quotient;
}

/** When payments fall in each period, as Excel's `type`: 0 at the end (the default), 1 at the start. */
export type PaymentTiming = 0 | 1;

/** Options for `fv`: Excel's optional arguments. */
export interface FvOptions<C extends string> {
  /** The present value, Excel's `pv` (default zero). */
  readonly pv?: Money<C> | undefined;
  /** 0 when payments are at the end of each period (default), 1 at the start. */
  readonly type?: PaymentTiming | undefined;
}

/** Options for `pv` and `pmt`: Excel's optional arguments. */
export interface PvOptions<C extends string> {
  /** The future value, Excel's `fv` (default zero). */
  readonly fv?: Money<C> | undefined;
  /** 0 when payments are at the end of each period (default), 1 at the start. */
  readonly type?: PaymentTiming | undefined;
}

/**
 * The checked parts every annuity function shares: the rate as a/b, the timing, and the amounts
 * as integers at one scale.
 */
export interface Annuity<C extends string> {
  readonly currency: C;
  /** the rate's reduced numerator and denominator */
  readonly a: bigint;
  readonly b: bigint;
  readonly type: bigint;
  readonly scale: number;
  readonly minors: bigint[];
}

export function annuity<C extends string>(
  ratePerPeriod: Factor,
  type: PaymentTiming | undefined,
  amounts: readonly (Money<C> | undefined)[],
): Annuity<C> {
  const rateRatio = ratio(ratePerPeriod);
  if (rateRatio.num + rateRatio.den <= 0n) {
    throw new RangeError(`The rate must be above -1; got ${String(ratePerPeriod)}`);
  }
  const timing = type ?? 0;
  if (timing !== 0 && timing !== 1) {
    invalid('type', timing);
  }
  const given = amounts.filter((amount): amount is Money<C> => amount !== undefined);
  const { minors: givenMinors, scale } = flowMinors(given);
  let index = 0;
  const minors = amounts.map((amount) => (amount === undefined ? 0n : givenMinors[index++]!));
  return {
    currency: given[0]!.currency,
    a: rateRatio.num,
    b: rateRatio.den,
    type: BigInt(timing),
    scale,
    minors,
  };
}

/**
 * The most bits an annuity's power (1 + r)^nper may have before it throws rather than take
 * seconds to minutes: 2^20 for fv, pv and pmt (about 20 ms there), 2^16 for their …Exact forms
 * (an ExactMoney reduces its fraction, which is quadratic: from 0.1 s to about 1 s there,
 * depending on the engine), and 2^19 for rate, checked at every rate the bisection tries. Monthly for 30 years at a 10-digit rate is about
 * 12,000 bits.
 */
export const MAX_POWER_BITS = 1_048_576; // 2^20, a literal so bundlers drop it when unused
export const MAX_EXACT_POWER_BITS = 65_536; // 2^16
export const MAX_RATE_POWER_BITS = 524_288; // 2^19

/** Throws when `base^count` would have more than `limit` bits. */
export function assertPowerSize(base: bigint, count: bigint, name: string, limit: number): void {
  const magnitude = base < 0n ? -base : base;
  if (BigInt(magnitude.toString(2).length) * count > BigInt(limit)) {
    throw new RangeError(
      `${name}'s power (1 + rate)^nper would pass ${limit} bits; use fewer periods or a shorter rate`,
    );
  }
}

/** A whole number of periods for fv, pv and pmt: Excel takes fractions, whose powers are irrational. */
export function wholePeriods(periods: number, minimum: number): bigint {
  if (!(Number.isInteger(periods) && periods >= minimum && periods <= MAX_PERIODS)) {
    throw new RangeError(
      `nper must be a whole number from ${minimum} to ${MAX_PERIODS}; got ${String(periods)}`,
    );
  }
  return BigInt(periods);
}

/**
 * The amount in major units as num / (den · 10^scale), negated: Excel's sign convention. The
 * rounded functions round this fraction directly, as `npv` does, so only the …Exact ones need
 * ExactMoney.
 */
export function annuityResult<C extends string>(
  parts: Annuity<C>,
  numerator: bigint,
  denominator: bigint,
): AnnuityValue<C> {
  // a negative rate makes the denominator negative; rounding needs it positive
  const scaled = denominator * pow10n(parts.scale);
  return scaled < 0n ? [parts.currency, numerator, -scaled] : [parts.currency, -numerator, scaled];
}

/** A currency and an unreduced fraction of its major unit. */
export type AnnuityValue<C extends string> = readonly [C, bigint, bigint];

export function toExactMoney<C extends string>([
  currency,
  numerator,
  denominator,
]: AnnuityValue<C>): ExactMoney<C> {
  return new ExactMoney(currency, numerator, denominator);
}

export function roundedValue<C extends string>(
  [currency, numerator, denominator]: AnnuityValue<C>,
  rounding: RoundingInput,
): Money<C> {
  return roundQuotient(currency, numerator, denominator, rounding);
}

export function fvValue<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  payment: Money<C>,
  options?: FvOptions<C>,
  limit: number = MAX_POWER_BITS,
): AnnuityValue<C> {
  const count = wholePeriods(periods, 0);
  const parts = annuity(ratePerPeriod, options?.type, [payment, options?.pv]);
  const [paymentMinor, presentMinor] = parts.minors as [bigint, bigint];
  const { a, b, type } = parts;
  assertPowerSize(a + b > b ? a + b : b, count, 'fv', limit);
  if (a === 0n) {
    return annuityResult(parts, presentMinor + paymentMinor * count, 1n);
  }
  // with g = (a + b)/b, Q = (a + b)^n and B = b^n:
  // pv·Q/B + pmt·(b + a·type)/b · (Q − B)/B · b/a = (pv·Q·a + pmt·(b + a·type)·(Q − B)) / (B·a)
  const growth = (a + b) ** count;
  const base = b ** count;
  return annuityResult(
    parts,
    presentMinor * growth * a + paymentMinor * (b + a * type) * (growth - base),
    base * a,
  );
}

export function pvValue<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  payment: Money<C>,
  options?: PvOptions<C>,
  limit: number = MAX_POWER_BITS,
): AnnuityValue<C> {
  const count = wholePeriods(periods, 0);
  const parts = annuity(ratePerPeriod, options?.type, [payment, options?.fv]);
  const [paymentMinor, futureMinor] = parts.minors as [bigint, bigint];
  const { a, b, type } = parts;
  assertPowerSize(a + b > b ? a + b : b, count, 'pv', limit);
  if (a === 0n) {
    return annuityResult(parts, futureMinor + paymentMinor * count, 1n);
  }
  // (fv·B·a + pmt·(b + a·type)·(Q − B)) / (B·a), divided by Q/B
  const growth = (a + b) ** count;
  const base = b ** count;
  return annuityResult(
    parts,
    futureMinor * base * a + paymentMinor * (b + a * type) * (growth - base),
    growth * a,
  );
}

export function pmtValue<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  present: Money<C>,
  options?: PvOptions<C>,
  limit: number = MAX_POWER_BITS,
): AnnuityValue<C> {
  const count = wholePeriods(periods, 1);
  const parts = annuity(ratePerPeriod, options?.type, [present, options?.fv]);
  const [presentMinor, futureMinor] = parts.minors as [bigint, bigint];
  const { a, b, type } = parts;
  assertPowerSize(a + b > b ? a + b : b, count, 'pmt', limit);
  if (a === 0n) {
    return annuityResult(parts, presentMinor + futureMinor, count);
  }
  // (pv·Q/B + fv)·(a/b) / ((b + a·type)/b · (Q − B)/B) = (pv·Q + fv·B)·a / ((b + a·type)·(Q − B))
  const growth = (a + b) ** count;
  const base = b ** count;
  return annuityResult(
    parts,
    (presentMinor * growth + futureMinor * base) * a,
    (b + a * type) * (growth - base),
  );
}
