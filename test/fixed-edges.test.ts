// Boundary and error-path tests for src/fixed.ts: comparisons at equality, sign, abs, trimScale's
// minimum, add and multiply across 2^53, the exponent bound, and the errors users see.
import { describe, expect, it } from 'vitest';
import { Fixed, fixed, fromScaled } from '../src/fixed.js';
import { RoundingError } from '../src/rounding.js';

const MAX = Number.MAX_SAFE_INTEGER;
const MAXN = BigInt(MAX);
const shape = (f: Fixed) => [typeof f.value, String(f.value), f.scale];

describe('comparisons and sign', () => {
  const one = fixed('1.00');
  const oneAtScale1 = fixed('1.0');
  const next = fixed('1.01');

  it('at equality and either side of it', () => {
    for (const same of [one, oneAtScale1]) {
      expect([one.lessThan(same), one.lessThanOrEqual(same)]).toEqual([false, true]);
      expect([one.greaterThan(same), one.greaterThanOrEqual(same)]).toEqual([false, true]);
    }
    expect([one.lessThan(next), one.lessThanOrEqual(next)]).toEqual([true, true]);
    expect([one.greaterThan(next), one.greaterThanOrEqual(next)]).toEqual([false, false]);
    expect([next.lessThan(one), next.lessThanOrEqual(one)]).toEqual([false, false]);
    expect([next.greaterThan(one), next.greaterThanOrEqual(one)]).toEqual([true, true]);
  });

  it('isPositive, isNegative, sign and abs', () => {
    const values = [fixed('0.01'), fixed('0'), fixed('-0.01'), fixed(-(10n ** 30n))];
    expect(values.map((f) => f.isPositive())).toEqual([true, false, false, false]);
    expect(values.map((f) => f.isNegative())).toEqual([false, false, true, true]);
    expect(values.map((f) => f.sign())).toEqual([1, 0, -1, -1]);
    expect(values.map((f) => f.abs().toString())).toEqual([
      '0.01',
      '0',
      '0.01',
      String(10n ** 30n),
    ]);
  });
});

describe('trimScale keeps the minimum scale', () => {
  it('for numbers and bigints', () => {
    expect(fixed('5.000').trimScale(2).toString()).toBe('5.00');
    expect(fixed('5.000').trimScale(1).toString()).toBe('5.0');
    expect(fixed('500.000').trimScale().toString()).toBe('500');
    expect(
      fixed(`${10n ** 20n}.000`)
        .trimScale(2)
        .toString(),
    ).toBe(`${10n ** 20n}.00`);
  });
});

describe('around 2^53 - 1', () => {
  it('add leaves the safe range exactly, both ways', () => {
    expect(shape(fromScaled(MAX, 0).add(fromScaled(1, 0)))).toEqual([
      'bigint',
      String(2n ** 53n),
      0,
    ]);
    expect(shape(fromScaled(-MAX, 0).add(fromScaled(-1, 0)))).toEqual([
      'bigint',
      String(-(2n ** 53n)),
      0,
    ]);
    expect(shape(fromScaled(MAX - 1, 0).add(fromScaled(1, 0)))).toEqual(['number', String(MAX), 0]);
    expect(shape(fromScaled(1, 0).add(fromScaled(2n ** 60n, 0)))).toEqual([
      'bigint',
      String(2n ** 60n + 1n),
      0,
    ]);
    expect(shape(fromScaled(1, 0).subtract(fromScaled(2n ** 60n, 0)))).toEqual([
      'bigint',
      String(1n - 2n ** 60n),
      0,
    ]);
  });

  it('multiply by an integer leaves the safe range exactly, both ways', () => {
    expect(shape(fromScaled(MAX, 0).multiply(3))).toEqual(['bigint', String(MAXN * 3n), 0]);
    expect(shape(fromScaled(-MAX, 0).multiply(3))).toEqual(['bigint', String(-MAXN * 3n), 0]);
    expect(shape(fromScaled(MAX, 0).multiply(-1))).toEqual(['number', String(-MAX), 0]);
    expect(shape(fromScaled(MAX, 0).multiply(1))).toEqual(['number', String(MAX), 0]);
    // a bigint value times an integer
    expect(shape(fixed(10n ** 20n).multiply(3))).toEqual(['bigint', String(3n * 10n ** 20n), 0]);
  });
});

describe('errors name the problem', () => {
  it('the constructor is private', () => {
    const Constructor = Fixed as unknown as new (
      token: symbol,
      value: number,
      scale: number,
    ) => Fixed;
    expect(() => new Constructor(Symbol('Fixed'), 1, 0)).toThrow(
      new TypeError('Use fixed() or fromScaled() to create a Fixed'),
    );
  });

  it('extra decimals say how to round', () => {
    expect(() => fixed('1.234', { scale: 2 })).toThrow(
      new RoundingError('1.234 has more than 2 decimal places; pass { rounding }'),
    );
    expect(() => fixed('1.234', { rounding: 'halfEven' })).toThrow(
      new RangeError('fixed(): `rounding` needs a `scale` to round to'),
    );
  });

  it('an unknown rounding mode stays a RangeError', () => {
    let caught: unknown;
    try {
      fixed('1.234', { scale: 2, rounding: 'bogus' as never });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect(caught).not.toBeInstanceOf(RoundingError);
  });

  it('refuses exponents beyond ±1000 before any work', () => {
    for (const text of ['1e1001', '1e+1001', '1e-1001', '1E99999999']) {
      expect(() => fixed(text)).toThrow(new RangeError(`${text}: the exponent is beyond ±1000`));
    }
    expect(fixed('1e1000').scale).toBe(0);
    expect(fixed('1e-1000').scale).toBe(1000);
    expect(() => fixed('1e1001x')).toThrow(SyntaxError);
  });

  it('rejects other values with their own messages', () => {
    for (const value of [Infinity, -Infinity, NaN]) {
      expect(() => fixed(value)).toThrow(new RangeError(`Invalid number ${value}`));
    }
    for (const value of [true, null, undefined, {}]) {
      expect(() => fixed(value as never)).toThrow(
        new TypeError(`Invalid fixed-point value ${String(value)}`),
      );
      expect(() => fromScaled(value as never, 0)).toThrow(
        new TypeError(`Invalid scaled value ${String(value)}`),
      );
    }
    expect(() => fromScaled('5' as never, 0)).toThrow(new TypeError('Invalid scaled value 5'));
  });
});

describe('fixed() of a Fixed and of a bigint', () => {
  it('returns a Fixed as it is, or at the scale asked for', () => {
    const f = fixed('1.5');
    expect(fixed(f)).toBe(f);
    expect(fixed(f, { scale: 3 }).toString()).toBe('1.500');
  });

  it('puts a bigint at the scale asked for', () => {
    expect(shape(fixed(5n, { scale: 2 }))).toEqual(['number', '500', 2]);
    expect(shape(fixed(10n ** 20n, { scale: 1 }))).toEqual(['bigint', String(10n ** 21n), 1]);
  });
});
