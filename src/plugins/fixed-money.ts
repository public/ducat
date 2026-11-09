/**
 * `@ducatjs/money/fixed/money`: Fixed and Money together. Everything in `@ducatjs/money/fixed`, plus
 * the conversions between the two; importing this module adds `Money#toFixedPoint()` and
 * `Fixed#toMoney()`.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import { Fixed } from '../fixed.js';
import { fixedToMoney, moneyToFixed } from '../fixed-money.js';
import type { CurrencyInput, Money } from '../index.js';
import { extendMoney } from '../money.js';
import type { RoundingMode } from '../rounding.js';

export * from '../fixed.js';
export * from '../fixed-money.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /**
     * The exact Fixed of this amount, at its scale: `money('12.34', 'EUR').toFixedPoint()` is
     * 12.34. Not `toFixed`, which Number, decimal.js and big.js all use for `toFixed(places):
     * string`.
     */
    toFixedPoint(): Fixed;
  }
}

declare module '../fixed.js' {
  interface Fixed {
    /**
     * Money in `currency`, at its exponent. Throws RoundingError when that would drop digits,
     * unless `rounding` is given: `fixed('1.005').toMoney('EUR', 'halfEven')` is 1.00 EUR.
     */
    toMoney<C extends CurrencyInput>(currency: C, rounding?: RoundingMode): Money<C>;
  }
}

extendMoney(
  {
    toFixedPoint(this: Money) {
      return moneyToFixed(this);
    },
  },
  { owner: '@ducatjs/money/fixed/money' },
);

// Non-enumerable, like a class method. Loading the module again replaces it with the same function.
// This is outside extendMoney's owner registry, which is for Money; it's fine while this module is
// the only one that defines Fixed#toMoney.
Object.defineProperty(Fixed.prototype, 'toMoney', {
  value: function toMoney(this: Fixed, currency: CurrencyInput, rounding?: RoundingMode) {
    return fixedToMoney(this, currency, rounding);
  },
  writable: true,
  configurable: true,
  enumerable: false,
});
