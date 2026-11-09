import '../src/plugins/core.js'; // the tests below use the Money methods
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runs } from './fc-config.js';
import {
  assertCurrency,
  CurrencyMismatchError,
  fromMinor,
  isMoneyIn,
  money,
  type Money,
} from '../src/fn.js';

describe('isMoneyIn', () => {
  it('is true only for Money in that currency', () => {
    const price: Money<string> = money('12.34', 'EUR' as string);
    expect(isMoneyIn(price, 'EUR')).toBe(true);
    expect(isMoneyIn(price, 'USD')).toBe(false);
    expect(isMoneyIn(price, 'eur')).toBe(false);
  });

  it('is false for things that only look like Money', () => {
    expect(isMoneyIn({ currency: 'EUR', minor: 1234, scale: 2 }, 'EUR')).toBe(false);
    expect(isMoneyIn(money('1', 'EUR').toJSON(), 'EUR')).toBe(false);
    expect(isMoneyIn(null, 'EUR')).toBe(false);
    expect(isMoneyIn('12.34 EUR', 'EUR')).toBe(false);
  });

  it('agrees with the currency field for any Money', () => {
    const codes = fc.constantFrom('EUR', 'USD', 'JPY', 'KWD');
    fc.assert(
      fc.property(fc.bigInt(), codes, codes, (minor, held, asked) => {
        const value = fromMinor(minor, held as string);
        return isMoneyIn(value, asked) === (held === asked);
      }),
      { numRuns: runs(200) },
    );
  });
});

describe('assertCurrency', () => {
  it('returns for the right currency and narrows', () => {
    const price: Money<string> = money('12.34', 'EUR' as string);
    assertCurrency(price, 'EUR');
    const total: Money<'EUR'> = price.add(money('1', 'EUR'));
    expect(total.toString()).toBe('13.34 EUR');
  });

  it('throws CurrencyMismatchError for another currency', () => {
    const price: Money<string> = money('12.34', 'USD' as string);
    expect(() => assertCurrency(price, 'EUR')).toThrow(CurrencyMismatchError);
    try {
      assertCurrency(price, 'EUR');
    } catch (error) {
      expect(error).toMatchObject({ expected: 'EUR', actual: 'USD' });
    }
  });

  it('throws a TypeError for a value that is not Money', () => {
    const fake = { currency: 'EUR', minor: 1, scale: 2 } as unknown as Money;
    expect(() => assertCurrency(fake, 'EUR')).toThrow(TypeError);
    expect(() => assertCurrency(fake, 'EUR')).not.toThrow(CurrencyMismatchError);
  });
});
