// `ducat/convert` free functions: exact exchange rates and conversion that rounds once.
import { currencyExponent } from './currency.js';
import { exact, type Rounded } from './exact.js';
import { ratio, type Factor } from './decimal.js';
import { make, type CurrencyInput, type Money } from './money.js';
import { rateOf, type RateProvider } from './provider.js';
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
export { bag, comparator, MoneyBag, sumByCurrency, type ComparatorOptions, type TotalOptions } from './bag.js';
export {
  chain,
  identity,
  rateOf,
  rateTable,
  RateUnavailableError,
  reversed,
  snapshots,
  snapshotsFrom,
  via,
  type RateProvider,
  type RateQuery,
  type RateTable,
  type RateTableSpec,
  type SnapshotOptions,
  type Snapshots,
} from './provider.js';

/** Options for converting through a provider. */
export interface ProviderConvertOptions extends ConvertOptions {
  /** The time the rate is wanted for (an ISO-8601 date or instant, or a Date). */
  readonly asOf?: string | Date;
}

function isProvider(value: unknown): value is RateProvider {
  return typeof (value as RateProvider | undefined)?.rate === 'function';
}

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
/**
 * Converts through a provider: looks up money's currency → `to` (as of `options.asOf`) and rounds
 * once. Throws RateUnavailableError when the provider has no rate.
 *
 *     convert(money('100', 'USD'), 'JPY', via('EUR', ecb), 'halfEven')
 */
export function convert<To extends CurrencyInput>(
  money: Money,
  to: To,
  provider: RateProvider,
  rounding?: RoundingMode,
  options?: ProviderConvertOptions,
): Money<To>;
export function convert(
  money: Money,
  rateOrTarget: Rate | string,
  roundingOrRate?: RoundingMode | Factor | RateProvider,
  optionsOrRounding?: ConvertOptions | RoundingMode,
  maybeOptions?: ProviderConvertOptions,
): Money {
  if (isRate(rateOrTarget)) {
    const rounding = roundingOrRate as RoundingMode | undefined;
    return rateOrTarget.convert(money, rounding, optionsOrRounding as ConvertOptions | undefined);
  }

  const to = rateOrTarget;
  if (isProvider(roundingOrRate)) {
    let query: { asOf: string | Date } | undefined;
    if (maybeOptions?.asOf !== undefined) {
      query = { asOf: maybeOptions.asOf };
    }
    const rate = rateOf(roundingOrRate, money.currency, to, query);
    return rate.convert(money, optionsOrRounding as RoundingMode | undefined, maybeOptions);
  }

  // The bare-rate form converts directly, without building a Rate, to keep it allocation-light.
  const rate = ratio(roundingOrRate as Factor);
  if (rate.num <= 0n) {
    throw new RangeError('Exchange rate must be positive');
  }
  const rounding = (optionsOrRounding as RoundingMode | undefined) ?? DEFAULT_ROUNDING;
  const scale = maybeOptions?.scale ?? currencyExponent(to);
  const minor = multiplyByRatioAtScale(money.minor, rate, scale - money.scale, rounding);
  return make(to, minor, scale);
}

/** A conversion's rounded value, what rounding left out, and the rate used (for the audit trail). */
export interface DetailedConversion<From extends string, To extends string> extends Rounded<To> {
  readonly rate: Rate<From, To>;
}

/**
 * Converts at `rate` like convert(), and also reports the residual: `value + residual` is exactly
 * money × rate, so a ledger can book the rounding difference.
 *
 *     const { value, residual } = convertDetailed(money('0.07', 'EUR'), eurUsd, 'halfEven');
 *     // value 0.08 USD, residual -0.001845 USD (as an exact ExactMoney)
 */
export function convertDetailed<From extends string, To extends string>(
  money: Money<From>,
  rate: Rate<NoInfer<From>, To>,
  rounding: RoundingMode = DEFAULT_ROUNDING,
  options?: ConvertOptions,
): DetailedConversion<From, To> {
  const rounded = exact(money).convert(rate).roundWithResidual(rounding, options?.scale);
  return { value: rounded.value, residual: rounded.residual, rate };
}
