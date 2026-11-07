/**
 * `@ducatjs/money/tax`: percentages, discounts and tax breakdowns. Importing this module adds the
 * methods below.
 */
import type { Factor } from '../decimal.js';
import { extendMoney, type Money } from '../money.js';
import type { RoundingMode } from '../rounding.js';
import { addTax, discount, extractTax, percentage, type TaxBreakdown } from '../tax.js';

export * from '../tax.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** `percent`% of this, e.g. `price.percentage(15, 'halfEven')` */
    percentage(percent: Factor, rounding?: RoundingMode): Money<C>;
    /** this minus `percent`% */
    discount(percent: Factor, rounding?: RoundingMode): Money<C>;
    /** Treats this as net: `{ net, tax, gross }`, net + tax = gross exactly. */
    addTax(percent: Factor, rounding?: RoundingMode): TaxBreakdown<C>;
    /** Treats this as gross: `{ net, tax, gross }`, net + tax = gross exactly. */
    extractTax(percent: Factor, rounding?: RoundingMode): TaxBreakdown<C>;
  }
}

extendMoney(
  {
    percentage(this: Money, percent: Factor, rounding?: RoundingMode) {
      return percentage(this, percent, rounding);
    },
    discount(this: Money, percent: Factor, rounding?: RoundingMode) {
      return discount(this, percent, rounding);
    },
    addTax(this: Money, percent: Factor, rounding?: RoundingMode) {
      return addTax(this, percent, rounding);
    },
    extractTax(this: Money, percent: Factor, rounding?: RoundingMode) {
      return extractTax(this, percent, rounding);
    },
  },
  { owner: '@ducatjs/money/tax' },
);
