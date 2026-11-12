// Boundary and error-path tests for src/money.ts: each pins an edge the other suites reach only by
// chance (equal operands, ±2^53, the first item of a list, a value that is not Money).
import '../src/plugins/core.js'; // installs the core methods and registers the ISO currencies
import { describe, expect, it } from 'vitest';
import {
  abs,
  assertCurrency,
  clamp,
  CurrencyMismatchError,
  equals,
  extendMoney,
  fromJSON,
  fromMinor,
  hasFraction,
  greaterThan,
  greaterThanOrEqual,
  identical,
  isNegative,
  isPositive,
  isZero,
  lessThan,
  lessThanOrEqual,
  max,
  min,
  money,
  RoundingError,
  sign,
  subtract,
  sum,
  toDecimal,
  toScale,
  zero,
  type Money,
} from '../src/fn.js';
import { installCoreMethods } from '../src/money.js';

const MAX = Number.MAX_SAFE_INTEGER;
const eur = (s: string, scale?: number) => money(s, 'EUR', scale === undefined ? {} : { scale });

/** value, scale and representation (number while safe, bigint beyond) */
const shape = (m: Money) => [m.currency, typeof m.minor, String(m.minor), m.scale];

describe('comparisons on equal and adjacent values', () => {
  const one = eur('1.00');
  const oneAtScale1 = eur('1.0', 1);
  const next = eur('1.01');

  it('lessThan, lessThanOrEqual, greaterThan and greaterThanOrEqual at equality', () => {
    for (const same of [one, oneAtScale1]) {
      expect(lessThan(one, same)).toBe(false);
      expect(lessThanOrEqual(one, same)).toBe(true);
      expect(greaterThan(one, same)).toBe(false);
      expect(greaterThanOrEqual(one, same)).toBe(true);
    }
    expect([lessThan(one, next), lessThanOrEqual(one, next)]).toEqual([true, true]);
    expect([greaterThan(one, next), greaterThanOrEqual(one, next)]).toEqual([false, false]);
    expect([lessThan(next, one), lessThanOrEqual(next, one)]).toEqual([false, false]);
    expect([greaterThan(next, one), greaterThanOrEqual(next, one)]).toEqual([true, true]);
  });

  it('isZero, isPositive and isNegative', () => {
    const values = [eur('0.01'), eur('0'), eur('-0.01'), fromMinor(-(2n ** 60n), 'EUR')];
    expect(values.map(isZero)).toEqual([false, true, false, false]);
    expect(values.map(isPositive)).toEqual([true, false, false, false]);
    expect(values.map(isNegative)).toEqual([false, false, true, true]);
  });

  it('sign of positive, negative and zero amounts, number and bigint', () => {
    expect(sign(eur('0.01'))).toBe(1);
    expect(sign(eur('-0.01'))).toBe(-1);
    expect(sign(eur('0'))).toBe(0);
    expect(sign(fromMinor(2n ** 60n, 'EUR'))).toBe(1);
    expect(sign(fromMinor(-(2n ** 60n), 'EUR'))).toBe(-1);
  });

  it('equals compares values across scales', () => {
    expect(equals(one, oneAtScale1)).toBe(true);
    expect(equals(next, oneAtScale1)).toBe(false);
    expect(equals(eur('1.010', 3), next)).toBe(true);
    expect(equals(eur('1.011', 3), next)).toBe(false);
    expect(equals(one, money('1.00', 'USD'))).toBe(false);
  });

  it('identical needs the same currency, scale and value', () => {
    expect(identical(one, eur('1.00'))).toBe(true);
    expect(identical(one, fromMinor(100n, 'EUR'))).toBe(true);
    expect(identical(one, money('1.00', 'USD'))).toBe(false);
    // the same minor units at another scale are another value
    expect(identical(fromMinor(10, 'EUR', 1), fromMinor(10, 'EUR', 2))).toBe(false);
    // the same value at another scale
    expect(identical(one, oneAtScale1)).toBe(false);
    expect(identical(one, next)).toBe(false);
  });
});

describe('min, max and clamp', () => {
  const low = eur('1.00');
  const lowAtScale1 = eur('1.0', 1);
  const high = eur('2.00');

  it('min and max pick the extreme and keep the first of equal values', () => {
    expect(min(high, low)).toBe(low);
    expect(min(low, high)).toBe(low);
    expect(max(low, high)).toBe(high);
    expect(max(high, low)).toBe(high);
    expect(min(low, lowAtScale1)).toBe(low);
    expect(min(lowAtScale1, low)).toBe(lowAtScale1);
    expect(max(low, lowAtScale1)).toBe(low);
    expect(max(lowAtScale1, low)).toBe(lowAtScale1);
    expect(max(low, high, lowAtScale1)).toBe(high);
    expect(min(high, low, eur('1.5'))).toBe(low);
  });

  it('clamp below, inside, above and at the bounds', () => {
    expect(clamp(eur('0.50'), low, high)).toBe(low);
    expect(clamp(eur('3.00'), low, high)).toBe(high);
    const inside = eur('1.50');
    expect(clamp(inside, low, high)).toBe(inside);
    // a value equal to a bound is returned as it is, not replaced by the bound
    const atLow = eur('1.0', 1);
    const atHigh = eur('2.000', 3);
    expect(clamp(atLow, low, high)).toBe(atLow);
    expect(clamp(atHigh, low, high)).toBe(atHigh);
    // lo === hi is a valid range
    expect(clamp(eur('5'), low, low)).toBe(low);
  });

  it('clamp rejects lo > hi', () => {
    expect(() => clamp(low, high, low)).toThrow(new RangeError('clamp(): lo > hi'));
  });
});

describe('around 2^53 - 1', () => {
  it('subtract leaves the safe range exactly, both ways', () => {
    expect(shape(subtract(fromMinor(MAX, 'EUR'), fromMinor(-1, 'EUR')))).toEqual([
      'EUR',
      'bigint',
      String(2n ** 53n),
      2,
    ]);
    expect(shape(subtract(fromMinor(-MAX, 'EUR'), fromMinor(1, 'EUR')))).toEqual([
      'EUR',
      'bigint',
      String(-(2n ** 53n)),
      2,
    ]);
    expect(shape(subtract(fromMinor(MAX - 1, 'EUR'), fromMinor(-1, 'EUR')))).toEqual([
      'EUR',
      'number',
      String(MAX),
      2,
    ]);
    expect(shape(subtract(fromMinor(-MAX + 1, 'EUR'), fromMinor(1, 'EUR')))).toEqual([
      'EUR',
      'number',
      String(-MAX),
      2,
    ]);
  });

  it('subtract never returns a -0 minor', () => {
    // money(-0) keeps a -0 today; the difference must still be a plain 0
    const difference = subtract(money(-0, 'EUR'), fromMinor(0, 'EUR'));
    expect(Object.is(difference.minor, 0)).toBe(true);
  });

  it('sum leaves the safe range exactly in its fast loop', () => {
    expect(shape(sum([fromMinor(MAX, 'EUR'), fromMinor(1, 'EUR')]))).toEqual([
      'EUR',
      'bigint',
      String(2n ** 53n),
      2,
    ]);
    expect(shape(sum([fromMinor(-MAX, 'EUR'), fromMinor(-1, 'EUR')]))).toEqual([
      'EUR',
      'bigint',
      String(-(2n ** 53n)),
      2,
    ]);
    expect(shape(sum([fromMinor(MAX, 'EUR'), fromMinor(1, 'EUR'), fromMinor(-1, 'EUR')]))).toEqual([
      'EUR',
      'number',
      String(MAX),
      2,
    ]);
  });

  it('money() takes every safe integer as major units', () => {
    expect(shape(money(MAX, 'JPY'))).toEqual(['JPY', 'number', String(MAX), 0]);
    expect(shape(money(-MAX, 'JPY'))).toEqual(['JPY', 'number', String(-MAX), 0]);
    expect(toDecimal(money(MAX, 'EUR'))).toBe(`${MAX}.00`);
  });

  it('toScale scales a bigint amount up', () => {
    const big = fromMinor(2n ** 60n, 'EUR');
    expect(shape(toScale(big, 4))).toEqual(['EUR', 'bigint', String(2n ** 60n * 100n), 4]);
    expect(shape(toScale(fromMinor(-(2n ** 60n), 'EUR'), 3))).toEqual([
      'EUR',
      'bigint',
      String(-(2n ** 60n) * 10n),
      3,
    ]);
  });

  it('abs of zero and of the extremes', () => {
    expect(shape(abs(eur('0')))).toEqual(['EUR', 'number', '0', 2]);
    expect(shape(abs(fromMinor(-MAX, 'EUR')))).toEqual(['EUR', 'number', String(MAX), 2]);
  });
});

describe('hasFraction beyond scale 15', () => {
  it('reads the digits at any scale', () => {
    expect(hasFraction(zero('EUR', 16))).toBe(false);
    expect(hasFraction(fromMinor(10n ** 16n, 'EUR', 16))).toBe(false);
    expect(hasFraction(fromMinor(1, 'EUR', 16))).toBe(true);
    expect(hasFraction(fromMinor(100, 'EUR', 15))).toBe(true);
    expect(hasFraction(fromMinor(10 ** 15, 'EUR', 15))).toBe(false);
  });
});

describe('sum and currencies', () => {
  it('checks the first item against the currency given', () => {
    expect(() => sum([eur('1')], 'USD' as never)).toThrow(CurrencyMismatchError);
    expect(() => sum([eur('1'), eur('2')], 'USD' as never)).toThrow(
      'Currency mismatch: USD vs EUR',
    );
  });
});

describe('errors name the problem', () => {
  it('CurrencyMismatchError has its own name', () => {
    const error = new CurrencyMismatchError('EUR', 'USD');
    expect(error.name).toBe('CurrencyMismatchError');
    expect(String(error)).toBe('CurrencyMismatchError: Currency mismatch: EUR vs USD');
    expect(error).toBeInstanceOf(TypeError);
  });

  it('arithmetic through + or < is refused with the fix', () => {
    const m = eur('1.00');
    expect(() => +m).toThrow(
      new TypeError(
        'Money cannot be converted to a number; use add(), compare(), toDecimal() etc.',
      ),
    );
    expect(`${m}`).toBe('1.00 EUR');
  });

  it('assertCurrency names a non-Money value', () => {
    expect(() => assertCurrency({ currency: 'EUR' } as never, 'EUR')).toThrow(
      new TypeError('Expected Money, got object'),
    );
    expect(() => assertCurrency(eur('1'), 'USD')).toThrow(CurrencyMismatchError);
  });

  it('a float with too many digits points at the fix', () => {
    expect(() => money(0.1 + 0.2, 'EUR', { scale: 17 })).toThrow(
      /pass a string, or \{ rounding \}/,
    );
  });

  it('money() and fromMinor() reject other types with TypeError', () => {
    for (const bad of [true, undefined, null, {}]) {
      expect(() => money(bad as never, 'EUR')).toThrow(
        new TypeError(`Invalid amount ${String(bad)}`),
      );
      expect(() => fromMinor(bad as never, 'EUR')).toThrow(
        new TypeError(`Invalid minor units ${String(bad)}`),
      );
    }
  });

  it('an unknown rounding mode is a RangeError, not a RoundingError', () => {
    let caught: unknown;
    try {
      money('1.234', 'EUR', { rounding: 'bogus' as never });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect(caught).not.toBeInstanceOf(RoundingError);
    expect(String((caught as Error).message)).toContain('bogus');
  });

  it('fromJSON rejects anything but { amount: string, currency: string }', () => {
    const message = new TypeError('Expected { amount: string, currency: string }');
    expect(() => fromJSON('null')).toThrow(message);
    expect(() => fromJSON(null as never)).toThrow(message);
    expect(() => fromJSON('"1.00 EUR"')).toThrow(message);
    expect(() => fromJSON({ amount: 1, currency: 'EUR' } as never)).toThrow(message);
    expect(() => fromJSON({ amount: '1', currency: 1 } as never)).toThrow(message);
    expect(() => fromJSON('{"amount":"1"}')).toThrow(message);
    // a function with the right fields is still not a JSON object
    const lookalike = Object.assign(() => 0, { amount: '1', currency: 'EUR' });
    expect(() => fromJSON(lookalike as never)).toThrow(message);
  });
});

describe('installed methods are like class methods', () => {
  const classMethod = { writable: true, configurable: true, enumerable: false };
  const descriptor = (name: string) => {
    const { value, ...rest } = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(eur('1')) as object,
      name,
    )!;
    return [typeof value, rest];
  };

  it('core methods: writable, configurable, not enumerable', () => {
    expect(descriptor('add')).toEqual(['function', classMethod]);
    expect(descriptor('toString')).toEqual(['function', classMethod]);
    expect(Object.keys(eur('1'))).toEqual(['currency', 'minor', 'scale']);
  });

  it('extendMoney methods: writable, configurable, not enumerable', () => {
    extendMoney({ moneyEdgesProbe: () => 1 }, { owner: 'money-edges.test' });
    expect(descriptor('moneyEdgesProbe')).toEqual(['function', classMethod]);
    const keys: string[] = [];
    for (const key in eur('1')) {
      keys.push(key);
    }
    expect(keys).toEqual(['currency', 'minor', 'scale']);
  });

  it('installCoreMethods reinstalls its own methods', () => {
    const proto = Object.getPrototypeOf(eur('1')) as Record<string, unknown>;
    const add = proto.add;
    expect(() => installCoreMethods({ add })).not.toThrow(TypeError);
    expect(proto.add).toBe(add);
  });

  it('extendMoney refuses the names every object inherits, except toLocaleString', () => {
    for (const name of ['hasOwnProperty', 'toString', 'valueOf', 'constructor', 'isPrototypeOf']) {
      expect(() => extendMoney({ [name]: () => 1 })).toThrow(
        new TypeError(`Money#${name} is reserved`),
      );
    }
    const proto = Object.getPrototypeOf(eur('1')) as Record<string, unknown>;
    const toLocaleString = function (this: Money) {
      return `localised ${toDecimal(this)}`;
    };
    try {
      extendMoney({ toLocaleString }, { owner: 'money-edges.test' });
      expect(eur('1.50').toLocaleString()).toBe('localised 1.50');
    } finally {
      Reflect.deleteProperty(proto, 'toLocaleString');
    }
  });
});
