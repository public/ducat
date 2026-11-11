/**
 * `@ducatjs/money/math`: averages, ratios between amounts, integral division and scale trimming.
 * Importing this module adds the methods below; `average` is a plain function, like `sum`.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import type { Ratio } from '../decimal.js';
import { divideToIntegral, ratioOf, remainder, trimScale } from '../math.js';
import type { Money } from '../index.js';
import { extendMoney, type MoneyOperand } from '../money.js';

export * from '../math.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /** The exact ratio this / other, e.g. `part.ratioOf(total)` */
    ratioOf<O extends string = C>(other: MoneyOperand<C, O>): Ratio;
    /** How many whole times `divisor` fits into this, truncated toward zero */
    divideToIntegral<O extends string = C>(divisor: MoneyOperand<C, O>): number | bigint;
    /** What is left after taking `divisor` out a whole number of times (this amount's sign) */
    remainder<O extends string = C>(divisor: MoneyOperand<C, O>): Money<C>;
    /** The smallest scale, not below `minimumScale` (default the ISO exponent), that is exact */
    trimScale(minimumScale?: number): Money<C>;
  }
}

extendMoney(
  {
    ratioOf(this: Money, other: Money) {
      return ratioOf(this, other);
    },
    divideToIntegral(this: Money, divisor: Money) {
      return divideToIntegral(this, divisor);
    },
    remainder(this: Money, divisor: Money) {
      return remainder(this, divisor);
    },
    trimScale(this: Money, minimumScale?: number) {
      return trimScale(this, minimumScale);
    },
  },
  { owner: '@ducatjs/money/math' },
);
