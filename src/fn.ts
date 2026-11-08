/**
 * `@ducatjs/money/fn`: every operation of ducat and its opt-in modules as a plain function
 * (`add(price, fee)`, `allocate(total, [1, 1])`), for code that prefers that style or must not
 * install methods on Money (importing it changes no prototype).
 */
// Everything the root entry exports, plus the core Money methods as plain functions. Each is
// re-exported straight from its own module, so every name is one re-export away from its definition
// (under vitest each hop is a getter call, which shows in the CodSpeed benchmarks).
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
  add,
  subtract,
  negate,
  abs,
  multiply,
  divide,
  round,
  toScale,
  compare,
  equals,
  identical,
  lessThan,
  lessThanOrEqual,
  greaterThan,
  greaterThanOrEqual,
  isZero,
  isPositive,
  isNegative,
  sign,
  min,
  max,
  clamp,
  majorPart,
  minorPart,
  toDecimal,
  toMinor,
  toMinorNumber,
  CurrencyMismatchError,
  type RoundingPolicy,
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
export * from './allocate.js';
export * from './tax.js';
export * from './convert.js';
export * from './exact.js';
export * from './ecb.js';
export * from './stripe-fx.js';
export * from './adyen-fx.js';
export * from './cash.js';
export { roundingPolicy, isoPolicy, assertScale, type RoundingPolicyOptions } from './policy.js';
export * from './format.js';
export * from './parse.js';
export * from './stripe.js';
export * from './adyen.js';
export * from './checkout.js';
export * from './paypal.js';
export * from './braintree.js';
export * from './klarna.js';
export * from './prisma.js';
export * from './fixed.js';
