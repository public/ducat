// Mixed-currency amounts: a bag of per-currency totals, converted and rounded once when a single
// total is needed, and a cross-currency comparator through one base currency (a total preorder, so
// sorting is well defined).
import { exact, sumExact, type ExactMoney } from './exact.js';
import { add, type Money } from './money.js';
import { rateOf, type RateProvider, type RateQuery } from './provider.js';
import type { Rate } from './rate.js';
import type { RoundingMode } from './rounding.js';

/** Options for MoneyBag#total. */
export interface TotalOptions {
  readonly asOf?: string | Date;
  /** Result scale (default: the target currency's exponent). */
  readonly scale?: number;
}

function queryFor(asOf: string | Date | undefined): RateQuery | undefined {
  if (asOf === undefined) {
    return undefined;
  }
  return { asOf };
}

/** Per-currency totals of `items`, in first-seen order. */
export function sumByCurrency(items: Iterable<Money>): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const money of items) {
    const previous = totals.get(money.currency);
    if (previous === undefined) {
      totals.set(money.currency, money);
    } else {
      totals.set(money.currency, add(previous, money));
    }
  }
  return totals;
}

/** An immutable set of per-currency totals: `bag(eur10, usd5, eur2).get('EUR')` is EUR 12. */
export class MoneyBag {
  readonly #totals: ReadonlyMap<string, Money>;

  /** @internal use bag() */
  constructor(totals: ReadonlyMap<string, Money>) {
    // Copied, so a caller who keeps the Map can't change an immutable bag.
    this.#totals = new Map(totals);
  }

  /** A new bag with `items` added. */
  add(...items: Money[]): MoneyBag {
    return new MoneyBag(sumByCurrency([...this.#totals.values(), ...items]));
  }

  /** The total in `currency`, or undefined when the bag has none. */
  get<C extends string>(currency: C): Money<C> | undefined {
    return this.#totals.get(currency) as Money<C> | undefined;
  }

  /** The currencies held, in first-seen order. */
  currencies(): string[] {
    return [...this.#totals.keys()];
  }

  /** The per-currency totals, in first-seen order. */
  values(): Money[] {
    return [...this.#totals.values()];
  }

  /** Every entry converted exactly into `to` and summed. Nothing is rounded. */
  exactTotal<To extends string>(to: To, provider: RateProvider, options?: Pick<TotalOptions, 'asOf'>): ExactMoney<To> {
    const query = queryFor(options?.asOf);
    const parts: ExactMoney<To>[] = [];
    for (const money of this.#totals.values()) {
      if (money.currency === to) {
        parts.push(exact(money as Money<To>));
      } else {
        const rate = rateOf(provider, money.currency, to, query);
        parts.push(exact(money).convert(rate));
      }
    }
    return sumExact(parts, to);
  }

  /** The total in `to`, rounded once: `bag.total('EUR', fx, 'halfEven')`. */
  total<To extends string>(to: To, provider: RateProvider, rounding: RoundingMode, options?: TotalOptions): Money<To> {
    return this.exactTotal(to, provider, options).round(rounding, options?.scale);
  }

  /** The totals as a list of Money JSON values. */
  toJSON(): unknown[] {
    return this.values().map((money) => money.toJSON());
  }
}

/** A bag of the per-currency totals of `items`. */
export function bag(...items: Money[]): MoneyBag {
  return new MoneyBag(sumByCurrency(items));
}

/** Options for comparator(). */
export interface ComparatorOptions {
  /** Every amount is compared as its exact value in this currency. */
  readonly base: string;
  readonly asOf?: string | Date;
}

/** Converts amounts exactly into `options.base`, looking each currency's rate up once. */
function baseConverter(provider: RateProvider, options: ComparatorOptions): (money: Money) => ExactMoney {
  const base = options.base;
  const query = queryFor(options.asOf);
  const ratesToBase = new Map<string, Rate>();

  return (money) => {
    if (money.currency === base) {
      return exact(money);
    }
    let rate = ratesToBase.get(money.currency);
    if (rate === undefined) {
      rate = rateOf(provider, money.currency, base, query);
      ratesToBase.set(money.currency, rate);
    }
    return exact(money).convert(rate);
  };
}

/**
 * Compares amounts in any currencies through one base currency, exactly (no rounding, so rounding
 * makes no ties). One rate per currency makes it a total preorder, so
 * `list.sort(comparator(fx, { base: 'USD' }))` is consistent. Pairwise conversion with bid/ask or
 * slightly inconsistent mids is not, and Array#sort's result then differs between engines.
 * Rates are looked up once per currency, lazily: a missing rate throws from inside `sort`, after the
 * list may already be partly reordered. `sortByValue` looks every rate up first.
 */
export function comparator(
  provider: RateProvider,
  options: ComparatorOptions,
): (money: Money, other: Money) => -1 | 0 | 1 {
  const inBase = baseConverter(provider, options);
  return (money, other) => inBase(money).compare(inBase(other));
}

/**
 * A new array of `items` in ascending order of their value in `options.base`, as `comparator`
 * orders them. Every amount is converted before sorting, so a missing rate throws
 * RateUnavailableError before anything is reordered, and each amount is converted only once.
 *
 *     sortByValue([jpy100, gbp1, usd1], fx, { base: 'EUR' })   // [jpy100, usd1, gbp1]
 */
export function sortByValue<Item extends Money>(
  items: Iterable<Item>,
  provider: RateProvider,
  options: ComparatorOptions,
): Item[] {
  const inBase = baseConverter(provider, options);
  const keyed = Array.from(items, (item) => ({ item, value: inBase(item) }));
  // Array#sort is stable, so equal values keep their input order.
  keyed.sort((first, second) => first.value.compare(second.value));
  return keyed.map((entry) => entry.item);
}
