/**
 * `@ducatjs/money/tax`: percentages, discounts and tax breakdowns. Importing this module adds the
 * methods below.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import type { Factor } from '../decimal.js';
import type { Money } from '../index.js';
import { extendMoney, type RoundingInput } from '../money.js';
import { addTax, discount, extractTax, percentage, type TaxBreakdown } from '../tax.js';

export * from '../tax.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /** `percent`% of this, e.g. `price.percentage(15, 'halfEven')` */
    percentage(percent: Factor, rounding?: RoundingInput): Money<C>;
    /** this minus `percent`% */
    discount(percent: Factor, rounding?: RoundingInput): Money<C>;
    /** Treats this as net: `{ net, tax, gross }`, net + tax = gross exactly. */
    addTax(percent: Factor, rounding?: RoundingInput): TaxBreakdown<C>;
    /** Treats this as gross: `{ net, tax, gross }`, net + tax = gross exactly. */
    extractTax(percent: Factor, rounding?: RoundingInput): TaxBreakdown<C>;
  }
}

extendMoney(
  {
    percentage(this: Money, percent: Factor, rounding?: RoundingInput) {
      return percentage(this, percent, rounding);
    },
    discount(this: Money, percent: Factor, rounding?: RoundingInput) {
      return discount(this, percent, rounding);
    },
    addTax(this: Money, percent: Factor, rounding?: RoundingInput) {
      return addTax(this, percent, rounding);
    },
    extractTax(this: Money, percent: Factor, rounding?: RoundingInput) {
      return extractTax(this, percent, rounding);
    },
  },
  { owner: '@ducatjs/money/tax' },
);
