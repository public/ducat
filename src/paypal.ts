/**
 * PayPal's amount view for the REST APIs (Orders v2, Payments v2):
 * https://developer.paypal.com/api/rest/reference/currency-codes/, encoded in data/paypal.json.
 * `value` is a decimal string in major units, with at most 15 digits before the point:
 * - HUF, JPY and TWD don't support decimals: "1000", never "1000.00" (ISO 4217 gives HUF and TWD 2);
 * - every other listed currency has 2 decimals: "10.99".
 * BRL, CNY and MYR are for in-country accounts only; that isn't checked here.
 */
import { PAYPAL_EXPONENTS } from './generated/paypal.js';
import { type CurrencyInput, type Money } from './money.js';
import { fromProcessorDecimal, toProcessorDecimal } from './processor.js';
import type { RoundingMode } from './rounding.js';

export { PAYPAL_EXPONENTS };

/** The `value` pattern from PayPal's Orders v2 schema. */
const VALUE_PATTERN = /^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$/;

/** PayPal allows at most 15 digits before the decimal point. */
const MAX_INTEGER_DIGITS = 15;

/** The number of decimals PayPal takes for a currency (JPY, HUF, TWD 0; the others 2). */
export function paypalExponent(currency: string): number {
  const exponent = PAYPAL_EXPONENTS[currency.toUpperCase()];
  if (exponent === undefined) {
    throw new RangeError(`${currency} is not a PayPal currency`);
  }
  return exponent;
}

/** Whether PayPal lists the currency (case-insensitive). */
export function isPayPalCurrency(currency: string): boolean {
  return PAYPAL_EXPONENTS[currency.toUpperCase()] !== undefined;
}

export interface PayPalAmountOptions {
  /** How to round when PayPal needs fewer decimals than the value has (default 'unnecessary': throw). */
  readonly rounding?: RoundingMode;
}

/** The exact `value` string: toPayPalValue(money('10.99', 'USD')) === '10.99', HUF 1000 -> '1000'. */
export function toPayPalValue(money: Money, options?: PayPalAmountOptions): string {
  const rounding = options?.rounding ?? 'unnecessary';
  const value = toProcessorDecimal('PayPal', money, paypalExponent(money.currency), rounding);

  const integerDigits = value.replace('-', '').split('.')[0]!;
  if (integerDigits.length > MAX_INTEGER_DIGITS) {
    throw new RangeError(`${money} is too large for PayPal (at most 15 digits before the decimal point)`);
  }
  return value;
}

/** A PayPal `money` object: `{ currency_code, value }`. */
export function toPayPal(money: Money, options?: PayPalAmountOptions): { currency_code: string; value: string } {
  return { currency_code: money.currency.toUpperCase(), value: toPayPalValue(money, options) };
}

/** Reads a PayPal `money` object exactly: fromPayPal({ currency_code: 'USD', value: '230.00' }). */
export function fromPayPal<C extends CurrencyInput>(amount: { currency_code: C; value: string }): Money<Uppercase<C>> {
  const code = amount.currency_code.toUpperCase() as Uppercase<C>;

  // Validates the currency before parsing, so an unlisted currency is the error reported.
  paypalExponent(code);
  return fromProcessorDecimal('PayPal', amount.value, code, VALUE_PATTERN);
}
