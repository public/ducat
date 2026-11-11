/**
 * `@ducatjs/money/exact`: exact rational amounts that round once. Importing this module adds
 * `Money#exact`.
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import type { Factor } from '../decimal.js';
import {
  addTaxExact,
  exact,
  extractTaxExact,
  type ExactMoney,
  type ExactTaxBreakdown,
} from '../exact.js';
import type { Money } from '../index.js';
import { extendMoney } from '../money.js';

export * from '../exact.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /**
     * The exact value, for chained arithmetic that rounds once: `price.exact().divide(3).round()`.
     */
    exact(): ExactMoney<C>;
    /** Treats this as net: exact `{ net, tax, gross }` parts, nothing rounded. */
    addTaxExact(percent: Factor): ExactTaxBreakdown<C>;
    /** Treats this as gross: exact `{ net, tax, gross }` parts, nothing rounded. */
    extractTaxExact(percent: Factor): ExactTaxBreakdown<C>;
  }
}

extendMoney({
  exact(this: Money) {
    return exact(this);
  },
  addTaxExact(this: Money, percent: Factor) {
    return addTaxExact(this, percent);
  },
  extractTaxExact(this: Money, percent: Factor) {
    return extractTaxExact(this, percent);
  },
});
