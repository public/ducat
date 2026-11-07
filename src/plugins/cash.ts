/**
 * `@ducatjs/money/cash`: cash rounding (cash tenders only; card payments are never rounded) and
 * rounding to an increment. Importing this module adds the methods below.
 */
import { cashRound, roundToIncrement, type CashRoundOptions } from '../cash.js';
import { extendMoney, type Money } from '../money.js';
import type { RoundingMode } from '../rounding.js';

export * from '../cash.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /**
     * Rounds a cash total to the local cash step (CHF 0.05, SEK 1, ...); unchanged when no rule
     * applies.
     */
    cashRound(options?: CashRoundOptions): Money<C>;
    /** Rounds to a multiple of `increment`, e.g. CHF 10.03 to CHF 0.05 gives CHF 10.05. */
    roundToIncrement(increment: Money<C>, rounding?: RoundingMode): Money<C>;
  }
}

extendMoney(
  {
    cashRound(this: Money, options?: CashRoundOptions) {
      return cashRound(this, options);
    },
    roundToIncrement(this: Money, increment: Money, rounding?: RoundingMode) {
      return roundToIncrement(this, increment, rounding);
    },
  },
  { owner: '@ducatjs/money/cash' },
);
