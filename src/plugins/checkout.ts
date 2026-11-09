/**
 * `@ducatjs/money/checkout`: Checkout.com's amount view. Importing this module adds `toCheckout`
 * and `toCheckoutAmount`.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import { toCheckout, toCheckoutAmount, type CheckoutAmountOptions } from '../checkout.js';
import type { Money } from '../index.js';
import { extendMoney } from '../money.js';

export * from '../checkout.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /**
     * The integer `amount` to send to Checkout.com: `money('5000', 'CLP').toCheckoutAmount()` is
     * 500000.
     */
    toCheckoutAmount(options?: CheckoutAmountOptions): number;
    /** `{ amount, currency }` for a Checkout.com payment request. */
    toCheckout(options?: CheckoutAmountOptions): { amount: number; currency: string };
  }
}

extendMoney(
  {
    toCheckoutAmount(this: Money, options?: CheckoutAmountOptions) {
      return toCheckoutAmount(this, options);
    },
    toCheckout(this: Money, options?: CheckoutAmountOptions) {
      return toCheckout(this, options);
    },
  },
  { owner: '@ducatjs/money/checkout' },
);
