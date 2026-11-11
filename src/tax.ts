import { ratio, type Factor, type Ratio } from './decimal.js';
import {
  add,
  multiplyByRatio,
  roundWithPolicy,
  subtract,
  type Money,
  type RoundingInput,
} from './money.js';
import { DEFAULT_ROUNDING } from './rounding.js';

const percentRatio = (percent: Factor): Ratio => {
  const asRatio = ratio(percent);
  return ratio(asRatio.num, asRatio.den * 100n);
};

/**
 * percent% of m: percentage(EUR 80, '12.5', 'halfEven') = EUR 10.00. Rounding defaults to
 * 'halfExpand'.
 */
export function percentage<C extends string>(
  money: Money<C>,
  percent: Factor,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  return multiplyByRatio(money, percentRatio(percent), rounding);
}

/** A tax split: net + tax is always exactly gross. */
export interface TaxBreakdown<C extends string> {
  readonly net: Money<C>;
  readonly tax: Money<C>;
  /** Always exactly net + tax. */
  readonly gross: Money<C>;
}

/**
 * Tax-exclusive: adds percent% tax to a net amount. addTax(EUR 10, '20', 'halfEven') -> net 10, tax
 * 2, gross 12. A rounding mode rounds the tax; a rounding policy rounds the gross (the amount
 * charged) to its scale and increment. The other part is always the exact difference.
 */
export function addTax<C extends string>(
  net: Money<C>,
  percent: Factor,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): TaxBreakdown<C> {
  // A rounding mode rounds the tax; a policy rounds the gross, the amount charged, so it lands on
  // the policy's increment (CHF 0.05 for cash). Either way the other part is the exact difference.
  if (typeof rounding === 'function') {
    const percentAsRatio = ratio(percent);
    const gross = roundWithPolicy(
      net,
      ratio(100n * percentAsRatio.den + percentAsRatio.num, 100n * percentAsRatio.den),
      rounding,
    );
    return { net, tax: subtract(gross, net), gross };
  }
  const tax = multiplyByRatio(net, percentRatio(percent), rounding);
  const gross = add(net, tax);
  return { net, tax, gross };
}

/**
 * Tax-inclusive: extracts percent% tax contained in a gross amount (VAT extraction).
 * net = gross / (1 + percent/100) rounded; tax = gross - net, so the parts always add up.
 * extractTax(EUR 12, '20', 'halfEven') -> net 10.00, tax 2.00. A rounding policy rounds the net; the
 * tax is on the policy's increment too whenever the gross is. A percent of -100 or below throws a
 * RangeError: no net amount has that gross.
 */
export function extractTax<C extends string>(
  gross: Money<C>,
  percent: Factor,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): TaxBreakdown<C> {
  const percentAsRatio = ratio(percent);
  // 1 / (1 + p/100) = 100 den / (100 den + num)
  const grossShare = 100n * percentAsRatio.den + percentAsRatio.num;
  if (grossShare <= 0n) {
    throw new RangeError(`extractTax: percent must be greater than -100, got ${percent}`);
  }
  const net = multiplyByRatio(gross, ratio(100n * percentAsRatio.den, grossShare), rounding);
  return { net, tax: subtract(gross, net), gross };
}

/**
 * Price after a percent% discount. A rounding mode rounds the discount amount; a rounding policy
 * rounds the discounted price itself, so the price lands on the policy's scale and increment.
 */
export function discount<C extends string>(
  price: Money<C>,
  percent: Factor,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  if (typeof rounding === 'function') {
    const percentAsRatio = ratio(percent);
    return roundWithPolicy(
      price,
      ratio(100n * percentAsRatio.den - percentAsRatio.num, 100n * percentAsRatio.den),
      rounding,
    );
  }
  return subtract(price, multiplyByRatio(price, percentRatio(percent), rounding));
}
