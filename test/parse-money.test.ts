import '../src/plugins/core.js'; // the tests below use the Money methods
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runs } from './fc-config.js';
import { defineCurrency, fromMinor, money } from '../src/fn.js';
import { format } from '../src/format.js';
import { parseMoney, type ParseMoneyOptions } from '../src/parse.js';

const show = (text: string, locale: string, options?: ParseMoneyOptions) =>
  parseMoney(text, locale, options).toString();

describe('parseMoney', () => {
  it('detects ISO codes on either side', () => {
    expect(show('CHF 1’234.50', 'de-CH')).toBe('1234.50 CHF');
    expect(show('USD 100', 'en')).toBe('100.00 USD');
    expect(show('100 JPY', 'en')).toBe('100 JPY');
    expect(show('-12.5 EUR', 'en')).toBe('-12.50 EUR');
    expect(show('(1,000.00) GBP', 'en-GB')).toBe('-1000.00 GBP');
    expect(show('.50 USD', 'en')).toBe('0.50 USD');
  });

  it('detects symbols that mean one currency', () => {
    expect(show('1.234,50 €', 'de-DE')).toBe('1234.50 EUR');
    expect(show('€1,234.50', 'en-IE')).toBe('1234.50 EUR');
    expect(show('R$ 10,00', 'pt-BR')).toBe('10.00 BRL');
    expect(show('₹12,34,567.50', 'en-IN')).toBe('1234567.50 INR');
    expect(show('US$ 5', 'en-CA')).toBe('5.00 USD');
    expect(show('CA$5', 'en-US')).toBe('5.00 CAD');
  });

  it('needs a hint or a symbols entry for a shared symbol, even where the locale owns it', () => {
    // $ is the Canadian dollar's own symbol in en-CA, but a text in en-CA can still mean USD
    expect(() => parseMoney('$5.00', 'en-CA')).toThrow(/could be .*CAD.*USD.*; pass a hint/);
    expect(() => parseMoney('$5.00', 'en-US')).toThrow(/pass a hint/);
    expect(show('$5.00', 'en-CA', { hint: 'CAD' })).toBe('5.00 CAD');
    expect(show('$5.00', 'en-US', { hint: 'AUD' })).toBe('5.00 AUD');
    expect(show('$5.00', 'en-CA', { symbols: { $: 'CAD' } })).toBe('5.00 CAD');
    // £ and ¥ too: other currencies use them as narrow symbols
    expect(() => parseMoney('£5', 'en-GB')).toThrow(/FKP, GBP, GIP/);
    expect(show('£5', 'en-GB', { hint: 'GBP' })).toBe('5.00 GBP');
    expect(() => parseMoney('￥1,000', 'ja-JP')).toThrow(/CNY, JPY/);
    expect(show('￥1,000', 'ja-JP', { hint: 'JPY' })).toBe('1000 JPY');
    // Intl's own ja-JP output uses the fullwidth ￥
    expect(show(format(money('1000', 'JPY'), 'ja-JP'), 'ja-JP', { hint: 'JPY' })).toBe('1000 JPY');
  });

  it('rejects a currency that contradicts the hint', () => {
    expect(() => parseMoney('€5.00', 'en-IE', { hint: 'USD' })).toThrow(/EUR, expected USD/);
    expect(() => parseMoney('USD 5', 'en', { hint: 'EUR' })).toThrow(/expected EUR/);
    expect(() => parseMoney('USD 5', 'en', { hint: 'EUR', lenient: true })).toThrow(/expected EUR/);
  });

  it('reads a bare number only leniently, with a hint', () => {
    expect(() => parseMoney('12.34', 'en')).toThrow(/no currency/);
    expect(() => parseMoney('12.34', 'en', { hint: 'EUR' })).toThrow(/lenient/);
    expect(show('12.34', 'en', { hint: 'EUR', lenient: true })).toBe('12.34 EUR');
    expect(() => parseMoney('12.34', 'en', { lenient: true })).toThrow(/no currency/);
  });

  it('checks the group sizes unless lenient', () => {
    expect(show('USD 1,234,567.89', 'en-US')).toBe('1234567.89 USD');
    expect(show('USD 1234567.89', 'en-US')).toBe('1234567.89 USD');
    expect(() => parseMoney('USD 12,34,567.89', 'en-US')).toThrow(/group separators/);
    expect(() => parseMoney('USD 1,2345.00', 'en-US')).toThrow(/group separators/);
    expect(() => parseMoney('USD 1234,567', 'en-US')).toThrow(/group separators/);
    expect(show('₹12,34,567.50', 'en-IN')).toBe('1234567.50 INR');
    // en-IN's accounting format groups in threes ((₹1,234,567.50)), so both are its own output
    expect(show('₹1,234,567.50', 'en-IN')).toBe('1234567.50 INR');
    expect(() => parseMoney('₹1,2345,67.50', 'en-IN')).toThrow(/group separators/);
    expect(show('1.234.567,89 €', 'de-DE')).toBe('1234567.89 EUR');
    expect(show('USD 12,34,567.89', 'en-US', { lenient: true })).toBe('1234567.89 USD');
  });

  it('throws for a locale this runtime has no Intl data for, instead of falling back', () => {
    expect(() => parseMoney('USD 5', 'en-ZZ')).toThrow(/no Intl data for the locale en-ZZ/);
    expect(() => parseMoney('€5', 'xx-YY')).toThrow(/no Intl data/);
  });

  it('rejects text that is not a currency, and conflicting currencies', () => {
    expect(() => parseMoney('about 100 USD', 'en')).toThrow(/"about" is not a currency/);
    expect(() => parseMoney('USD 100 €', 'en')).toThrow(/both/);
    expect(() => parseMoney('US$ 12 CAD', 'en')).toThrow(/both USD and CAD/);
    expect(() => parseMoney('XYZ 100', 'en')).toThrow(/not a currency/);
    expect(() => parseMoney('usd 12', 'en')).toThrow(/not a currency/);
    expect(() => parseMoney('100USDT', 'en')).toThrow(/not a currency/);
    expect(() => parseMoney('USD', 'en')).toThrow(/no digits/);
  });

  it('limits detection to the given currencies, which may be custom codes', () => {
    expect(show('$5', 'en-US', { currencies: ['CAD', 'EUR'] })).toBe('5.00 CAD');
    expect(() => parseMoney('USD 5', 'en', { currencies: ['EUR'] })).toThrow(/not a currency/);
    // a code no other test file registers: the registry is global, and Bun shares it
    defineCurrency('XPM', 3);
    expect(() => parseMoney('XPM 1.5', 'en')).toThrow(/not a currency/);
    expect(show('XPM 1.5', 'en', { currencies: ['XPM'] })).toBe('1.500 XPM');
  });

  it('keeps parse’s exactness rules', () => {
    expect(() => parseMoney('€1.005', 'en-IE')).toThrow(RangeError);
    expect(show('€1.005', 'en-IE', { rounding: 'halfEven' })).toBe('1.00 EUR');
    expect(show('€1.005', 'en-IE', { scale: 3 })).toBe('1.005 EUR');
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

  it('with symbols and a hint', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...cases),
        fc.bigInt({ min: -(10n ** 13n), max: 10n ** 13n }),
        ([locale, currency], minor) => {
          const value = fromMinor(minor, currency);
          const text = format(value, locale);
          expect(parseMoney(text, locale, { hint: currency }).equals(value)).toBe(true);
        },
      ),
      { numRuns: runs(400) },
    );
  });

  it('with currency codes and no hint', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...cases),
        fc.bigInt({ min: -(10n ** 13n), max: 10n ** 13n }),
        ([locale, currency], minor) => {
          const value = fromMinor(minor, currency);
          const text = format(value, locale, { currencyDisplay: 'code' });
          expect(parseMoney(text, locale).equals(value)).toBe(true);
        },
      ),
      { numRuns: runs(300) },
    );
  });
});

// #310: symbols with a space in them ("F CFA" for XOF and XAF in fr-SN) were split into "F" and "CFA"
describe('parseMoney reads symbols that contain a space', () => {
  it('reads XOF in fr-SN, with a hint because XAF writes the same symbol', () => {
    const text = format(money('1000', 'XOF'), 'fr-SN');
    expect(text).toMatch(/F\s*CFA/u);
    expect(show(text, 'fr-SN', { hint: 'XOF' })).toBe('1000 XOF');
    expect(() => parseMoney(text, 'fr-SN')).toThrow(/could be XAF, XOF/);
  });

  it('still reads a code and a symbol side by side, and signs around them', () => {
    expect(show('12 EUR €', 'fr-FR')).toBe('12.00 EUR');
    expect(show('US $ 12.50', 'en-US')).toBe('12.50 USD');
    expect(show('-1 234,50 €', 'fr-FR')).toBe('-1234.50 EUR');
  });

  it('matches custom symbols without regard to spaces', () => {
    expect(show('12 F CFA', 'fr-SN', { symbols: { 'F CFA': 'XOF' } })).toBe('12 XOF');
    expect(show('12 FCFA', 'fr-SN', { symbols: { 'F CFA': 'XOF' } })).toBe('12 XOF');
  });

  it('reads back what format writes, for every currency whose symbol has a space', () => {
    const locales = [
      'fr-SN',
      'fr-CM',
      'fr-CI',
      'fr-FR',
      'fr-CA',
      'de-CH',
      'es-MX',
      'pt-BR',
      'ar-EG',
      'en-IN',
      'ru-RU',
      'sw-KE',
    ];
    const codes = [
      'XOF',
      'XAF',
      'XPF',
      'CHF',
      'EUR',
      'USD',
      'CAD',
      'MXN',
      'BRL',
      'EGP',
      'INR',
      'RUB',
      'KES',
      'SAR',
      'AED',
      'ZAR',
    ];
    let checked = 0;
    for (const locale of locales) {
      for (const code of codes) {
        const value = money('1234.5', code, { rounding: 'halfExpand' });
        const text = format(value, locale);
        const symbol = text.replace(/[\d\s\p{Z}\p{Cf}.,٫٬'’()+\-−]/gu, '');
        const spaced = new Intl.NumberFormat(locale, { style: 'currency', currency: code })
          .formatToParts(1)
          .find((part) => part.type === 'currency')!.value;
        if (!/[\s\p{Z}]/u.test(spaced.trim()) || symbol === '') {
          continue;
        }
        checked++;
        expect([locale, code, parseMoney(text, locale, { hint: code }).toString()]).toEqual([
          locale,
          code,
          value.toString(),
        ]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
