/**
 * Braintree's amount view (https://developer.paypal.com/braintree/docs/reference/general/currencies,
 * encoded in data/braintree.json). `amount` is a decimal string in major units, "formatted like '10'
 * or '10.00'":
 * - zero-decimal currencies can't include decimals: BIF CLP DJF GNF ISK JPY KMF KRW LAK PYG RWF UGX
 *   VND VUV XAF XOF XPF (LAK has 2 in ISO 4217);
 * - the others take their ISO decimals ("10.00"). No three-decimal currency is listed.
 * Amounts must be greater than zero, refunds and credits included.
 */
import { BRAINTREE_EXPONENTS } from './generated/braintree.js';
import { type CurrencyInput, type Money } from './money.js';
import { fromProcessorDecimal, toProcessorDecimal } from './processor.js';
import type { RoundingMode } from './rounding.js';

export { BRAINTREE_EXPONENTS };

/** "Can only contain numbers and one decimal point (e.g. x.xx)". */
const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]+)?$/;

/** The number of decimals Braintree takes for a currency (JPY 0, LAK 0, USD 2). */
export function braintreeExponent(currency: string): number {
  const exponent = BRAINTREE_EXPONENTS[currency.toUpperCase()];
  if (exponent === undefined) {
    throw new RangeError(`${currency} is not a Braintree currency`);
  }
  return exponent;
}

/** Whether Braintree lists the currency (case-insensitive). */
export function isBraintreeCurrency(currency: string): boolean {
  return BRAINTREE_EXPONENTS[currency.toUpperCase()] !== undefined;
}

/** Options for the Braintree amount: how to round when Braintree needs a coarser amount. */
export interface BraintreeAmountOptions {
  /** How to round when Braintree needs fewer decimals than the value has (default 'unnecessary': throw). */
  readonly rounding?: RoundingMode;
}

/**
 * The exact `amount` string: toBraintree(money('10', 'USD')) === '10.00', JPY 100 -> '100'.
 * Braintree has no currency field on a transaction: the merchant account sets it.
 * Throws a RangeError for zero or negative amounts.
 */
export function toBraintree(money: Money, options?: BraintreeAmountOptions): string {
  const rounding = options?.rounding ?? 'unnecessary';

  // 81531 "Amount must be greater than zero"; 81501: credits are positive too ("x.xx, not -x.xx").
  return toProcessorDecimal('Braintree', money, braintreeExponent(money.currency), rounding, 'positive');
}

/** Reads a Braintree amount string exactly: fromBraintree('10.00', 'USD'). */
export function fromBraintree<C extends CurrencyInput>(amount: string, currency: C): Money<Uppercase<C>> {
  const code = currency.toUpperCase() as Uppercase<C>;

  // Validates the currency before parsing, so an unlisted currency is the error reported.
  braintreeExponent(code);
  return fromProcessorDecimal('Braintree', amount, code, AMOUNT_PATTERN);
}
