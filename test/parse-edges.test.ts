// Boundary and error-path tests for src/parse.ts: characters around and inside the number,
// separators in the wrong places, the decimal separators every locale accepts, currency
// detection, and the messages users see.
import '../src/plugins/core.js';
import { describe, expect, it } from 'vitest';
import { defineCurrency, toDecimal } from '../src/fn.js';
import { parse, parseMoney } from '../src/parse.js';

const read = (text: string, currency = 'USD', locale = 'en-US') =>
  toDecimal(parse(text, currency, locale));
const detect = (text: string, locale: string, options?: Parameters<typeof parseMoney>[2]) =>
  parseMoney(text, locale, options).toString();

describe('parse: the text around the number', () => {
  it('rejects characters that are neither letters, currency signs, spaces nor signs', () => {
    for (const text of ['#1.00', '1.00#', '1.00 €x1', '@ 1.00', '1.00 *']) {
      expect(() => read(text)).toThrow(
        new SyntaxError(`Cannot parse "${text}": unexpected characters`),
      );
    }
    expect(read('US$ 1.00')).toBe('1.00');
    expect(read('(1.00)')).toBe('-1.00');
  });

  it('reads a decimal separator just before the first digit', () => {
    expect(read('$.50')).toBe('0.50');
    expect(read('.5')).toBe('0.50');
    expect(() => read('.5.0')).toThrow(
      new SyntaxError('Cannot parse ".5.0": more than one decimal separator'),
    );
  });
});

describe('parse: inside the number', () => {
  it('allows one decimal separator, and no group separator after it', () => {
    expect(() => read('1.2.3')).toThrow(
      new SyntaxError('Cannot parse "1.2.3": more than one decimal separator'),
    );
    expect(() => read('1.234,5')).toThrow(
      new SyntaxError('Cannot parse "1.234,5": group separator after the decimal separator'),
    );
  });

  it('rejects any other character', () => {
    expect(() => read('1x234.50')).toThrow(
      new SyntaxError('Cannot parse "1x234.50": unexpected "x"'),
    );
    expect(() => read("1'234.50")).toThrow(
      new SyntaxError(`Cannot parse "1'234.50": unexpected "'"`),
    );
    expect(() => read('1 234.50')).toThrow(
      new SyntaxError('Cannot parse "1 234.50": unexpected " "'),
    );
    expect(() => read('1x234,50 €', 'EUR', 'fr-FR')).toThrow(
      new SyntaxError('Cannot parse "1x234,50 €": unexpected "x"'),
    );
    expect(() => read('CHF 1x234.50', 'CHF', 'de-CH')).toThrow(
      new SyntaxError('Cannot parse "CHF 1x234.50": unexpected "x"'),
    );
  });

  it('takes any space as the group separator where the locale groups with a space', () => {
    for (const space of [' ', ' ', ' ']) {
      expect(read(`1${space}234,50 €`, 'EUR', 'fr-FR')).toBe('1234.50');
    }
  });

  it('takes either apostrophe where the locale groups with one', () => {
    expect(read("CHF 1'234.50", 'CHF', 'de-CH')).toBe('1234.50');
    expect(read('CHF 1’234.50', 'CHF', 'de-CH')).toBe('1234.50');
  });

  it('takes the Arabic separators in every locale', () => {
    expect(read('1٬234.50')).toBe('1234.50');
    expect(read('1٫50')).toBe('1.50');
    expect(read('١٬٢٣٤٫٥٠ US$', 'USD', 'ar-EG')).toBe('1234.50');
  });

  it('a currency with no Intl format uses a plain number format', () => {
    defineCurrency('PARSEEDGES', 2);
    expect(read('1,234.56', 'PARSEEDGES')).toBe('1234.56');
  });
});

describe('parse: group separators in the right places', () => {
  const wrong = (text: string, currency = 'USD', locale = 'en-US') =>
    expect(() => read(text, currency, locale)).toThrow(
      new SyntaxError(`Cannot parse "${text}": group separators in the wrong places`),
    );

  it('the first run is 1 to 3 digits (en-US)', () => {
    wrong('1234,567,890.00');
    wrong('1234,567.00');
    expect(read('123,456,789.00')).toBe('123456789.00');
  });

  it('every middle run has the secondary size', () => {
    wrong('1,23,456.00');
    wrong('1,23,456,789.00');
    wrong('1,234,56,789.00');
    wrong('1,,234,567.00');
    expect(read('1,234,567,890.00')).toBe('1234567890.00');
  });

  it('the last run has the primary size, even right before the decimal separator', () => {
    wrong('1,23.00');
    wrong('1,2345.00');
    wrong('1,.123');
    expect(read('1,234.00')).toBe('1234.00');
  });

  it('en-IN groups by 2 after the first 3', () => {
    expect(read('₹1,23,45,678.00', 'INR', 'en-IN')).toBe('12345678.00');
    wrong('1,23,4,56,789.00', 'INR', 'en-IN');
    wrong('1,2,34,567.00', 'INR', 'en-IN');
  });

  it('lenient accepts any positions', () => {
    expect(toDecimal(parse('1,23.00', 'USD', 'en-US', { lenient: true }))).toBe('123.00');
  });
});

describe('parse: locale data', () => {
  it('throws for a locale Intl resolves to another region', () => {
    const resolved = new Intl.NumberFormat('en-XX').resolvedOptions().locale;
    expect(typeof resolved).toBe('string');
    if (resolved !== 'en-XX') {
      expect(() => read('1.00', 'USD', 'en-XX')).toThrow(
        new RangeError('This runtime has no Intl data for the locale en-XX'),
      );
    }
  });
});

describe('parseMoney', () => {
  it('reads English symbols in other locales', () => {
    expect(detect('1,00 A$', 'fr-FR')).toBe('1.00 AUD');
  });

  it('does not count non-monetary codes as currencies', () => {
    for (const code of ['XAU', 'XTS', 'XXX']) {
      expect(() => detect(`${code} 1.00`, 'en-US')).toThrow(
        new SyntaxError(`Cannot parse "${code} 1.00": "${code}" is not a currency`),
      );
    }
  });

  it('a shared symbol needs a hint among its meanings', () => {
    expect(detect('kr 1.00', 'en-US', { hint: 'NOK' })).toBe('1.00 NOK');
    expect(() => detect('kr 1.00', 'en-US', { hint: 'EUR' })).toThrow(
      new SyntaxError(
        'Cannot parse "kr 1.00": "kr" could be DKK, ISK, NOK, SEK; pass a hint or symbols',
      ),
    );
    expect(() => detect('kr 1.00', 'en-US')).toThrow(
      new SyntaxError(
        'Cannot parse "kr 1.00": "kr" could be DKK, ISK, NOK, SEK; pass a hint or symbols',
      ),
    );
  });

  it('the same currency twice is fine, two different ones are not', () => {
    expect(detect('€ 1.00 EUR', 'en-US')).toBe('1.00 EUR');
    expect(() => detect('€ 1.00 USD', 'en-US')).toThrow(
      new SyntaxError('Cannot parse "€ 1.00 USD": both EUR and USD'),
    );
  });

  it('every piece of the affix must be a currency', () => {
    expect(() => detect('$1.00 .foo', 'en-US', { hint: 'USD' })).toThrow(
      new SyntaxError('Cannot parse "$1.00 .foo": ".foo" is not a currency'),
    );
  });

  it('a bare number', () => {
    expect(() => detect('1.00', 'en-US')).toThrow(
      new SyntaxError('Cannot parse "1.00": no currency in the text'),
    );
    expect(() => detect('1.00', 'en-US', { hint: 'USD' })).toThrow(
      new SyntaxError(
        'Cannot parse "1.00": no currency in the text; pass lenient: true to read a bare number in the hint',
      ),
    );
    expect(detect('1.00', 'en-US', { hint: 'USD', lenient: true })).toBe('1.00 USD');
  });
});
