import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runs } from './fc-config.js';
import { fromMinor, money } from '../src/fn.js';
import { format } from '../src/format.js';
import { parseMoney } from '../src/parse.js';

const show = (text: string, locale?: string, options?: Parameters<typeof parseMoney>[2]) =>
  parseMoney(text, locale, options).toString();

describe('parseMoney', () => {
  it('detects ISO codes on either side', () => {
    expect(show('CHF 1’234.50', 'de-CH')).toBe('1234.50 CHF');
    expect(show('USD 100')).toBe('100.00 USD');
    expect(show('100 JPY')).toBe('100 JPY');
    expect(show('-12.5 EUR', 'en')).toBe('-12.50 EUR');
    expect(show('(1,000.00) GBP', 'en-GB')).toBe('-1000.00 GBP');
  });

  it('detects the locale’s symbols', () => {
    expect(show('1.234,50 €', 'de-DE')).toBe('1234.50 EUR');
    expect(show('€1,234.50', 'en-IE')).toBe('1234.50 EUR');
    expect(show('£12.34', 'en-GB')).toBe('12.34 GBP');
    expect(show('R$ 10,00', 'pt-BR')).toBe('10.00 BRL');
    expect(show('¥1,000', 'ja-JP')).toBe('1000 JPY');
    expect(show('₹12,34,567.50', 'en-IN')).toBe('1234567.50 INR');
  });

  it('settles a shared symbol by the locale, or by the hint', () => {
    expect(show('$5.00', 'en-US')).toBe('5.00 USD');
    expect(show('$5.00', 'en-CA')).toBe('5.00 CAD');
    expect(show('$5.00', 'en-US', { hint: 'AUD' })).toBe('5.00 AUD');
    expect(show('US$ 5', 'en-CA')).toBe('5.00 USD');
    expect(show('CA$5', 'en-US')).toBe('5.00 CAD');
  });

  it('uses the hint when the text has no currency, and throws without one', () => {
    expect(show('12.34', 'en', { hint: 'EUR' })).toBe('12.34 EUR');
    expect(() => parseMoney('12.34', 'en')).toThrow(/no currency/);
  });

  it('rejects text that is not a currency, and conflicting currencies', () => {
    expect(() => parseMoney('about 100 USD')).toThrow(/"about" is not a currency/);
    expect(() => parseMoney('USD 100 €', 'en')).toThrow(/both/);
    expect(() => parseMoney('XYZ 100')).toThrow(/not a currency/);
    expect(() => parseMoney('USD', 'en')).toThrow(/no digits/);
  });

  it('limits detection to the given currencies', () => {
    expect(show('$5', 'en-US', { currencies: ['CAD', 'EUR'] })).toBe('5.00 CAD');
    expect(() => parseMoney('USD 5', 'en', { currencies: ['EUR'] })).toThrow(/not a currency/);
  });

  it('keeps parse’s exactness rules', () => {
    expect(() => parseMoney('€1.005', 'en-IE')).toThrow(RangeError);
    expect(show('€1.005', 'en-IE', { rounding: 'halfEven' })).toBe('1.00 EUR');
    expect(show('€1.005', 'en-IE', { scale: 3 })).toBe('1.005 EUR');
  });
});

describe('parseMoney strict mode', () => {
  const strict = { strict: true } as const;

  it('needs a hint for an ambiguous symbol', () => {
    expect(() => parseMoney('$5.00', 'en-US', strict)).toThrow(/could be .*USD.*; pass a hint/);
    expect(show('$5.00', 'en-US', { ...strict, hint: 'USD' })).toBe('5.00 USD');
    expect(show('€5.00', 'en-IE', strict)).toBe('5.00 EUR');
    expect(show('USD 5', 'en', strict)).toBe('5.00 USD');
  });

  it('rejects a currency that contradicts the hint', () => {
    expect(() => parseMoney('€5.00', 'en-IE', { ...strict, hint: 'USD' })).toThrow(/expected USD/);
    expect(show('€5.00', 'en-IE', { hint: 'USD' })).toBe('5.00 EUR');
  });

  it('checks the group sizes', () => {
    expect(show('USD 1,234,567.89', 'en-US', strict)).toBe('1234567.89 USD');
    expect(show('USD 1234567.89', 'en-US', strict)).toBe('1234567.89 USD');
    expect(() => parseMoney('USD 12,34,567.89', 'en-US', strict)).toThrow(/group separators/);
    expect(() => parseMoney('USD 1,2345.00', 'en-US', strict)).toThrow(/group separators/);
    expect(() => parseMoney('USD 1234,567', 'en-US', strict)).toThrow(/group separators/);
    expect(show('₹12,34,567.50', 'en-IN', strict)).toBe('1234567.50 INR');
    expect(() => parseMoney('₹1,234,567.50', 'en-IN', strict)).toThrow(/group separators/);
    expect(show('1.234.567,89 €', 'de-DE', strict)).toBe('1234567.89 EUR');
    // loose mode accepts any grouping, as parse does
    expect(show('USD 12,34,567.89', 'en-US')).toBe('1234567.89 USD');
  });
});

describe('parseMoney reads back what format writes (property)', () => {
  const cases: [string, string][] = [
    ['en-US', 'USD'],
    ['de-DE', 'EUR'],
    ['de-CH', 'CHF'],
    ['fr-FR', 'EUR'],
    ['ja-JP', 'JPY'],
    ['en-IN', 'INR'],
    ['pt-BR', 'BRL'],
    ['en-GB', 'GBP'],
    ['ar-KW', 'KWD'],
    ['es-MX', 'MXN'],
  ];

  it('with currencyDisplay code, symbol and the locale’s own symbol, strictly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...cases),
        fc.bigInt({ min: -(10n ** 13n), max: 10n ** 13n }),
        fc.constantFrom('code', 'symbol'),
        ([locale, currency], minor, display) => {
          const value = fromMinor(minor, currency);
          const text = format(value, locale, { currencyDisplay: display });
          const back = parseMoney(text, locale, { strict: true, hint: currency });
          expect(back.equals(value)).toBe(true);
          expect(parseMoney(text, locale, { hint: currency }).equals(value)).toBe(true);
        },
      ),
      { numRuns: runs(400) },
    );
  });

  it('without a hint, for symbols the locale owns', () => {
    for (const [locale, currency] of cases) {
      const value = money('1234.5', currency, { rounding: 'halfEven' });
      const text = format(value, locale);
      expect(`${locale} ${parseMoney(text, locale).toString()}`).toBe(
        `${locale} ${value.toString()}`,
      );
    }
  });
});
