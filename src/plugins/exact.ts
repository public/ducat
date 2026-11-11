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
  multiplyExact,
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
    /**
     * this × factor exactly, at the smallest scale that holds the product (never below this
     * scale); throws a RoundingError when the product doesn't terminate.
     */
    multiplyExact(factor: Factor): Money<C>;
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
  multiplyExact(this: Money, factor: Factor) {
    return multiplyExact(this, factor);
  },
});
