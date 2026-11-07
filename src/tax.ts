import { ratio, type Factor, type Ratio } from './decimal.js';
import { add, multiplyByRatio, subtract, type Money } from './money.js';
import { DEFAULT_ROUNDING, type RoundingMode } from './rounding.js';

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
  rounding: RoundingMode = DEFAULT_ROUNDING,
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
 * 2, gross 12.
 */
export function addTax<C extends string>(
  net: Money<C>,
  percent: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): TaxBreakdown<C> {
  const tax = multiplyByRatio(net, percentRatio(percent), rounding);
  const gross = add(net, tax);
  return { net, tax, gross };
}

/**
 * Tax-inclusive: extracts percent% tax contained in a gross amount (VAT extraction).
 * net = gross / (1 + percent/100) rounded; tax = gross - net, so the parts always add up.
 * extractTax(EUR 12, '20', 'halfEven') -> net 10.00, tax 2.00.
 */
export function extractTax<C extends string>(
  gross: Money<C>,
  percent: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): TaxBreakdown<C> {
  const percentRatio = ratio(percent);
  // 1 / (1 + p/100) = 100 den / (100 den + num)
  const net = multiplyByRatio(
    gross,
    ratio(100n * percentRatio.den, 100n * percentRatio.den + percentRatio.num),
    rounding,
  );
  return { net, tax: subtract(gross, net), gross };
}

/** Price after a percent% discount; the discount amount is rounded with `rounding`. */
export function discount<C extends string>(
  price: Money<C>,
  percent: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Money<C> {
  return subtract(price, multiplyByRatio(price, percentRatio(percent), rounding));
}
