/**
 * `@ducatjs/money/braintree`: Braintree's amount view. Importing this module adds `toBraintree`.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import { toBraintree, type BraintreeAmountOptions } from '../braintree.js';
import type { Money } from '../index.js';
import { extendMoney } from '../money.js';

export * from '../braintree.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /** The exact `amount` string for Braintree: `money('10', 'USD').toBraintree()` is '10.00'. */
    toBraintree(options?: BraintreeAmountOptions): string;
  }
}

extendMoney(
  {
    toBraintree(this: Money, options?: BraintreeAmountOptions) {
      return toBraintree(this, options);
    },
  },
  { owner: '@ducatjs/money/braintree' },
);
