// The /testing matchers called directly: pass and failure messages at the comparison edges, how
// received values are printed, the mistakes that throw, and the inspect hook's descriptor.
import '../src/plugins/iso.js';
import { describe, expect, it } from 'vitest';
import { fromMinor, money, zero } from '../src/fn.js';
import { installMoneyMatchers, moneyMatchers } from '../src/testing/index.js';

const eur = (amount: string) => money(amount, 'EUR');
const run = (
  isNot: boolean,
  name: keyof typeof moneyMatchers,
  received: unknown,
  ...args: unknown[]
) => {
  const matcher = moneyMatchers[name] as (
    this: { isNot: boolean },
    ...rest: unknown[]
  ) => {
    pass: boolean;
    message(): string;
  };
  const outcome = matcher.call({ isNot }, received, ...args);
  return [outcome.pass, outcome.message()];
};

describe('comparison matchers', () => {
  const one = eur('1');
  const oneAtScale3 = money('1.000', 'EUR', { scale: 3 });
  const two = eur('2');

  it('pass exactly at their edges, and say so', () => {
    expect(run(false, 'toBeGreaterThanMoney', one, oneAtScale3)).toEqual([
      false,
      'expected 1.00 EUR to be greater than 1.000 EUR',
    ]);
    expect(run(false, 'toBeGreaterThanOrEqualMoney', one, oneAtScale3)).toEqual([
      true,
      'expected 1.00 EUR to be greater than or equal to 1.000 EUR',
    ]);
    expect(run(false, 'toBeGreaterThanOrEqualMoney', one, two)[0]).toBe(false);
    expect(run(false, 'toBeLessThanMoney', one, oneAtScale3)).toEqual([
      false,
      'expected 1.00 EUR to be less than 1.000 EUR',
    ]);
    expect(run(false, 'toBeLessThanMoney', two, one)[0]).toBe(false);
    expect(run(true, 'toBeLessThanOrEqualMoney', one, oneAtScale3)).toEqual([
      true,
      'expected 1.00 EUR not to be less than or equal to 1.000 EUR',
    ]);
    expect(run(false, 'toBeLessThanOrEqualMoney', two, one)[0]).toBe(false);
  });

  it('throw, naming the matcher, for something that is not Money', () => {
    for (const name of [
      'toBeGreaterThanMoney',
      'toBeGreaterThanOrEqualMoney',
      'toBeLessThanMoney',
      'toBeLessThanOrEqualMoney',
    ] as const) {
      expect(() => run(false, name, 1, one)).toThrow(
        new TypeError(`${name}: expected two Money values, got 1 and 1.00 EUR`),
      );
      expect(() => run(false, name, one, '1')).toThrow(
        new TypeError(`${name}: expected two Money values, got 1.00 EUR and "1"`),
      );
    }
  });
});

describe('printing received values', () => {
  it('strings, null, bigints, arrays, objects and cycles', () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.self = cycle;
    expect(run(false, 'toHaveCurrency', 'EUR', 'EUR')[1]).toBe(
      'expected "EUR" to have currency EUR',
    );
    expect(run(false, 'toHaveCurrency', null, 'EUR')[1]).toBe('expected null to have currency EUR');
    expect(run(false, 'toHaveCurrency', 5n, 'EUR')[1]).toBe('expected 5n to have currency EUR');
    expect(run(false, 'toHaveCurrency', [1, 'a', eur('1')], 'EUR')[1]).toBe(
      'expected [1, "a", 1.00 EUR] to have currency EUR',
    );
    expect(run(false, 'toHaveCurrency', cycle, 'EUR')[1]).toBe(
      'expected { a: 1, self: [Circular] } to have currency EUR',
    );
  });
});

describe('toBeMoney and toSumTo', () => {
  it('toBeMoney takes a bigint amount at the currency exponent', () => {
    expect(run(false, 'toBeMoney', fromMinor(10n ** 20n * 100n, 'EUR'), 10n ** 20n, 'EUR')[0]).toBe(
      true,
    );
  });

  it('toSumTo says what the parts sum to, or throws for a mistake', () => {
    expect(run(false, 'toSumTo', [eur('1'), eur('2')], eur('3'))).toEqual([
      true,
      'expected [1.00 EUR, 2.00 EUR] to sum to 3.00 EUR; they sum to 3.00 EUR',
    ]);
    expect(run(true, 'toSumTo', [eur('1')], eur('3'))).toEqual([
      false,
      'expected [1.00 EUR] not to sum to 3.00 EUR',
    ]);
    expect(() => run(false, 'toSumTo', eur('1'), eur('1'))).toThrow(
      new TypeError('toSumTo: expected a list of Money and a Money total, got 1.00 EUR'),
    );
    expect(() => run(false, 'toSumTo', [eur('1')], 1)).toThrow(
      new TypeError('toSumTo: expected a list of Money and a Money total, got [1.00 EUR]'),
    );
    expect(() => run(false, 'toSumTo', [1], eur('1'))).toThrow(
      new TypeError('toSumTo: expected two Money values, got 1 and 1.00 EUR'),
    );
  });
});

describe('installMoneyMatchers', () => {
  it('works with an expect that has only extend, and installs a non-enumerable inspect hook', () => {
    const extended: unknown[] = [];
    expect(() =>
      installMoneyMatchers({ extend: (matchers: unknown) => extended.push(matchers) }),
    ).not.toThrow(TypeError);
    expect(extended).toEqual([moneyMatchers]);
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(zero('EUR')) as object,
      Symbol.for('nodejs.util.inspect.custom'),
    )!;
    expect([descriptor.writable, descriptor.configurable, descriptor.enumerable]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
