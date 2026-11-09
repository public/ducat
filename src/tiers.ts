// Tiered (graduated) and volume pricing, in the style of Stripe's price tiers: exact arithmetic, one
// rounding for the total, and a breakdown per tier whose amounts sum exactly to that total.
import { currencyExponent } from './currency.js';
import { pow10n, ratio, ratioToDecimal, type Factor, type Ratio } from './decimal.js';
import { ExactMoney } from './exact.js';
import {
  CurrencyMismatchError,
  make,
  multiplyByRatio,
  type Money,
  type RoundingInput,
} from './money.js';
import { DEFAULT_ROUNDING } from './rounding.js';

/**
 * A quantity, exactly and not negative: an integer, bigint, decimal string ('1.5' for metered
 * usage), 'a/b' string ('250/3'), `ratio()` or `Fixed`. A non-integer number is read at its
 * shortest decimal form, as factors are.
 */
export type Quantity = Factor;

/**
 * One price tier. It covers quantities above the previous tier's `upTo`, up to and including its
 * own. The last tier may be open: `upTo` 'inf', `null` or `Infinity`.
 */
export interface PriceTier<C extends string> {
  /** The tier's upper bound, inclusive; 'inf', `null` or `Infinity` for no limit. */
  readonly upTo: Quantity | 'inf' | null;
  /** The price per unit in this tier; it may have more decimals than the currency ('0.0025'). */
  readonly unitAmount?: Money<C>;
  /** A fixed amount charged once when the quantity falls in (or, graduated, reaches) this tier. */
  readonly flatAmount?: Money<C>;
}

/**
 * How tiers price a quantity:
 * - 'graduated': each tier prices the units that fall in it, and the charges add up (Stripe's
 *   `tiers_mode: 'graduated'`);
 * - 'volume': the tier the whole quantity falls in prices every unit (`tiers_mode: 'volume'`).
 */
export type TiersMode = 'graduated' | 'volume';

/** Options for `tieredPrice`. */
export interface TieredPriceOptions<C extends string> {
  readonly mode: TiersMode;
  /** The tiers, in increasing `upTo` order. */
  readonly tiers: readonly PriceTier<C>[];
  /**
   * How the total is rounded: a mode, to the currency's exponent, or a rounding policy (default
   * 'halfExpand').
   */
  readonly rounding?: RoundingInput;
  /**
   * What a quantity past a bounded last tier does: 'throw' (the default), or 'cap', which charges
   * as if the quantity were the last tier's `upTo`, so nothing more is charged past it. The cap is
   * on the quantity that chooses (and, by default, is charged by) the tier: a `chargeQuantity` is
   * not capped, and the last tier's unit amount applies to all of it.
   */
  readonly beyondLastTier?: 'throw' | 'cap';
  /**
   * In 'volume' mode, the quantity the chosen tier's `unitAmount` is multiplied by, when it isn't
   * the quantity that chose the tier: tiers by meter count, say, priced per unit used. The tier's
   * `flatAmount` is still charged once. Graduated tiers split the quantity across tiers, so there is
   * no one tier to apply to another quantity, and this throws there.
   */
  readonly chargeQuantity?: Quantity;
}

/** One line of a tiered price's breakdown: a tier the quantity reached. */
export interface TierLine<C extends string> {
  /** The tier's index in `tiers`. */
  readonly tier: number;
  /** The units priced in this tier, as a decimal string ('num/den' when it doesn't terminate). */
  readonly quantity: string;
  /** The exact charge: quantity × unit amount + flat amount. */
  readonly exact: ExactMoney<C>;
  /**
   * The charge rounded so that the lines sum exactly to the total: each line is the rounded
   * running total minus the rounded running total before it.
   */
  readonly amount: Money<C>;
}

/** The result of `tieredPrice`. */
export interface TieredPrice<C extends string> {
  /** The exact total, rounded once. */
  readonly total: Money<C>;
  /** The exact total. */
  readonly exact: ExactMoney<C>;
  /**
   * The tiers the quantity reached, in order (one in 'volume' mode), even when one charges nothing
   * (quantity 0 in a tier without a flat amount); their `amount`s sum to `total`.
   */
  readonly lines: TierLine<C>[];
}

/** The quantity as an exact ratio, checked to be non-negative. */
function quantityRatio(quantity: Quantity, name: string): Ratio {
  const value = ratio(quantity);
  if (value.num < 0n) {
    throw new RangeError(`Invalid ${name} ${decimalOf(value)}; it must not be negative`);
  }
  return value;
}

/** left < right for ratios with positive denominators. */
function isLess(left: Ratio, right: Ratio): boolean {
  return left.num * right.den < right.num * left.den;
}

/** A ratio as a decimal string when it terminates, else as 'num/den'. */
function decimalOf(value: Ratio): string {
  return ratioToDecimal(value) ?? `${value.num}/${value.den}`;
}

function subtractRatio(left: Ratio, right: Ratio): Ratio {
  return ratio(left.num * right.den - right.num * left.den, left.den * right.den);
}

/** num/den major units rounded once, at the currency's exponent or the policy's scale. */
function roundExact<C extends string>(amount: ExactMoney<C>, rounding: RoundingInput): Money<C> {
  const unit = make(amount.currency, 1, 0);
  const factor = ratio(amount.num, amount.den);
  return multiplyByRatio(unit, factor, rounding, currencyExponent(amount.currency));
}

function exactOf<C extends string>(money: Money<C>): ExactMoney<C> {
  return new ExactMoney(money.currency, BigInt(money.minor), pow10n(money.scale));
}

/**
 * The price of `quantity` under tiered pricing, exactly, with the total rounded once and a
 * breakdown per tier. Tier bounds are inclusive (`upTo: 10` covers the 10th unit), as Stripe's are.
 * Quantity 0 falls in the first tier, so its flat amount (a base fee) is charged; in 'graduated'
 * mode a later tier's flat amount is charged once the quantity goes past the tier before it.
 *
 *     tieredPrice(1500, {
 *       mode: 'graduated',
 *       tiers: [
 *         { upTo: 1000, unitAmount: money('0.10', 'EUR') },
 *         { upTo: 'inf', unitAmount: money('0.08', 'EUR') },
 *       ],
 *     }).total   // 140.00 EUR
 */
export function tieredPrice<C extends string>(
  quantity: Quantity,
  options: TieredPriceOptions<C>,
): TieredPrice<C> {
  const { mode, tiers } = options;
  const rounding = options.rounding ?? DEFAULT_ROUNDING;
  const beyondLastTier = options.beyondLastTier ?? 'throw';
  if (mode !== 'graduated' && mode !== 'volume') {
    throw new RangeError(`Invalid tiers mode ${String(mode)}`);
  }
  if (beyondLastTier !== 'throw' && beyondLastTier !== 'cap') {
    throw new RangeError(`Invalid beyondLastTier ${String(beyondLastTier)}; use 'throw' or 'cap'`);
  }
  if (options.chargeQuantity !== undefined && mode !== 'volume') {
    throw new TypeError("chargeQuantity needs mode 'volume': graduated tiers split the quantity");
  }
  if (tiers.length === 0) {
    throw new RangeError('tieredPrice needs at least one tier');
  }
  let amount = quantityRatio(quantity, 'quantity');

  // The currency comes from the tiers' amounts, which must all share it.
  let currency: C | undefined;
  for (const tier of tiers) {
    for (const price of [tier.unitAmount, tier.flatAmount]) {
      if (price === undefined) {
        continue;
      }
      if (currency === undefined) {
        currency = price.currency;
      } else if (price.currency !== currency) {
        throw new CurrencyMismatchError(currency, price.currency);
      }
    }
  }
  if (currency === undefined) {
    throw new RangeError('The tiers need a unitAmount or a flatAmount');
  }

  // Bounds: increasing, positive, and open only last.
  const bounds: (Ratio | undefined)[] = [];
  let previous: Ratio = ratio(0);
  tiers.forEach((tier, index) => {
    const upTo = tier.upTo;
    if (upTo === 'inf' || upTo === null || upTo === Infinity) {
      if (index !== tiers.length - 1) {
        throw new RangeError(
          `Tier ${index} is open (upTo ${String(upTo)}), but only the last tier can be`,
        );
      }
      bounds.push(undefined);
      return;
    }
    const bound = quantityRatio(upTo, 'upTo');
    if (!isLess(previous, bound)) {
      const after = index === 0 ? 'above 0' : `above tier ${index - 1}'s ${decimalOf(previous)}`;
      throw new RangeError(
        `Tier bounds must increase: tier ${index}'s upTo ${decimalOf(bound)} is not ${after}`,
      );
    }
    bounds.push(bound);
    previous = bound;
  });
  const lastBound = bounds[bounds.length - 1];
  if (lastBound !== undefined && isLess(lastBound, amount)) {
    if (beyondLastTier === 'throw') {
      throw new RangeError(
        `The quantity ${decimalOf(amount)} is beyond the last tier (upTo ${decimalOf(lastBound)}); pass { beyondLastTier: 'cap' } to charge nothing past it`,
      );
    }
    amount = lastBound;
  }
  const chargeAmount =
    options.chargeQuantity === undefined
      ? undefined
      : quantityRatio(options.chargeQuantity, 'chargeQuantity');

  const zero = new ExactMoney(currency, 0n, 1n);
  const charge = (tier: PriceTier<C>, units: Ratio): ExactMoney<C> => {
    let result = zero;
    if (tier.unitAmount !== undefined) {
      result = result.add(exactOf(tier.unitAmount).multiply(units));
    }
    if (tier.flatAmount !== undefined) {
      result = result.add(exactOf(tier.flatAmount));
    }
    return result;
  };

  // The tiers that charge, with the units each prices.
  const charged: { tier: number; units: Ratio }[] = [];
  let lower: Ratio = ratio(0);
  for (let i = 0; i < tiers.length; i++) {
    const upper = bounds[i];
    const isInTier = upper === undefined || !isLess(upper, amount);
    if (mode === 'volume') {
      if (isInTier) {
        charged.push({ tier: i, units: chargeAmount ?? amount });
        break;
      }
    } else {
      // the first tier always charges (quantity 0 is in it); a later one once the quantity is past
      // the tier before it
      if (i > 0 && !isLess(lower, amount)) {
        break;
      }
      const top = isInTier ? amount : upper;
      charged.push({ tier: i, units: subtractRatio(top, lower) });
      if (isInTier) {
        break;
      }
      lower = upper;
    }
  }

  // Lines round their running totals, so they sum exactly to the rounded total.
  const lines: TierLine<C>[] = [];
  let running = zero;
  let roundedBefore = make(currency, 0, 0);
  let roundedRunning = roundedBefore;
  for (const { tier, units } of charged) {
    const lineExact = charge(tiers[tier]!, units);
    running = running.add(lineExact);
    roundedRunning = roundExact(running, rounding);
    const lineAmount = make(
      currency,
      BigInt(roundedRunning.minor) -
        BigInt(roundedBefore.minor) * pow10n(roundedRunning.scale - roundedBefore.scale),
      roundedRunning.scale,
    );
    lines.push({
      tier,
      quantity: decimalOf(units),
      exact: lineExact,
      amount: lineAmount,
    });
    roundedBefore = roundedRunning;
  }
  return { total: roundedRunning, exact: running, lines };
}
