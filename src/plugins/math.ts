/**
 * `@ducatjs/money/math`: averages, ratios between amounts, integral division and scale trimming.
 * Importing this module adds the methods below; `average` is a plain function, like `sum`.
 */
import type { Ratio } from '../decimal.js';
import { divideToIntegral, ratioOf, remainder, trimScale } from '../math.js';
import { extendMoney, type Money } from '../money.js';

export * from '../math.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** The exact ratio this / other, e.g. `part.ratioOf(total)` */
    ratioOf(other: Money<C>): Ratio;
    /** How many whole times `divisor` fits into this, truncated toward zero */
    divideToIntegral(divisor: Money<C>): number | bigint;
    /** What is left after taking `divisor` out a whole number of times (this amount's sign) */
    remainder(divisor: Money<C>): Money<C>;
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
