/**
 * `@ducatjs/money/testing`: makes Money pleasant to test with Vitest and Jest. It provides value
 * equality for `toEqual`, readable snapshots and failure output (`12.34 EUR`), and money matchers.
 * Call `installMoneyMatchers(expect)` in a setup file, or import `@ducatjs/money/testing/vitest`
 * or `@ducatjs/money/testing/jest`, which do that for you. Nothing here changes production code.
 */
import { currencyExponent } from '../currency.js';
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
  const leftIsMoney = isMoney(left);
  const rightIsMoney = isMoney(right);
  if (leftIsMoney && rightIsMoney) {
    return equals(left, right);
  }
  // Money against anything else is never equal; two non-Money values are left to the runner.
  return leftIsMoney || rightIsMoney ? false : undefined;
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

const show = (value: unknown): string => {
  if (isMoney(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(show).join(', ')}]`;
  }
  return typeof value === 'bigint' ? `${value}n` : (JSON.stringify(value) ?? String(value));
};

function result(
  context: MoneyMatcherContext,
  pass: boolean,
  received: unknown,
  expectation: string,
  expected?: unknown,
): MoneyMatcherResult {
  return {
    pass,
    message: () =>
      `expected ${show(received)} ${context.isNot ? 'not ' : ''}${expectation}` +
      (expected === undefined || context.isNot ? '' : `, received ${show(received)}`),
    actual: received,
    expected,
  };
}

/** Decimal places in an amount as `money()` takes it, so `toBeMoney` can keep every digit. */
function decimalsOf(amount: string | number | bigint): number {
  const text = String(amount);
  const point = text.indexOf('.');
  return point === -1 ? 0 : text.length - point - 1;
}

function comparison(
  name: string,
  accepts: (order: -1 | 0 | 1) => boolean,
): (this: MoneyMatcherContext, received: unknown, other: Money) => MoneyMatcherResult {
  return function (this: MoneyMatcherContext, received: unknown, other: Money) {
    const comparable = isMoney(received) && isMoney(other) && received.currency === other.currency;
    const pass = comparable && accepts(compare(received, other));
    return result(this, pass, received, `${name} ${show(other)}`);
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
  toBeGreaterThanMoney: comparison('to be greater than', (order) => order > 0),
  toBeGreaterThanOrEqualMoney: comparison('to be greater than or equal to', (order) => order >= 0),
  toBeLessThanMoney: comparison('to be less than', (order) => order < 0),
  toBeLessThanOrEqualMoney: comparison('to be less than or equal to', (order) => order <= 0),
  toSumTo(this: MoneyMatcherContext, received: unknown, total: Money): MoneyMatcherResult {
    const parts = Array.isArray(received) ? received : [];
    const isList =
      Array.isArray(received) &&
      isMoney(total) &&
      parts.every((part) => isMoney(part) && part.currency === total.currency);
    const partsSum = isList ? sum(parts as Money[], total.currency) : undefined;
    const pass = partsSum !== undefined && equals(partsSum, total);
    const sumText = partsSum === undefined ? 'parts in other currencies' : String(partsSum);
    return {
      pass,
      message: () =>
        `expected ${show(received)} ${this.isNot ? 'not ' : ''}to sum to ${show(total)}` +
        (this.isNot ? '' : `, but they sum to ${sumText}`),
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
 * `Money(12.34 EUR)`. Safe to call more than once.
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
