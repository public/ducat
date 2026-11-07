import { currencyExponent } from './currency.js';
import { ratio, type Factor, type Ratio } from './decimal.js';
import { add, CurrencyMismatchError, make, mulRatio, subtract, type CurrencyInput, type Money } from './money.js';
import { DEFAULT_ROUNDING, type RoundingMode } from './rounding.js';

const percentRatio = (p: Factor): Ratio => {
  const r = ratio(p);
  return ratio(r.num, r.den * 100n);
};

/** percent% of m: percentage(EUR 80, '12.5', 'halfEven') = EUR 10.00. Rounding defaults to 'halfExpand'. */
export function percentage<C extends string>(
  m: Money<C>,
  percent: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Money<C> {
  return mulRatio(m, percentRatio(percent), rounding);
}

export interface TaxBreakdown<C extends string> {
  readonly net: Money<C>;
  readonly tax: Money<C>;
  /** Always exactly net + tax. */
  readonly gross: Money<C>;
}

/** Tax-exclusive: adds percent% tax to a net amount. addTax(EUR 10, '20', 'halfEven') -> net 10, tax 2, gross 12. */
export function addTax<C extends string>(
  net: Money<C>,
  percent: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): TaxBreakdown<C> {
  const tax = mulRatio(net, percentRatio(percent), rounding);
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
  const p = ratio(percent);
  // 1 / (1 + p/100) = 100 den / (100 den + num)
  const net = mulRatio(gross, ratio(100n * p.den, 100n * p.den + p.num), rounding);
  return { net, tax: subtract(gross, net), gross };
}

/** Price after a percent% discount; the discount amount is rounded with `rounding`. */
export function discount<C extends string>(
  price: Money<C>,
  percent: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Money<C> {
  return subtract(price, mulRatio(price, percentRatio(percent), rounding));
}

export interface ConvertOptions {
  /** Result scale (default: the target currency's exponent). */
  readonly scale?: number;
}

/**
 * Converts at an explicit rate (units of `to` per unit of m's currency), e.g. '1.0832' as a string
 * so no float is ever involved. The result is rounded once, to the target currency's exponent.
 *
 *     convert(money('100', 'EUR'), 'USD', '1.0832', 'halfEven')   // 108.32 USD
 *     convert(money('100', 'EUR'), 'JPY', '162.457', 'halfEven')  // 16246 JPY
 */
export function convert<To extends CurrencyInput, C extends string = string>(
  m: Money<C>,
  to: To,
  rate: Factor,
  rounding: RoundingMode = DEFAULT_ROUNDING,
  options?: ConvertOptions,
): Money<To> {
  const r = ratio(rate);
  if (r.num <= 0n) throw new RangeError('Exchange rate must be positive');
  const scale = options?.scale ?? currencyExponent(to);
  const res = mulRatio(m, r, rounding, scale);
  return make(to, res.minor, scale);
}

/**
 * An exchange rate pinned to a currency pair, so converting the wrong currency is a type error.
 *     const eurUsd = exchangeRate('EUR', 'USD', '1.0832');
 *     eurUsd.convert(money('100', 'EUR'), 'halfEven');
 */
export function exchangeRate<From extends CurrencyInput, To extends CurrencyInput>(from: From, to: To, rate: Factor) {
  const r = ratio(rate);
  return {
    from,
    to,
    rate: r,
    convert(m: Money<From>, rounding: RoundingMode = DEFAULT_ROUNDING, options?: ConvertOptions): Money<To> {
      if (m.currency !== from) throw new CurrencyMismatchError(from, m.currency);
      return convert(m, to, r, rounding, options);
    },
    inverse() {
      return exchangeRate(to, from, ratio(r.den, r.num));
    },
  };
}
