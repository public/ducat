/** `@ducatjs/money/klarna`: Klarna's amount view. Importing this module adds `toKlarna`. */
import { toKlarna, type KlarnaAmountOptions } from '../klarna.js';
import type { Money } from '../index.js';
import { extendMoney } from '../money.js';

export * from '../klarna.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /** The integer for any Klarna amount field: `money('25', 'EUR').toKlarna()` is 2500. */
    toKlarna(options?: KlarnaAmountOptions): number;
  }
}

extendMoney(
  {
    toKlarna(this: Money, options?: KlarnaAmountOptions) {
      return toKlarna(this, options);
    },
  },
  { owner: '@ducatjs/money/klarna' },
);
