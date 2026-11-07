/**
 * `@ducatjs/money/prisma`: Prisma and SQL column helpers. Importing this module adds
 * `toDecimalValue`.
 */
import { extendMoney, type Money } from '../money.js';
import { toDecimalValue } from '../prisma.js';

export * from '../prisma.js';

declare module '../money.js' {
  interface Money<C extends string> {
    /** A Decimal for a NUMERIC column: `m.toDecimalValue(Prisma.Decimal)`. */
    toDecimalValue<D>(Decimal: new (value: string) => D): D;
  }
}

extendMoney(
  {
    toDecimalValue(this: Money, Decimal: new (value: string) => unknown) {
      return toDecimalValue(this, Decimal);
    },
  },
  { owner: '@ducatjs/money/prisma' },
);
