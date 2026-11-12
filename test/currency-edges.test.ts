// defineCurrency's checks: the exponent range, names every object inherits, and redefinition.
import { describe, expect, it } from 'vitest';
import { defineCurrency } from '../src/currency.js';

describe('defineCurrency', () => {
  it('takes integer exponents from 0 to 30', () => {
    expect(() => defineCurrency('EDGEZERO', 0)).not.toThrow(RangeError);
    expect(() => defineCurrency('EDGETHIRTY', 30)).not.toThrow(RangeError);
    for (const exponent of [-1, 31, 1.5, Number.NaN, Infinity]) {
      expect(() => defineCurrency('EDGEBAD', exponent)).toThrow(
        new RangeError(`Invalid exponent ${exponent}`),
      );
    }
  });

  it('refuses names Object.prototype has', () => {
    for (const code of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(() => defineCurrency(code, 2)).toThrow(
        new TypeError(`${code} can't be a currency code`),
      );
    }
  });

  it('a second definition must agree', () => {
    defineCurrency('EDGETWICE', 4);
    expect(() => defineCurrency('EDGETWICE', 4)).not.toThrow(TypeError);
    expect(() => defineCurrency('EDGETWICE', 2)).toThrow(
      new TypeError('EDGETWICE is already defined with exponent 4'),
    );
  });
});
