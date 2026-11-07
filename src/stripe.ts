/**
 * Stripe's minor-unit view. Stripe uses ISO exponents except where documented otherwise
 * (https://docs.stripe.com/currencies, encoded in data/stripe.json):
 * - zero-decimal: BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF (note MGA: ISO says 2)
 * - ISK, UGX: sent as two-decimal values whose last two digits are 00 (5 ISK -> 500)
 * - HUF, TWD: two decimals for charges, but payouts must be whole units (multiple of 100)
 * - BHD JOD KWD OMR TND: three decimals, last digit must be 0 (UAE accounts only)
 */
import { STRIPE_RULES } from './generated/stripe.js';
import { type CurrencyInput, type Money } from './money.js';
import { fromProcessorAmount, toProcessorAmount } from './processor.js';
import type { RoundingMode } from './rounding.js';

export { STRIPE_RULES };

function rule(currency: string) {
  const found = STRIPE_RULES[currency.toUpperCase()];
  if (!found) {
    throw new RangeError(`${currency} is not a Stripe presentment currency`);
  }
  return found;
}

/** Whether Stripe supports the currency as a presentment currency. */
export const isStripeCurrency = (currency: string): boolean => STRIPE_RULES[currency.toUpperCase()] !== undefined;

/** The exponent Stripe's API uses for a currency (ISK 2, JPY 0, KWD 3, MGA 0). */
export const stripeExponent = (currency: string): number => rule(currency)[0];

/** Options for the Stripe amount: payout rules and how to round when Stripe needs a coarser amount. */
export interface StripeAmountOptions {
  /** Payout amounts have stricter rules (HUF, TWD: whole units). */
  readonly payout?: boolean;
  /** How to round when Stripe needs a coarser amount (default 'unnecessary': throw). */
  readonly rounding?: RoundingMode;
}

/** The integer `amount` to send to Stripe, e.g. toStripeAmount(money('5', 'ISK')) === 500. */
export function toStripeAmount(money: Money, options?: StripeAmountOptions): number {
  const [exp, charge, payout] = rule(money.currency);
  return toProcessorAmount('Stripe', money, exp, options?.payout ? payout : charge, options?.rounding ?? 'unnecessary');
}

/** `{ amount, currency }` with Stripe's lowercase currency code, ready for a PaymentIntent. */
export function toStripe(money: Money, options?: StripeAmountOptions): { amount: number; currency: string } {
  return { amount: toStripeAmount(money, options), currency: money.currency.toLowerCase() };
}

/** Reads a Stripe amount (e.g. from a webhook): fromStripe(500, 'isk') is 5 ISK. */
export function fromStripe<C extends CurrencyInput>(amount: number | bigint, currency: C): Money<Uppercase<C>> {
  const code = currency.toUpperCase() as Uppercase<C>;
  return fromProcessorAmount('Stripe', amount, code, rule(code)[0]);
}
