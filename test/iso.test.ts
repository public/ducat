import { describe, expect, it } from 'vitest';
import { currencyExponent, ISO_EXPONENTS } from '../src/currency.js';
import { add, fromMinor, toDecimal } from '../src/fn.js';
import * as iso from '../src/iso.js';

describe('@ducatjs/money/iso', () => {
  it('has one constant per ISO 4217 code, equal to the code', () => {
    expect(Object.keys(iso).sort()).toEqual(Object.keys(ISO_EXPONENTS).sort());
    for (const [name, value] of Object.entries(iso)) {
      expect(value).toBe(name);
    }
  });

  it('registers the ISO exponent', () => {
    for (const code of Object.keys(iso)) {
      expect(currencyExponent(code)).toBe(ISO_EXPONENTS[code as keyof typeof ISO_EXPONENTS]);
    }
  });

  it('works where a code does', () => {
    expect(toDecimal(add(fromMinor(1250, iso.EUR), fromMinor(1, iso.EUR)))).toBe('12.51');
    expect(toDecimal(fromMinor(5, iso.KWD))).toBe('0.005');
    expect(fromMinor(5, iso.JPY).scale).toBe(0);
  });
});
