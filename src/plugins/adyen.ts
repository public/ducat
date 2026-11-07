/** `@ducatjs/money/adyen`: Adyen's minor-unit view. Importing this module adds `toAdyen`. */
import { toAdyen } from '../adyen.js';
import { extendMoney, type Money } from '../money.js';
import type { RoundingMode } from '../rounding.js';

export * from '../adyen.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** Adyen `amount` object: `money('15000', 'IDR').toAdyen()` is `{ value: 15000, currency: 'IDR' }`. */
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
