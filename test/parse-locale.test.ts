import '../src/plugins/iso.js';
import { describe, expect, it } from 'vitest';
import { parse, parseMoney } from '../src/parse.js';

// #271: parse refuses a locale the runtime has no number data for, as parseMoney does, rather than
// reading the amount with another locale's separators.
describe('parse and the locale', () => {
  it('throws a RangeError naming a locale with no Intl data', () => {
    expect(() => parse('1.234,50', 'EUR', 'xx-ZZ')).toThrow(RangeError);
    expect(() => parse('1.234,50', 'EUR', 'xx-ZZ')).toThrow(
      'This runtime has no Intl data for the locale xx-ZZ',
    );
    // and again from the cache: a refused locale is never cached as usable
    expect(() => parse('5', 'EUR', 'xx-ZZ')).toThrow(RangeError);
  });

  it('refuses a region Intl falls back from (de-XX reads as de), as parseMoney does', () => {
    // A region can change the separators (de-CH groups with ’, de-DE with .), so a fallback to
    // the base language could misread the amount: only language and region together are accepted.
    expect(() => parse('1.234,50', 'EUR', 'de-XX')).toThrow(
      'This runtime has no Intl data for the locale de-XX',
    );
    expect(() => parseMoney('1.234,50 €', 'de-XX')).toThrow(/no Intl data for the locale de-XX/);
    expect(parse('1.234,50', 'EUR', 'de').toString()).toBe('1234.50 EUR');
    expect(parse('1’234.50', 'CHF', 'de-CH').toString()).toBe('1234.50 CHF');
  });

  it('accepts supported locales and the default locale', () => {
    expect(parse('1.234,50', 'EUR', 'de-DE').toString()).toBe('1234.50 EUR');
    expect(parse('1,234.50', 'USD', 'en-US').toString()).toBe('1234.50 USD');
    expect(parse('12.50', 'EUR').toString()).toBe('12.50 EUR');
  });

  it('throws for a malformed tag', () => {
    expect(() => parse('5', 'EUR', 'not a locale')).toThrow(RangeError);
  });
});
