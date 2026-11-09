/** `@ducatjs/money/adyen`: Adyen's minor-unit view. Importing this module adds `toAdyen`. */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import { toAdyen } from '../adyen.js';
import type { Money } from '../index.js';
import { extendMoney } from '../money.js';
import type { RoundingMode } from '../rounding.js';

export * from '../adyen.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /**
     * Adyen `amount` object: `money('15000', 'IDR').toAdyen()` is `{ value: 15000, currency: 'IDR'
     * }`.
     */
    toAdyen(rounding?: RoundingMode): { value: number; currency: string };
  }
}

extendMoney(
  {
    toAdyen(this: Money, rounding?: RoundingMode) {
      return toAdyen(this, rounding);
    },
  },
  { owner: '@ducatjs/money/adyen' },
);
