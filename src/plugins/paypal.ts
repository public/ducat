/**
 * `@ducatjs/money/paypal`: PayPal's amount view. Importing this module adds `toPayPal` and
 * `toPayPalValue`.
 */
import { extendMoney, type Money } from '../money.js';
import { toPayPal, toPayPalValue, type PayPalAmountOptions } from '../paypal.js';

export * from '../paypal.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** The exact `value` string for PayPal: `money('1000', 'HUF').toPayPalValue()` is '1000'. */
    toPayPalValue(options?: PayPalAmountOptions): string;
    /** A PayPal `money` object: `{ currency_code, value }`. */
    toPayPal(options?: PayPalAmountOptions): { currency_code: string; value: string };
  }
}

extendMoney(
  {
    toPayPalValue(this: Money, options?: PayPalAmountOptions) {
      return toPayPalValue(this, options);
    },
    toPayPal(this: Money, options?: PayPalAmountOptions) {
      return toPayPal(this, options);
    },
  },
  { owner: '@ducatjs/money/paypal' },
);
