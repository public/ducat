import '../src/plugins/core.js'; // the tests below use the Money methods
import { expect, it } from 'vitest';
import { money } from '../src/fn.js';
import { checkThrows, documentedErrorClass, failures } from './doctest.js';

it('reads the class a throws comment names', () => {
  expect(documentedErrorClass('RoundingError: payouts must be whole HUF')).toBe('RoundingError');
  expect(documentedErrorClass('SyntaxError (pass a hint)')).toBe('SyntaxError');
  expect(documentedErrorClass(': payouts must be whole HUF')).toBeUndefined();
  expect(documentedErrorClass('')).toBeUndefined();
});

it('checkThrows accepts the named class or a subclass, and reports anything else', () => {
  failures.length = 0;
  const mismatch = () => money('1', 'EUR').add(money('1', 'USD') as never);
  checkThrows(1, mismatch, 'CurrencyMismatchError');
  checkThrows(2, mismatch, 'TypeError');
  checkThrows(3, () => money('1.005', 'EUR').toScale(2, 'unnecessary'), 'RoundingError');
  checkThrows(4, () => money('1.005', 'EUR').toScale(2, 'unnecessary'), 'RangeError');
  expect(failures).toEqual([]);

  checkThrows(5, mismatch, 'RoundingError');
  checkThrows(6, mismatch, 'NoSuchError');
  checkThrows(7, () => 1, 'RangeError');
  expect(failures.map((failure) => failure.line)).toEqual([5, 6, 7]);
  expect(failures[0]!.message).toMatch(/expected RoundingError, got CurrencyMismatchError/);
  failures.length = 0;
});
