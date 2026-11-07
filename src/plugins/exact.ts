/** `@ducatjs/money/exact`: exact rational amounts that round once. Importing this module adds `Money#exact`. */
import { exact, type ExactMoney } from '../exact.js';
import { extendMoney, type Money } from '../money.js';

export * from '../exact.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** The exact value, for chained arithmetic that rounds once: `price.exact().divide(3).round()`. */
    exact(): ExactMoney<C>;
  }
}

extendMoney({
  exact(this: Money) {
    return exact(this);
  },
});
