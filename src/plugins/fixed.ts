/**
 * `@ducatjs/money/fixed`: exact fixed-point decimals without a currency, on the same engine as Money.
 * Importing this module adds `Money#toFixedPoint()`.
 */
import { moneyToFixed, type Fixed } from '../fixed.js';
import { extendMoney, type Money } from '../money.js';

export * from '../fixed.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /**
     * The exact Fixed of this amount, at its scale: `money('12.34', 'EUR').toFixedPoint()` is 12.34.
     * Not `toFixed`, which Number, decimal.js and big.js all use for `toFixed(places): string`.
     */
    toFixedPoint(): Fixed;
  }
}

extendMoney(
  {
    toFixedPoint(this: Money) {
      return moneyToFixed(this);
    },
  },
  { owner: '@ducatjs/money/fixed' },
);
