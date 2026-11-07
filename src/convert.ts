// `ducat/convert` free functions: exact exchange rates and conversion that rounds once.
import { currencyExponent } from './currency.js';
import { ratio, type Factor } from './decimal.js';
import { make, type CurrencyInput, type Money } from './money.js';
import { isRate, multiplyByRatioAtScale, type ConvertOptions, type Rate } from './rate.js';
import { DEFAULT_ROUNDING, type RoundingMode } from './rounding.js';

export {
  exchangeRate,
  impliedRate,
  isRate,
  multiplyByRatioAtScale,
  Rate,
  rateFromJSON,
  type ConvertOptions,
  type RateInfo,
  type RateJSON,
  type RateType,
} from './rate.js';

/**
 * Converts `money` at a Rate, rounding once to the target currency's exponent (or `options.scale`).
 * The rate's pair is checked, at compile time for literal currencies and at run time otherwise.
 *
 *     convert(money('100', 'EUR'), eurUsd, 'halfEven')               // 111.65 USD
 *     convert(money('100', 'USD'), eurUsd.inverse().andThen(eurJpy))  // composed exactly, rounded once
 */
export function convert<From extends string, To extends string>(
  money: Money<From>,
  rate: Rate<NoInfer<From>, To>,
  rounding?: RoundingMode,
  options?: ConvertOptions,
): Money<To>;
/**
 * Converts at a bare rate: units of `to` per unit of money's currency, as a decimal string so that
 * no float is involved ('1.0832', every digit kept). Rounds once.
 *
 *     convert(money('100', 'EUR'), 'JPY', '162.457', 'halfEven')   // 16246 JPY
 */
export function convert<To extends CurrencyInput>(
  money: Money,
  to: To,
  rate: Factor,
  rounding?: RoundingMode,
  options?: ConvertOptions,
): Money<To>;
export function convert(
  money: Money,
  rateOrTarget: Rate | string,
  roundingOrRate?: RoundingMode | Factor,
  optionsOrRounding?: ConvertOptions | RoundingMode,
  maybeOptions?: ConvertOptions,
): Money {
  if (isRate(rateOrTarget)) {
    const rounding = roundingOrRate as RoundingMode | undefined;
    return rateOrTarget.convert(money, rounding, optionsOrRounding as ConvertOptions | undefined);
  }

  // The bare-rate form converts directly, without building a Rate, to keep it allocation-light.
  const to = rateOrTarget;
  const rate = ratio(roundingOrRate as Factor);
  if (rate.num <= 0n) {
    throw new RangeError('Exchange rate must be positive');
  }
  const rounding = (optionsOrRounding as RoundingMode | undefined) ?? DEFAULT_ROUNDING;
  const scale = maybeOptions?.scale ?? currencyExponent(to);
  const minor = multiplyByRatioAtScale(money.minor, rate, scale - money.scale, rounding);
  return make(to, minor, scale);
}
