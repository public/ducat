/**
 * `@ducatjs/money`: the core. Money with construction, arithmetic, rounding, comparison and
 * serialisation as methods (`price.add(fee).multiply('1.075')`), plus the ISO 4217 exponents.
 * The same operations as plain functions (`add(price, fee)`) are in `@ducatjs/money/fn`. Allocation, tax, conversion, cash rounding,
 * formatting, parsing and the processor and database views are opt-in modules
 * (`@ducatjs/money/allocate`, `@ducatjs/money/tax`, ...; `@ducatjs/money/all` for everything).
 */
export {
  money,
  fromMinor,
  zero,
  fromJSON,
  isMoney,
  isMoneyIn,
  assertCurrency,
  extendMoney,
  type ExtendMoneyOptions,
  sum,
  ratio,
  CurrencyMismatchError,
  roundingPolicy,
  isoPolicy,
  assertScale,
  type RoundingPolicy,
  type RoundingPolicyOptions,
  type RoundingInput,
  type Money,
  type MoneyJSON,
  type MoneyOptions,
  type CurrencyInput,
  type Factor,
  type Ratio,
} from './money.js';
export { DEFAULT_ROUNDING, Rounding, RoundingError, type RoundingMode } from './rounding.js';
export {
  currencyExponent,
  defineCurrency,
  isCurrency,
  ISO_EXPONENTS,
  ISO_4217_PUBLISHED,
  ISO_NON_MONETARY,
  type CurrencyCode,
  type IsoCurrencyCode,
  type CustomCurrencies,
} from './currency.js';
