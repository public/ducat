// ducat itself, from this repository's source, driven entirely through Money methods. Kept apart
// from libraries.ts so the test suite can run the battery without installing the other libraries.
import { currencyExponent, fromMinor, money, type Money } from '../../src/index.ts';
import type { MoneyLibrary } from './vectors.ts';

export const ducatLibrary: MoneyLibrary<Money> = {
  name: 'ducat',
  fromDecimal: (decimal, currency) => money(decimal, currency),
  fromFloat: (amount, currency) => money(amount, currency),
  fromMinor: (minorUnits, currency) => fromMinor(minorUnits, currency),
  toDecimal: (value) => value.toDecimal(),
  add: (first, second) => first.add(second),
  subtract: (first, second) => first.subtract(second),
  multiply: (value, factor, mode) => value.multiply(factor, mode),
  divide: (value, divisor, mode) => value.divide(divisor, mode),
  allocate: (value, weights) => value.allocate(weights),
  split: (value, count) => value.split(count),
  convert: (value, target, rate, mode) => value.convert(target, rate, mode),
  compare: (first, second) => first.compare(second),
  equals: (first, second) => first.equals(second),
  exponent: (currency) => currencyExponent(currency),
};
