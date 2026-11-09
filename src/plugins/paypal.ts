/**
 * `@ducatjs/money/paypal`: PayPal's amount view. Importing this module adds `toPayPal` and
 * `toPayPalValue`.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import type { Money } from '../index.js';
import { extendMoney } from '../money.js';
import { toPayPal, toPayPalValue, type PayPalAmountOptions } from '../paypal.js';

export * from '../paypal.js';

declare module '../index.js' {
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
