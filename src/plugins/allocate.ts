/**
 * `@ducatjs/money/allocate`: allocation, splitting and tranches. Importing this module adds the
 * methods below to every Money; the free functions are exported too (and from `@ducatjs/money/fn`,
 * which changes no prototypes).
 */
// every ISO 4217 code, as for every entry except /fn
import './iso.js';
import {
  allocate,
  chunk,
  instalments,
  schedule,
  split,
  type AllocateOptions,
  type InstalmentOptions,
  type Tranche,
  type Weight,
} from '../allocate.js';
import type { Money } from '../index.js';
import { extendMoney } from '../money.js';

export * from '../allocate.js';

declare module '../index.js' {
  interface Money<C extends string> {
    /** Splits by weights; the parts always sum to this. */
    allocate(weights: readonly Weight[], options?: AllocateOptions): Money<C>[];
    /** Splits into `count` near-equal parts that sum to this. */
    split(count: number, options?: AllocateOptions): Money<C>[];
    instalments(count: number, options?: InstalmentOptions<C>): Money<C>[];
    schedule(tranches: readonly Tranche<C>[]): Money<C>[];
    /** Tranches of at most `max`: 1000 by 300 gives 300, 300, 300, 100. */
    chunk(max: Money<C>): Money<C>[];
  }
}

extendMoney(
  {
    allocate(this: Money, weights: readonly Weight[], options?: AllocateOptions) {
      return allocate(this, weights, options);
    },
    split(this: Money, count: number, options?: AllocateOptions) {
      return split(this, count, options);
    },
    instalments(this: Money, count: number, options?: InstalmentOptions<string>) {
      return instalments(this, count, options);
    },
    schedule(this: Money, tranches: readonly Tranche<string>[]) {
      return schedule(this, tranches);
    },
    chunk(this: Money, max: Money) {
      return chunk(this, max);
    },
  },
  { owner: '@ducatjs/money/allocate' },
);
