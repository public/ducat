/**
 * `@ducatjs/money/excel`: Excel's financial functions (NPV, IRR, FV, PV, PMT, NPER and RATE), with
 * Excel's arguments and sign convention, in exact arithmetic. Each matches Excel's value at its 15
 * significant digits wherever Excel's double evaluation is well conditioned; where it isn't, these
 * give the exact value (or the exact root to the digits asked for), which is the correct one. Where
 * Excel guesses (several possible rates, no convergence), they throw. ducat's own calculations,
 * under its own names, are in `@ducatjs/money/finance`.
 */

import { formatScaled, pow10n, ratio, type Factor, type Ratio } from './decimal.js';
import { ExactMoney } from './exact.js';

import { type Money, type RoundingInput } from './money.js';
import { DEFAULT_ROUNDING } from './rounding.js';
import {
  MAX_EXACT_POWER_BITS,
  MAX_RATE_POWER_BITS,
  annuity,
  assertPowerSize,
  bisectRate,
  discountedValue,
  exactRoot,
  floorDivide,
  flowMinors,
  fvValue,
  invalid,
  pmtValue,
  pvValue,
  roundQuotient,
  roundedValue,
  scaledPresentValue,
  signChanges,
  signOf,
  toExactMoney,
  wholePeriods,
} from './finance-shared.js';
import type { FvOptions, PvOptions } from './finance-shared.js';

export type { FvOptions, PaymentTiming, PvOptions } from './finance-shared.js';

/**
 * Excel's NPV, exactly: `Σ flowᵢ / (1 + rate)ⁱ` for i = 1, 2…, so the first flow is at the end of
 * period 1 and is discounted once. Like Excel, an initial outlay at period 0 goes outside:
 * `flows[0] + npv(rate, rest)`, or use `discountedSumExact`.
 */
export function npvExact<C extends string>(
  discountRate: Factor,
  flows: readonly Money<C>[],
): ExactMoney<C> {
  const [numerator, denominator] = discountedValue(discountRate, flows, true);
  return new ExactMoney(flows[0]!.currency, numerator, denominator);
}

/**
 * Excel's NPV: flows at the ends of periods 1, 2…, exact and rounded once (to the currency's
 * exponent with a mode, or to a policy's scale; default 'halfExpand'), so it matches Excel to the
 * cent. Like Excel, an initial outlay at period 0 goes outside: `flows[0] + npv(rate, rest)`, or use
 * `discountedSum`, which takes flows from period 0.
 *
 *     npv('0.1', [money('-10000', 'USD'), money('3000', 'USD'), money('4200', 'USD'),
 *       money('6800', 'USD')])   // 1188.44 USD, as Excel's NPV(10%, -10000, 3000, 4200, 6800)
 */
export function npv<C extends string>(
  discountRate: Factor,
  flows: readonly Money<C>[],
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const [numerator, denominator] = discountedValue(discountRate, flows, true);
  return roundQuotient(flows[0]!.currency, numerator, denominator, rounding);
}

/** Options for `irr`. */
export interface IrrOptions {
  /** Decimal places of the result (default 10). */
  readonly digits?: number;
  /**
   * Rates the IRR lies between (inclusive), with NPVs of opposite signs at the two ends, taken at
   * the exact rates given. Needed when the flows change sign more than once, since they can then
   * have several IRRs; it replaces Excel's `guess`.
   */
  readonly bracket?: readonly [Factor, Factor];
}

/** The result of `irr`: decimal strings with `digits` places. */
export interface IrrResult {
  /** The IRR floored to `digits` places: the same as `lower`. */
  readonly rate: string;
  /**
   * The IRR rounded down to `digits` places. Without a bracket, the NPV at `lower` has the
   * opposite sign to the NPV at `upper`, or is zero.
   */
  readonly lower: string;
  /** `lower` plus 10^−digits. */
  readonly upper: string;
}

/**
 * Excel's IRR, exactly: the rate at which the NPV of flows at periods 0, 1, 2… (the first value
 * undiscounted, as in Excel's IRR) is zero. The rate is exact to `digits` decimal places (default
 * 10), floored: `rate` is `lower`, the IRR rounded down, and the IRR lies between `lower` and
 * `upper`, 10^−digits apart. It is a polynomial root, irrational in general, so it is found by
 * bisection in exact integer arithmetic on the grid of `digits`-place decimals, with no floats and
 * no Newton steps; each step checks the NPV's sign alone, by Horner's rule on integers.
 *
 * Where Excel guesses, this throws a RangeError. The flows never change sign: there is no IRR
 * (Excel returns #NUM!). They change sign more than once: there can be several IRRs, and Excel
 * returns whichever its Newton iteration from `guess` finds; here a `bracket`, which replaces
 * `guess`, must select one, and the IRR returned is one inside it. The IRR is within 10^−digits of
 * −1, where the NPV is undefined: ask for more digits.
 *
 *     irr([money('-1000', 'EUR'), money('300', 'EUR'), money('400', 'EUR'), money('500', 'EUR')],
 *       { digits: 8 })   // { rate: '0.08896339', lower: '0.08896339', upper: '0.08896340' }
 */
export function irr(flows: readonly Money[], options?: IrrOptions): IrrResult {
  return irrOfMinors(flowMinors(flows).minors, options);
}

/** `irr` on flows as integers at one scale. */
function irrOfMinors(minors: readonly bigint[], options?: IrrOptions): IrrResult {
  const digits = options?.digits ?? 10;
  if (!(Number.isInteger(digits) && digits >= 0 && digits <= 100)) {
    invalid('digits', digits);
  }
  const { changes, firstSign } = signChanges(minors);
  const bracket = options?.bracket;
  if (changes === 0) {
    throw new RangeError('The cash flows never change sign, so they have no IRR');
  }
  if (changes > 1 && bracket === undefined) {
    throw new RangeError(
      `The cash flows change sign ${changes} times, so they can have several IRRs; pass a bracket`,
    );
  }

  // A rate of m / 10^digits: its growth factor's numerator is 10^digits + m over 10^digits.
  const unit = pow10n(digits);
  const signAt = (grid: bigint): -1 | 0 | 1 =>
    signOf(scaledPresentValue(minors, unit + grid, unit));
  const result = (grid: bigint): IrrResult => {
    // the NPV is undefined at -1, so a lower end there is no answer
    if (grid <= -unit) {
      throw new RangeError(`The IRR is within 10^-${digits} of -1; ask for more digits`);
    }
    const lower = formatScaled(grid, digits);
    return { rate: lower, lower, upper: formatScaled(grid + 1n, digits) };
  };
  const signAtRate = (candidate: Ratio) =>
    signOf(scaledPresentValue(minors, candidate.num + candidate.den, candidate.den));
  return bisectRate(signAt, result, unit, firstSign, bracket, signAtRate);
}

// ---------------------------------------------------------------------------------------------
// Annuities: Excel's FV, PV, PMT, NPER and RATE
// ---------------------------------------------------------------------------------------------

/** Options for `nper`. */
export interface NperOptions<C extends string> extends PvOptions<C> {
  /** Decimal places of the result (default 10, at most 100). */
  readonly digits?: number | undefined;
}

/** Options for `rate`. */
export interface RateOptions<C extends string> extends PvOptions<C> {
  /** Decimal places of the result (default 10, at most 100). */
  readonly digits?: number | undefined;
  /** Rates the result lies between, as for `irr`; it replaces Excel's `guess`. */
  readonly bracket?: readonly [Factor, Factor] | undefined;
}

/** The result of `nper`: decimal strings with `digits` places, and the exact value when it is rational. */
export interface NperResult {
  /** The number of periods floored to `digits` places: the same as `lower`. */
  readonly nper: string;
  /** The number of periods rounded down to `digits` places. */
  readonly lower: string;
  /** `lower` plus 10^−digits; the number of periods is below it. */
  readonly upper: string;
  /** The exact number of periods, when it is rational (always, at a rate of 0). */
  readonly exact?: Ratio;
}

/**
 * Excel's FV, exactly: the future value of `pmt` paid every period for `nper` periods at `rate`
 * per period, on top of a present value `pv`, with Excel's sign convention (money paid out is
 * negative, so deposits give a positive future value):
 * `−(pv·(1 + rate)^nper + pmt·(1 + rate·type)·((1 + rate)^nper − 1)/rate)`, and at a rate of 0,
 * `−(pv + pmt·nper)`. `fv` rounds it once.
 *
 * Unlike Excel, `nper` must be a whole number (a fractional power is irrational), and a rate at or
 * below −1 throws a RangeError.
 */
export function fvExact<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  payment: Money<C>,
  options?: FvOptions<C>,
): ExactMoney<C> {
  return toExactMoney(fvValue(ratePerPeriod, periods, payment, options, MAX_EXACT_POWER_BITS));
}

/**
 * Excel's FV, rounded once (to the currency's exponent with a mode, or to a policy's scale;
 * default 'halfExpand'). See `fvExact`.
 *
 *     fv('0.005', 10, money('-200', 'USD'), { pv: money('-500', 'USD'), type: 1 }) // 2581.40 USD
 */
export function fv<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  payment: Money<C>,
  options?: FvOptions<C>,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  return roundedValue(fvValue(ratePerPeriod, periods, payment, options), rounding);
}

/**
 * Excel's PV, exactly: the present value of `pmt` paid every period for `nper` periods at `rate`
 * per period, plus a future value `fv`, with Excel's sign convention:
 * `−(fv + pmt·(1 + rate·type)·((1 + rate)^nper − 1)/rate) / (1 + rate)^nper`, and at a rate of 0,
 * `−(fv + pmt·nper)`. `pv` rounds it once. As with `fvExact`, `nper` is a whole number and the rate
 * is above −1.
 */
export function pvExact<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  payment: Money<C>,
  options?: PvOptions<C>,
): ExactMoney<C> {
  return toExactMoney(pvValue(ratePerPeriod, periods, payment, options, MAX_EXACT_POWER_BITS));
}

/**
 * Excel's PV, rounded once (to the currency's exponent with a mode, or to a policy's scale;
 * default 'halfExpand'). See `pvExact`.
 *
 *     pv('0.08/12', 240, money('500', 'USD')) // -59777.15 USD
 */
export function pv<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  payment: Money<C>,
  options?: PvOptions<C>,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  return roundedValue(pvValue(ratePerPeriod, periods, payment, options), rounding);
}

/**
 * Excel's PMT, exactly: the payment per period that pays off (or saves up to) the amounts over
 * `nper` periods at `rate` per period, with Excel's sign convention:
 * `−(pv·(1 + rate)^nper + fv)·rate / ((1 + rate·type)·((1 + rate)^nper − 1))`, and at a rate of 0,
 * `−(pv + fv)/nper`. `pmt` rounds it once. `nper` is a whole number from 1, and the rate is above −1.
 */
export function pmtExact<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  present: Money<C>,
  options?: PvOptions<C>,
): ExactMoney<C> {
  return toExactMoney(pmtValue(ratePerPeriod, periods, present, options, MAX_EXACT_POWER_BITS));
}

/**
 * Excel's PMT, rounded once (to the currency's exponent with a mode, or to a policy's scale;
 * default 'halfExpand'). See `pmtExact`. It is the exact payment rounded, so paying it every period
 * leaves a residual; `amortise` builds a schedule that settles it.
 *
 *     pmt('0.08/12', 10, money('10000', 'USD')) // -1037.03 USD
 */
export function pmt<C extends string>(
  ratePerPeriod: Factor,
  periods: number,
  present: Money<C>,
  options?: PvOptions<C>,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  return roundedValue(pmtValue(ratePerPeriod, periods, present, options), rounding);
}

/**
 * Excel's RATE: the rate per period at which `pmt` every period for `nper` periods settles `pv`
 * and `fv`. Dividing RATE's equation by (1 + rate)^nper makes it the NPV of the flows it implies
 * (`pv` at period 0, `pmt` at periods 1 to nper, or 0 to nper − 1 with `type: 1`, and `fv` at
 * period nper), so this is `irr` of those flows, with its guarantees: exact to `digits` places,
 * floored, between `lower` and `upper`.
 *
 * Unlike Excel, which iterates from `guess` until it is within 0.0000001: `nper` is a whole number,
 * flows with several sign changes (so several possible rates) throw unless a `bracket`, which
 * replaces `guess`, selects one, where Excel returns whichever its iteration finds; and no sign
 * change throws, where Excel returns #NUM!.
 *
 *     rate(48, money('-200', 'USD'), money('8000', 'USD'), { digits: 8 }).rate // '0.00770147'
 */
export function rate<C extends string>(
  periods: number,
  payment: Money<C>,
  present: Money<C>,
  options?: RateOptions<C>,
): IrrResult {
  const count = wholePeriods(periods, 1);
  const digits = options?.digits ?? 10;
  if (!(Number.isInteger(digits) && digits >= 0 && digits <= 100)) {
    invalid('digits', digits);
  }
  const parts = annuity(0, options?.type, [payment, present, options?.fv]);
  const [paymentMinor, presentMinor, futureMinor] = parts.minors as [bigint, bigint, bigint];
  const type = parts.type;
  const unit = pow10n(digits);
  // The flows RATE implies, for the sign rules: pv (+ pmt) at 0, pmt between, pmt (or 0) + fv at
  // nper. Their sign changes don't depend on nper beyond 2, so three stand for them all.
  const implied =
    type === 1n
      ? [presentMinor + paymentMinor, paymentMinor, futureMinor]
      : [presentMinor, paymentMinor, paymentMinor + futureMinor];
  if (count === 1n) {
    implied.splice(1, 1);
  }
  const { changes, firstSign } = signChanges(implied);
  const bracket = options?.bracket;
  if (changes === 0) {
    throw new RangeError('The cash flows never change sign, so they have no rate');
  }
  if (changes > 1 && bracket === undefined) {
    throw new RangeError(
      `The cash flows change sign ${changes} times, so they can have several rates; pass a bracket`,
    );
  }
  // The NPV of those flows is f / (1 + r)^n with f = pv·G + pmt·(1 + r·type)·(G − 1)/r + fv and
  // G = (1 + r)^n, so it has f's sign. For r = a/b, f·a·b^n is
  // H = pv·a·(a + b)^n + pmt·(b + a·type)·((a + b)^n − b^n) + fv·a·b^n, an integer by squaring
  // (no Horner's rule over nper flows), so sign(f) = sign(H)·sign(a), and pv + pmt·n + fv at 0.
  const signAtRate = (candidate: Ratio): -1 | 0 | 1 => {
    const rateNum = candidate.num;
    const rateDen = candidate.den;
    if (rateNum === 0n) {
      return signOf(presentMinor + paymentMinor * count + futureMinor);
    }
    // checked at every rate tried (grid points, the doubling search and a bracket's ends), since
    // a candidate can be far larger than 1 + rate at the answer
    const larger = rateNum + rateDen > rateDen ? rateNum + rateDen : rateDen;
    assertPowerSize(larger, count, 'rate', MAX_RATE_POWER_BITS);
    const growth = (rateNum + rateDen) ** count;
    const base = rateDen ** count;
    const scaled =
      presentMinor * rateNum * growth +
      paymentMinor * (rateDen + rateNum * type) * (growth - base) +
      futureMinor * rateNum * base;
    return (signOf(scaled) * signOf(rateNum)) as -1 | 0 | 1;
  };
  const signAt = (grid: bigint) => signAtRate({ num: grid, den: unit, n: NaN, d: NaN });
  const result = (grid: bigint): IrrResult => {
    if (grid <= -unit) {
      throw new RangeError(`The rate is within 10^-${digits} of -1; ask for more digits`);
    }
    const lower = formatScaled(grid, digits);
    return { rate: lower, lower, upper: formatScaled(grid + 1n, digits) };
  };
  return bisectRate(signAt, result, unit, firstSign, bracket, signAtRate);
}

/**
 * Excel's NPER: the number of periods in which `pmt` every period at `rate` per period settles
 * `pv` and `fv`: `ln((pmt·(1 + rate·type) − fv·rate) / (pmt·(1 + rate·type) + pv·rate)) /
 * ln(1 + rate)`, and at a rate of 0, `−(pv + fv)/pmt`. Like Excel, it can be fractional or
 * negative.
 *
 * The logarithms are irrational in general, so the result is to `digits` decimal places (default
 * 10), floored: the number of periods lies in [`lower`, `upper`), 10^−digits apart. Each logarithm
 * is bounded by rational intervals from its series with the tail and every rounding bounded, and
 * the bounds are tightened until they fix the floored value; `exact` is set when the number of
 * periods is rational (at a rate of 0, or when the growth is a power of 1 + rate). Excel's value,
 * a double, is within its own rounding of [`lower`, `upper`].
 *
 * It throws a RangeError where Excel returns #NUM! or #DIV/0!: the logarithm of a number at or
 * below zero (the payments never settle the amounts), or no payment at a rate of 0.
 *
 *     nper('0.01', money('-100', 'USD'), money('-1000', 'USD'), { fv: money('10000', 'USD'),
 *       type: 1, digits: 7 }).nper // '59.6738656'
 */
export function nper<C extends string>(
  ratePerPeriod: Factor,
  payment: Money<C>,
  present: Money<C>,
  options?: NperOptions<C>,
): NperResult {
  const digits = options?.digits ?? 10;
  if (!(Number.isInteger(digits) && digits >= 0 && digits <= 100)) {
    invalid('digits', digits);
  }
  const parts = annuity(ratePerPeriod, options?.type, [payment, present, options?.fv]);
  const [paymentMinor, presentMinor, futureMinor] = parts.minors as [bigint, bigint, bigint];
  const { a, b, type } = parts;
  const unit = pow10n(digits);
  const result = (grid: bigint, exactValue?: Ratio): NperResult => {
    const lower = formatScaled(grid, digits);
    const upper = formatScaled(grid + 1n, digits);
    return exactValue === undefined
      ? { nper: lower, lower, upper }
      : { nper: lower, lower, upper, exact: exactValue };
  };
  if (a === 0n) {
    if (paymentMinor === 0n) {
      throw new RangeError('With no payment at a rate of 0, the number of periods is undefined');
    }
    const exactValue = ratio(-(presentMinor + futureMinor), paymentMinor);
    return result(floorDivide(exactValue.num * unit, exactValue.den), exactValue);
  }
  // with r = a/b: (pmt·(b + a·type) − fv·a) / (pmt·(b + a·type) + pv·a), all over b
  const paid = paymentMinor * (b + a * type);
  const growthNumerator = paid - futureMinor * a;
  const growthDenominator = paid + presentMinor * a;
  if (
    growthDenominator === 0n ||
    growthNumerator === 0n ||
    growthNumerator < 0n !== growthDenominator < 0n
  ) {
    throw new RangeError(
      'The payments never settle these amounts, so there is no number of periods',
    );
  }
  const growth = ratio(growthNumerator, growthDenominator);
  const base = ratio(a + b, b);

  // Bound ln(growth) / ln(base) by intervals, with more bits until the floor on the grid is fixed.
  let separated = false;
  for (let bits = 64 + 4 * digits; bits <= MAX_LOG_BITS; bits *= 2) {
    const [growthLow, growthHigh] = lnInterval(growth, bits);
    const [baseLow, baseHigh] = lnInterval(base, bits);
    if (baseLow <= 0n && baseHigh >= 0n) {
      continue; // ln(base) not yet separated from 0
    }
    separated = true;
    // the quotient's extremes are among the four ratios of the ends
    let low: bigint | undefined;
    let high: bigint | undefined;
    for (const numerator of [growthLow, growthHigh]) {
      for (const denominator of [baseLow, baseHigh]) {
        const grid = floorDivide(numerator * unit, denominator);
        low = low === undefined || grid < low ? grid : low;
        high = high === undefined || grid > high ? grid : high;
      }
    }
    if (low === high) {
      // the floor is fixed; the value is exact if it is the grid point itself
      const candidate = ratio(low as bigint, unit);
      return isPowerOf(growth, base, candidate)
        ? result(low as bigint, candidate)
        : result(low as bigint);
    }
    if ((high as bigint) - (low as bigint) === 1n) {
      // the bounds straddle the grid point `high`: it is the answer if it is exact
      const candidate = ratio(high!, unit);
      if (isPowerOf(growth, base, candidate)) {
        return result(high!, candidate);
      }
    }
  }
  throw new RangeError(
    separated
      ? `The number of periods is too close to a ${digits}-place decimal to settle`
      : `The rate is too close to 0 to bound ln(1 + rate) within ${MAX_LOG_BITS} bits`,
  );
}

/**
 * The most bits `nper` bounds its logarithms to before it gives up: 100 digits need about 400, and
 * a rate as small as 10^-12 about 40 more, so this is reached only by a result within about
 * 2^-16000 of a grid point, which would otherwise take ever longer series.
 */
const MAX_LOG_BITS = 16_384; // 2^14

/** Whether growth = base^(p/q) exactly, for p/q reduced: base must be a perfect qth power. */
function isPowerOf(growth: Ratio, base: Ratio, exponent: Ratio): boolean {
  if (exponent.num === 0n) {
    return growth.num === growth.den;
  }
  const rootNum = exactRoot(base.num, exponent.den);
  const rootDen = exactRoot(base.den, exponent.den);
  if (rootNum === undefined || rootDen === undefined) {
    return false;
  }
  const power = exponent.num < 0n ? -exponent.num : exponent.num;
  const [targetNum, targetDen] =
    exponent.num < 0n ? [growth.den, growth.num] : [growth.num, growth.den];
  // root^power has at least (bits(root) − 1)·power bits: when that is more than the target has,
  // they can't be equal, and the power (nper times the root's size) is never computed
  const tooBig = (root: bigint, target: bigint) =>
    BigInt(root.toString(2).length - 1) * power > BigInt(target.toString(2).length);
  if (tooBig(rootNum, targetNum) || tooBig(rootDen, targetDen)) {
    return false;
  }
  const [num, den] =
    exponent.num < 0n ? [rootDen ** power, rootNum ** power] : [rootNum ** power, rootDen ** power];
  return num === growth.num && den === growth.den;
}

/**
 * Integers [low, high] with low / 2^bits ≤ ln(value) ≤ high / 2^bits, for a positive value:
 * ln(value) = k·ln 2 + 2·atanh(z) with value / 2^k in (1/2, 2) and z = (y − 1)/(y + 1), so
 * |z| < 1/3, and ln 2 = 2·atanh(1/3).
 */
function lnInterval(value: Ratio, bits: number): [bigint, bigint] {
  const shift = value.num.toString(2).length - value.den.toString(2).length;
  // y = value / 2^shift, in (1/2, 2)
  const yNum = shift >= 0 ? value.num : value.num << BigInt(-shift);
  const yDen = shift >= 0 ? value.den << BigInt(shift) : value.den;
  const [zLow, zHigh] = atanhInterval(yNum - yDen, yNum + yDen, bits);
  let low = 2n * zLow;
  let high = 2n * zHigh;
  if (shift !== 0) {
    const [twoLow, twoHigh] = atanhInterval(1n, 3n, bits);
    const k = BigInt(shift);
    low += k > 0n ? 2n * k * twoLow : 2n * k * twoHigh;
    high += k > 0n ? 2n * k * twoHigh : 2n * k * twoLow;
  }
  return [low, high];
}

/**
 * Integers [low, high] with low / 2^bits ≤ atanh(num/den) ≤ high / 2^bits, for |num/den| ≤ 1/3:
 * the series Σ z^(2j+1)/(2j+1) in fixed point. Each power is floored from the last, so it is at
 * most j + 1 units below the exact one, and each term at most 2 units; the series stops when the
 * power reaches 0, where the tail is below (j + 1)·9/8 units.
 */
function atanhInterval(num: bigint, den: bigint, bits: number): [bigint, bigint] {
  if (num < 0n) {
    const [low, high] = atanhInterval(-num, den, bits);
    return [-high, -low];
  }
  const square = num * num;
  const squareDen = den * den;
  let power = (num << BigInt(bits)) / den;
  let sum = 0n;
  let terms = 0n;
  while (power !== 0n) {
    sum += power / (2n * terms + 1n);
    terms++;
    power = (power * square) / squareDen;
  }
  // each term is at most 2 units low, and the tail is at most 2·(terms + 1) units
  return [sum, sum + 4n * terms + 4n];
}
