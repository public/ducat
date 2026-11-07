/**
 * `@ducatjs/money/fixed`: exact fixed-point decimals without a currency, on the same engine as Money.
 * Importing this module adds `Money#toFixed()`.
 */
import { moneyToFixed, type Fixed } from '../fixed.js';
import { extendMoney, type Money } from '../money.js';

export * from '../fixed.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** The exact Fixed of this amount, at its scale: `money('12.34', 'EUR').toFixed()` is 12.34. */
    toFixed(): Fixed;
  }
}

extendMoney({
  toFixed(this: Money) {
    return moneyToFixed(this);
  },
});
