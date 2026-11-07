/**
 * Checkout.com's amount view (https://www.checkout.com/docs/payments/accept-payments/format-the-amount-value,
 * encoded in data/checkout.json). `amount` is an integer:
 * - the full amount: BIF DJF GNF ISK JPY KMF KRW PYG RWF UGX VUV VND XAF XOF XPF
 * - divided by 1000, last digit 0: BHD IQD JOD KWD LYD OMR TND
 * - divided by 100 for every other currency. CLP is here too (ISO says 0 decimals), and for payment
 *   requests its last two digits must be 00 (5000 CLP -> 500000). Standalone authentication is
 *   exempt.
 */
import { CHECKOUT_RULES } from './generated/checkout.js';
import { type CurrencyInput, type Money } from './money.js';
import { fromProcessorAmount, toProcessorAmount } from './processor.js';
import type { RoundingMode } from './rounding.js';

export { CHECKOUT_RULES };

/** Checkout.com's [exponent, payment multiple, Standalone API multiple] for a currency. */
function rulesFor(currency: string) {
  const rules = CHECKOUT_RULES[currency.toUpperCase()];
  if (!rules) {
    throw new RangeError(`${currency} is not a Checkout.com currency`);
  }
  return rules;
}

/** Whether Checkout.com lists the currency (case-insensitive). */
export function isCheckoutCurrency(currency: string): boolean {
  return CHECKOUT_RULES[currency.toUpperCase()] !== undefined;
}

/** The exponent Checkout.com's API uses for a currency (CLP 2, JPY 0, BHD 3). */
export function checkoutExponent(currency: string): number {
  return rulesFor(currency)[0];
}

/** Options for the Checkout.com amount: how to round when Checkout.com needs a coarser amount. */
export interface CheckoutAmountOptions {
  /** How to round when Checkout.com needs a coarser amount (default 'unnecessary': throw). */
  readonly rounding?: RoundingMode;
  /**
   * An authentication request to the Standalone API, where CLP's "last two digits 00" rule does not
   * apply.
   */
  readonly standalone?: boolean;
}

/**
 * The integer `amount` to send, e.g. toCheckoutAmount(money('5000', 'CLP')) === 500000.
 * Throws a RangeError for negative amounts (refunds are sent as positive amounts).
 * SLL and XDR are on Checkout.com's list but not in ISO 4217's active list: call
 * `defineCurrency('SLL', 2)` or `defineCurrency('XDR', 2)` before using them.
 */
export function toCheckoutAmount(money: Money, options?: CheckoutAmountOptions): number {
  const [exponent, paymentMultiple, standaloneMultiple] = rulesFor(money.currency);
  const multiple = options?.standalone ? standaloneMultiple : paymentMultiple;
  const rounding = options?.rounding ?? 'unnecessary';

  // "Be greater than zero", except 0 for a card verification (API reference); refunds are positive.
  return toProcessorAmount('Checkout.com', money, exponent, multiple, rounding, 'nonNegative');
}

/** `{ amount, currency }` for a payment request. */
export function toCheckout(
  money: Money,
  options?: CheckoutAmountOptions,
): { amount: number; currency: string } {
  return { amount: toCheckoutAmount(money, options), currency: money.currency.toUpperCase() };
}

/** Reads a Checkout.com amount: fromCheckout(500000, 'CLP') is 5000 CLP. */
export function fromCheckout<C extends CurrencyInput>(
  amount: number | bigint,
  currency: C,
): Money<Uppercase<C>> {
  const code = currency.toUpperCase() as Uppercase<C>;
  return fromProcessorAmount('Checkout.com', amount, code, checkoutExponent(code));
}
