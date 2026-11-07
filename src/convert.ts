import { currencyExponent } from './currency.js';
import { ratio, type Factor } from './decimal.js';
import { CurrencyMismatchError, make, mulRatio, type CurrencyInput, type Money } from './money.js';
import { DEFAULT_ROUNDING, type RoundingMode } from './rounding.js';

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
