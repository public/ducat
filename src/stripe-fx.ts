// Stripe exchange rates as exact Rates, for converting and reconciling balance transactions.
import type { Money } from './money.js';
import { exchangeRate, impliedRate, type Rate, type RateInfo } from './rate.js';
import { fromStripe } from './stripe.js';

/** The fields of a Stripe BalanceTransaction used here. */
export interface StripeBalanceTransaction {
  readonly amount: number;
  readonly currency: string;
  readonly exchange_rate?: number | null;
  /** Seconds since the Unix epoch. */
  readonly created?: number;
}

function stripeInfo(transaction: StripeBalanceTransaction): RateInfo {
  if (transaction.created === undefined) {
    return { source: 'stripe' };
  }
  return { source: 'stripe', asOf: new Date(transaction.created * 1000) };
}

/**
 * The rate Stripe quotes on a balance transaction, from the charge currency `from` to the balance
 * currency: "the amount in currency A, multiplied by the exchange_rate, equals the amount in currency
 * B". The JSON number is read at its shortest decimal form, so 1.234 is exactly 1234/1000.
 * `asOf` is the balance transaction's `created` time, the closest timestamp Stripe gives for the
 * conversion; it is not the charge's creation time, and Stripe doesn't say when the rate was quoted.
 * `undefined` when nothing was converted.
 */
export function stripeRate<From extends string>(
  from: From,
  transaction: StripeBalanceTransaction,
): Rate<Uppercase<From>, Uppercase<string>> | undefined {
  if (transaction.exchange_rate === undefined || transaction.exchange_rate === null) {
    return undefined;
  }
  const charged = from.toUpperCase() as Uppercase<From>;
  const balance = transaction.currency.toUpperCase() as Uppercase<string>;
  return exchangeRate(charged, balance, transaction.exchange_rate, stripeInfo(transaction));
}

/** The exact rate Stripe applied: the balance transaction's gross amount ÷ the charged amount. */
export function stripeImpliedRate<From extends string>(
  charged: Money<From>,
  transaction: StripeBalanceTransaction,
): Rate<From, Uppercase<string>> {
  const settled = fromStripe(transaction.amount, transaction.currency.toUpperCase());
  return impliedRate(charged, settled, stripeInfo(transaction));
}
