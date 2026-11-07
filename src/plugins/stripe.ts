/**
 * `@ducatjs/money/stripe`: Stripe's minor-unit view. Importing this module adds `toStripe` and
 * `toStripeAmount`.
 */
import { extendMoney, type Money } from '../money.js';
import { toStripe, toStripeAmount, type StripeAmountOptions } from '../stripe.js';

export * from '../stripe.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** The integer `amount` to send to Stripe: `money('5', 'ISK').toStripeAmount()` is 500. */
    toStripeAmount(options?: StripeAmountOptions): number;
    /** `{ amount, currency }` with Stripe's lowercase currency code, ready for a PaymentIntent. */
    toStripe(options?: StripeAmountOptions): { amount: number; currency: string };
  }
}

extendMoney(
  {
    toStripeAmount(this: Money, options?: StripeAmountOptions) {
      return toStripeAmount(this, options);
    },
    toStripe(this: Money, options?: StripeAmountOptions) {
      return toStripe(this, options);
    },
  },
  { owner: '@ducatjs/money/stripe' },
);
