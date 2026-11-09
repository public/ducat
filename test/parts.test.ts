import '../src/plugins/core.js'; // the tests below use the Money methods
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runs } from './fc-config.js';
import {
  equals,
  fromMinor,
  identical,
  majorPart,
  minorPart,
  money,
  toScale,
  type Money,
} from '../src/fn.js';

describe('majorPart and minorPart', () => {
  it('split an amount at the decimal point, keeping its sign', () => {
    expect([majorPart(money('12.34', 'EUR')), minorPart(money('12.34', 'EUR'))]).toEqual([12, 34]);
    expect([majorPart(money('-12.34', 'EUR')), minorPart(money('-12.34', 'EUR'))]).toEqual([
      -12, -34,
    ]);
    expect([majorPart(money('-0.05', 'EUR')), minorPart(money('-0.05', 'EUR'))]).toEqual([0, -5]);
    expect([majorPart(money('1234', 'JPY')), minorPart(money('1234', 'JPY'))]).toEqual([1234, 0]);
    expect([
      majorPart(money('1.005', 'EUR', { scale: 3 })),
      minorPart(money('1.005', 'EUR', { scale: 3 })),
    ]).toEqual([1, 5]);
    expect(Object.is(majorPart(money('-0.5', 'EUR')), 0)).toBe(true);
    expect(Object.is(minorPart(money('-3', 'EUR')), 0)).toBe(true);
  });

  it('are methods too', () => {
    const price = money('7.50', 'EUR');
    expect([price.majorPart(), price.minorPart()]).toEqual([7, 50]);
  });

  it('use bigint only beyond the safe range', () => {
    const huge = fromMinor(10n ** 30n + 7n, 'EUR');
    expect(majorPart(huge)).toBe(10n ** 28n);
    expect(minorPart(huge)).toBe(7);
    expect(majorPart(fromMinor(123, 'EUR', 20))).toBe(0);
    expect(minorPart(fromMinor(123, 'EUR', 20))).toBe(123);
    expect(majorPart(fromMinor(10n ** 25n, 'EUR', 20))).toBe(100000);
  });

  it('recombine to the amount (property)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
          fc.maxSafeInteger().map(BigInt),
        ),
        fc.integer({ min: 0, max: 25 }),
        (minor, scale) => {
          const value = fromMinor(minor, 'EUR', scale);
          const whole = BigInt(majorPart(value));
          const rest = BigInt(minorPart(value));
          const unit = 10n ** BigInt(scale);
          expect(whole * unit + rest).toBe(minor);
          expect(rest < unit && rest > -unit).toBe(true);
          expect(rest === 0n || rest < 0n === minor < 0n).toBe(true);
          expect(whole).toBe(minor / unit);
          for (const part of [majorPart(value), minorPart(value)]) {
            expect(
              typeof part === 'number'
                ? Number.isSafeInteger(part)
                : part > BigInt(Number.MAX_SAFE_INTEGER) || part < -BigInt(Number.MAX_SAFE_INTEGER),
            ).toBe(true);
          }
        },
      ),
      { numRuns: runs(500) },
    );
  });
});

describe('identical', () => {
  it('needs the same scale as well as the same value', () => {
    const one = money('1', 'EUR');
    const oneAtScale1 = money('1', 'EUR', { scale: 1 });
    expect(equals(one, oneAtScale1)).toBe(true);
    expect(identical(one, oneAtScale1)).toBe(false);
    expect(identical(one, money('1.00', 'EUR'))).toBe(true);
    expect(identical(one, money('1', 'USD'))).toBe(false);
    expect(one.identical(oneAtScale1)).toBe(false);
  });

  it('counts number and bigint minor units as the same value', () => {
    const asNumber = fromMinor(1234, 'EUR');
    // a bigint that slipped past normalisation, as a hand-built value from another copy might hold
    const asBigint = Object.assign(Object.create(Object.getPrototypeOf(asNumber)), {
      currency: 'EUR',
      minor: 1234n,
      scale: 2,
    }) as Money;
    expect(identical(asNumber, asBigint)).toBe(true);
  });

  it('survives a JSON round trip and implies equals (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
        fc.integer({ min: 0, max: 8 }),
        (minor, scale) => {
          const value = fromMinor(minor, 'EUR', scale);
          const back = money(value.toDecimal(), 'EUR', { scale });
          expect(identical(value, back)).toBe(true);
          const rescaled = toScale(value, scale + 1);
          expect(equals(value, rescaled)).toBe(true);
          expect(identical(value, rescaled)).toBe(false);
        },
      ),
      { numRuns: runs(300) },
    );
  });
});

describe('with', () => {
  it('applies an operation as one step of a chain', () => {
    const toFiveCents = (value: Money<'CHF'>) => value.divide(5).round('halfExpand').multiply(5);
    const total = money('10.00', 'CHF').multiply('1.077').with(toFiveCents);
    expect(total.toString()).toBe('10.75 CHF');
    expect(money('3', 'EUR').with((value) => value.toDecimal())).toBe('3.00');
  });
});
