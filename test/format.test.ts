import { describe, expect, it } from 'vitest';
import { runs } from './fc-config.js';
import fc from 'fast-check';
import { equals, format, fromMinor, money, parse, toDecimal } from '../src/plugins/all.js';

const norm = (s: string) => s.replace(/[  ]/g, ' ');

describe('format', () => {
  it('locale-aware output with ISO digits', () => {
    expect(format(money('1234.5', 'EUR'), 'en-US')).toBe('€1,234.50');
    expect(norm(format(money('1234.5', 'EUR'), 'de-DE'))).toBe('1.234,50 €');
    expect(norm(format(money('1234.5', 'EUR'), 'fr-FR'))).toBe('1 234,50 €');
    expect(format(money('1234', 'JPY'), 'ja-JP')).toBe('￥1,234');
    expect(norm(format(money('1.234', 'KWD'), 'en-US'))).toBe('KWD 1.234');
    expect(format(money('-5', 'USD'), 'en-US', { currencySign: 'accounting' })).toBe('($5.00)');
    expect(format(money('1234.5', 'EUR'), 'en-GB', { currencyDisplay: 'code' })).toMatch(/^EUR\s1,234\.50$/);
  });
  it('formats beyond 2^53 exactly (Intl.NumberFormat v3 string input)', () => {
    expect(format(money('123456789012345678.91', 'USD'), 'en-US')).toBe('$123,456,789,012,345,678.91');
  });
  it('shows sub-minor scale when present', () => {
    expect(format(money('0.1234', 'USD', { scale: 4 }), 'en-US')).toBe('$0.1234');
  });
});

describe('parse', () => {
  it('real-world strings', () => {
    expect(parse('1.234,50 €', 'EUR', 'de-DE').minor).toBe(123450);
    expect(parse('€1,234.50', 'EUR', 'en-IE').minor).toBe(123450);
    expect(parse('CHF 1’234.50', 'CHF', 'de-CH').minor).toBe(123450);
    expect(parse("1'234.50", 'CHF', 'de-CH').minor).toBe(123450);
    expect(parse('1 234,50 €', 'EUR', 'fr-FR').minor).toBe(123450);
    expect(parse('($5.00)', 'USD', 'en-US').minor).toBe(-500);
    expect(parse('−5,00 €', 'EUR', 'de-DE').minor).toBe(-500);
    expect(parse('1.234,50 kr.', 'DKK', 'da-DK').minor).toBe(123450);
    expect(parse('١٢٣٫٤٥ US$', 'USD', 'ar-EG').minor).toBe(12345);
    expect(parse('₹1,23,456.78', 'INR', 'en-IN').minor).toBe(12345678);
    expect(parse('￥1,234', 'JPY', 'ja-JP').minor).toBe(1234);
  });
  it('reads separators from the currency format, which differs from the number format in some locales', () => {
    // fr-CH: '.' decimal for money (',' for plain numbers); de-AT: '.' groups for money (spaces for numbers)
    for (const [locale, currency] of [
      ['fr-CH', 'EUR'],
      ['fr-CH', 'CHF'],
      ['de-AT', 'EUR'],
    ] as const) {
      for (const minor of [5, 123456, -98765432, 100000000]) {
        const m = fromMinor(minor, currency);
        expect(equals(parse(format(m, locale), currency, locale), m), `${locale} ${currency} ${minor}`).toBe(true);
      }
    }
  });
  it('rejects ambiguous or garbage input', () => {
    expect(() => parse('1,234.50', 'EUR', 'de-DE')).toThrow(); // ',' is the decimal mark in de-DE
    expect(() => parse('12.3.4', 'EUR', 'en-US')).toThrow();
    expect(() => parse('abc', 'EUR', 'en-US')).toThrow();
    expect(() => parse('1.234', 'EUR', 'en-US')).toThrow(); // 3 decimals for EUR
  });
  it('property: parse(format(x)) === x across locales', () => {
    const locales = [
      'en-US',
      'de-DE',
      'fr-FR',
      'de-CH',
      'ja-JP',
      'ar-EG',
      'hi-IN',
      'sv-SE',
      'pt-BR',
      'en-IN',
      'fa-IR',
      'th-TH',
      'fr-CH',
      'de-AT',
    ];
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -1e13, max: 1e13 }), fc.bigInt({ min: -(10n ** 22n), max: 10n ** 22n })),
        fc.constantFrom('EUR', 'JPY', 'KWD', 'USD', 'CHF'),
        fc.constantFrom(...locales),
        (amt, cur, loc) => {
          const m = fromMinor(amt, cur);
          expect(equals(parse(format(m, loc), cur, loc), m)).toBe(true);
          expect(equals(parse(format(m, loc, { currencySign: 'accounting' }), cur, loc), m)).toBe(true);
        },
      ),
      { numRuns: runs(2000) },
    );
  });
});

describe('Intl hand-off', () => {
  it('property: minor / 10^scale is bit-identical to Number(decimal string) below 10^15', () => {
    fc.assert(
      fc.property(fc.integer({ min: -(1e15 - 1), max: 1e15 - 1 }), fc.integer({ min: 0, max: 15 }), (v, s) => {
        expect(v / 10 ** s).toBe(Number(toDecimal(fromMinor(v, 'EUR', s))));
      }),
      { numRuns: runs(50000) },
    );
  });
});
