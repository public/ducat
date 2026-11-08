/**
 * `@ducatjs/money/policy`: rounding policies, reusable values for a scale, an increment and a
 * rounding mode ("CHF cash", "4 decimals, half even"), accepted wherever a rounding mode is. The
 * core only hands the work to the policy, so none of this code is in a bundle that never imports
 * this entry (or `cashPolicy` from `@ducatjs/money/cash`).
 */
import { currencyExponent } from './currency.js';
import type { Ratio } from './decimal.js';
import {
  CurrencyMismatchError,
  multiply,
  multiplyByRatio,
  ratio,
  type Money,
  type RoundingPolicy,
} from './money.js';
import { DEFAULT_ROUNDING, Rounding, type RoundingMode } from './rounding.js';

export type { RoundingInput, RoundingPolicy } from './money.js';

/** Options for `roundingPolicy`. Every field is optional. */
export interface RoundingPolicyOptions {
  /** Decimal places of the result (default: the currency's ISO exponent). */
  readonly scale?: number;
  /** A positive safe integer count of 10^-scale units to round to (default 1). */
  readonly increment?: number;
  /** The rounding mode (default 'halfExpand'). */
  readonly rounding?: RoundingMode;
  /** Restrict the policy to one currency. */
  readonly currency?: string;
}

const ONE = ratio(1);
const MODES = new Set<unknown>(Object.values(Rounding));

/**
 * Builds a reusable rounding policy (see `RoundingPolicy`). The options are checked here, once, so
 * applying the policy needs no checks.
 *
 *     const unitPrice = roundingPolicy({ scale: 4, rounding: 'halfEven' })
 *     const fiveCents = roundingPolicy({ increment: 5 })   // 0.05 in a 2-decimal currency
 */
export function roundingPolicy(options: RoundingPolicyOptions = {}): RoundingPolicy {
  const scale = options.scale;
  const increment = options.increment ?? 1;
  const rounding = options.rounding ?? DEFAULT_ROUNDING;
  const currency = options.currency;

  if (scale !== undefined && !(Number.isSafeInteger(scale) && scale >= 0)) {
    throw new RangeError(`Invalid scale ${scale}`);
  }
  if (!(Number.isSafeInteger(increment) && increment >= 1)) {
    throw new RangeError(`Invalid increment ${increment}; it must be a positive integer`);
  }
  if (!MODES.has(rounding)) {
    throw new RangeError(`Invalid rounding mode ${String(rounding)}`);
  }

  const incrementAsBigint = BigInt(increment);

  // money × factor rounded once to the policy: with an increment, count whole increments
  // (money × factor / increment, rounded at the policy's scale) and multiply back, which is
  // rounding to the nearest multiple of the increment. The count's ratio is left unreduced: the
  // division rounds the same either way, and a gcd per call would cost more than it saves.
  const roundProduct = <C extends string>(money: Money<C>, factor: Ratio): Money<C> => {
    if (currency !== undefined && currency !== money.currency) {
      throw new CurrencyMismatchError(currency, money.currency);
    }
    const resultScale = scale ?? currencyExponent(money.currency);
    if (increment === 1) {
      return multiplyByRatio(money, factor, rounding, resultScale);
    }
    const stepDenominator = factor.d * increment;
    const perStep: Ratio = {
      num: factor.num,
      den: factor.den * incrementAsBigint,
      n: factor.n,
      // NaN (not a safe integer) sends multiplyByRatio down its bigint path
      d: Number.isSafeInteger(stepDenominator) ? stepDenominator : NaN,
    };
    return multiply(multiplyByRatio(money, perStep, rounding, resultScale), increment);
  };

  const policy = <C extends string>(money: Money<C>): Money<C> => roundProduct(money, ONE);
  return Object.freeze(
    Object.assign(policy, { scale, increment, rounding, currency, roundProduct }),
  );
}

/**
 * Rounding to the currency's ISO exponent, half up: the policy most amounts should end with.
 * `assertScale(m, isoPolicy)` checks that an amount is already there.
 */
export const isoPolicy: RoundingPolicy = /* @__PURE__ */ roundingPolicy();

/**
 * Throws a RangeError unless `money` is exactly what `policy` produces: at the policy's scale and a
 * multiple of its increment (and in its currency, if it has one). Use it where an amount must
 * already be rounded, such as before booking it or sending it to a processor.
 */
export function assertScale(money: Money, policy: RoundingPolicy): void {
  if (policy.currency !== undefined && policy.currency !== money.currency) {
    throw new CurrencyMismatchError(policy.currency, money.currency);
  }
  const scale = policy.scale ?? currencyExponent(money.currency);
  if (money.scale !== scale) {
    throw new RangeError(`${money} has scale ${money.scale}, expected ${scale}`);
  }
  const minor = money.minor;
  const increment = policy.increment;
  const isMultiple =
    typeof minor === 'number' ? minor % increment === 0 : minor % BigInt(increment) === 0n;
  if (!isMultiple) {
    throw new RangeError(`${money} is not a multiple of ${increment} at scale ${scale}`);
  }
}
