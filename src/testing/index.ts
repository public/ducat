/**
 * `@ducatjs/money/testing`: makes Money pleasant to test with Vitest and Jest. It provides value
 * equality for `toEqual`, readable snapshots and failure output (`12.34 EUR`), and money matchers.
 * Call `installMoneyMatchers(expect)` in a setup file, or import `@ducatjs/money/testing/vitest`
 * or `@ducatjs/money/testing/jest`, which do that for you. Nothing here changes production code.
 */
import { currencyExponent } from '../currency.js';
import { parseDecimal } from '../decimal.js';
import { compare, equals, isMoney, money, sum, zero, type Money } from '../money.js';

/** An equality tester, as Vitest and Jest's `expect.addEqualityTesters` take them. */
export type MoneyEqualityTester = (left: unknown, right: unknown) => boolean | undefined;

/**
 * Money compares by value in `toEqual`, `toStrictEqual` and nested structures: same currency and
 * the same amount, whatever the scale (`1.0` and `1.00`) and whether the minor units are a number
 * or a bigint. For anything other than two Money values it returns undefined, so the usual
 * comparison applies.
 */
export const moneyEquality: MoneyEqualityTester = (left, right) => {
  if (isMoney(left) && isMoney(right)) {
    return equals(left, right);
  }
  // Anything else, including a Money from a second installed copy of the package (which isMoney
  // does not recognise), is left to the runner's own field-by-field comparison.
  return undefined;
};

/** A snapshot serializer that prints Money as `12.34 EUR` (unquoted, so it isn't a string). */
export const moneySerializer = {
  test: (value: unknown): boolean => isMoney(value),
  serialize: (value: unknown): string => String(value as Money),
};

/** What the matchers receive as `this`, the part of Vitest's and Jest's matcher state used here. */
export interface MoneyMatcherContext {
  readonly isNot: boolean;
}

/** A matcher's result, as Vitest and Jest expect it. */
export interface MoneyMatcherResult {
  pass: boolean;
  message: () => string;
  actual?: unknown;
  expected?: unknown;
}

/** The money matchers, typed for `declare module` augmentation of `Assertion` / `Matchers`. */
export interface MoneyMatchers<R = unknown> {
  /** The value is Money equal to `amount` in `currency`, at any scale: `toBeMoney('12.34', 'EUR')`. */
  toBeMoney(amount: string | number | bigint, currency: string): R;
  /** The value is Money in `currency`. */
  toHaveCurrency(currency: string): R;
  /** The value is Money greater than `other` (same currency). */
  toBeGreaterThanMoney(other: Money): R;
  /** The value is Money greater than or equal to `other` (same currency). */
  toBeGreaterThanOrEqualMoney(other: Money): R;
  /** The value is Money less than `other` (same currency). */
  toBeLessThanMoney(other: Money): R;
  /** The value is Money less than or equal to `other` (same currency). */
  toBeLessThanOrEqualMoney(other: Money): R;
  /** The value is a list of Money that sums exactly to `total`, as allocations must. */
  toSumTo(total: Money): R;
}

/**
 * Prints a received value for a failure message. JSON.stringify would throw on a bigint or a
 * cycle, and a matcher must fail cleanly, not throw while explaining the failure.
 */
function show(value: unknown, seen: Set<unknown> = new Set()): string {
  if (isMoney(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || value === null) {
    return String(value);
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => show(item, seen)).join(', ')}]`;
  }
  const fields = Object.entries(value).map(([key, field]) => `${key}: ${show(field, seen)}`);
  return `{ ${fields.join(', ')} }`;
}

function result(
  context: MoneyMatcherContext,
  pass: boolean,
  received: unknown,
  expectation: string,
  expected?: unknown,
): MoneyMatcherResult {
  return {
    pass,
    message: () => `expected ${show(received)} ${context.isNot ? 'not ' : ''}${expectation}`,
    actual: received,
    expected,
  };
}

/**
 * Comparing amounts in different currencies, or something that isn't Money, is a mistake in the
 * test, so it throws instead of failing; otherwise `.not` would quietly pass on it.
 */
function requireComparable(matcher: string, received: unknown, other: unknown): void {
  if (!isMoney(received) || !isMoney(other)) {
    throw new TypeError(
      `${matcher}: expected two Money values, got ${show(received)} and ${show(other)}`,
    );
  }
  if (received.currency !== other.currency) {
    throw new TypeError(`${matcher}: cannot compare ${received.currency} with ${other.currency}`);
  }
}

/** Decimal places in an amount as `money()` takes it, so `toBeMoney` can keep every digit. */
function decimalsOf(amount: string | number | bigint): number {
  // parseDecimal understands exponent notation ('1.5e-7'), as money() does
  return typeof amount === 'bigint' ? 0 : parseDecimal(String(amount)).scale;
}

function comparison(
  name: string,
  wording: string,
  accepts: (order: -1 | 0 | 1) => boolean,
): (this: MoneyMatcherContext, received: unknown, other: Money) => MoneyMatcherResult {
  return function (this: MoneyMatcherContext, received: unknown, other: Money) {
    requireComparable(name, received, other);
    const pass = accepts(compare(received as Money, other));
    return result(this, pass, received, `${wording} ${show(other)}`);
  };
}

/** The matcher implementations, for `expect.extend`. */
export const moneyMatchers = {
  toBeMoney(
    this: MoneyMatcherContext,
    received: unknown,
    amount: string | number | bigint,
    currency: string,
  ): MoneyMatcherResult {
    const scale = Math.max(decimalsOf(amount), currencyExponent(currency));
    const expected = money(amount, currency, { scale });
    const pass = isMoney(received) && equals(received, expected);
    return result(this, pass, received, `to be ${expected}`, expected);
  },
  toHaveCurrency(
    this: MoneyMatcherContext,
    received: unknown,
    currency: string,
  ): MoneyMatcherResult {
    const pass = isMoney(received) && received.currency === currency;
    return result(this, pass, received, `to have currency ${currency}`);
  },
  toBeGreaterThanMoney: comparison(
    'toBeGreaterThanMoney',
    'to be greater than',
    (order) => order > 0,
  ),
  toBeGreaterThanOrEqualMoney: comparison(
    'toBeGreaterThanOrEqualMoney',
    'to be greater than or equal to',
    (order) => order >= 0,
  ),
  toBeLessThanMoney: comparison('toBeLessThanMoney', 'to be less than', (order) => order < 0),
  toBeLessThanOrEqualMoney: comparison(
    'toBeLessThanOrEqualMoney',
    'to be less than or equal to',
    (order) => order <= 0,
  ),
  toSumTo(this: MoneyMatcherContext, received: unknown, total: Money): MoneyMatcherResult {
    // Not a list of Money, or parts in another currency, is a mistake in the test: throw.
    if (!Array.isArray(received) || !isMoney(total)) {
      throw new TypeError(
        `toSumTo: expected a list of Money and a Money total, got ${show(received)}`,
      );
    }
    for (const part of received) {
      requireComparable('toSumTo', part, total);
    }
    const partsSum = sum(received as Money[], total.currency);
    const pass = equals(partsSum, total);
    return {
      pass,
      message: () =>
        `expected ${show(received)} ${this.isNot ? 'not ' : ''}to sum to ${show(total)}` +
        (this.isNot ? '' : `; they sum to ${partsSum}`),
      actual: partsSum,
      expected: total,
    };
  },
};

/** The parts of Vitest's and Jest's `expect` that `installMoneyMatchers` uses. */
export interface ExpectWithExtensions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each runner types these its own way
  extend(matchers: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEqualityTesters?(testers: any[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addSnapshotSerializer?(serializer: any): void;
}

const INSPECT = Symbol.for('nodejs.util.inspect.custom');

/**
 * Installs everything on a test runner's `expect`: the matchers, value equality and the snapshot
 * serializer. It also gives Money a Node inspect hook, so `console.log(price)` prints
 * `Money(12.34 EUR)`. Safe to call more than once. A runner without `addEqualityTesters` or
 * `addSnapshotSerializer` (Bun has no equality testers) gets the rest.
 */
export function installMoneyMatchers(expect: ExpectWithExtensions): void {
  expect.extend(moneyMatchers);
  expect.addEqualityTesters?.([moneyEquality]);
  expect.addSnapshotSerializer?.(moneySerializer);

  // The inspect hook is the one change to Money itself; only test setups call this function.
  const prototype = Object.getPrototypeOf(zero('EUR')) as object;
  if (!Object.hasOwn(prototype, INSPECT)) {
    Object.defineProperty(prototype, INSPECT, {
      value(this: Money) {
        return `Money(${String(this)})`;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}
