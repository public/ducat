// parse reads its own format output: the currency's own symbol, code or long name, as Intl writes
// it for the locale, stands for itself in an affix and adds no sign, even with characters the
// affix class doesn't take (PEN's "S/") or signs inside (CLF's "(UF)"). Anything else around the
// number is still a SyntaxError.
import '../src/plugins/core.js';
import { describe, expect, it } from 'vitest';
import { money, toDecimal } from '../src/fn.js';
import { format } from '../src/format.js';
import { parse, parseMoney } from '../src/parse.js';

const roundTrip = (amount: string, currency: string, locale: string, options?: object) =>
  toDecimal(parse(format(money(amount, currency), locale, options as never), currency, locale));

describe('parse: a name with a parenthesis or hyphen is not a sign', () => {
  it('reads positive amounts whose long name has a sign character as positive', () => {
    const name = { currencyDisplay: 'name' };
    expect(format(money('1.0000', 'CLF'), 'en', name)).toBe('1.0000 Chilean units of account (UF)');
    expect(roundTrip('1.0000', 'CLF', 'en', name)).toBe('1.0000');
    expect(format(money('5.00', 'BAM'), 'en', name)).toBe(
      '5.00 Bosnia-Herzegovina convertible marks',
    );
    expect(roundTrip('5.00', 'BAM', 'en', name)).toBe('5.00');
    // the sign outside the name still counts
    expect(roundTrip('-1.0000', 'CLF', 'en', name)).toBe('-1.0000');
    expect(roundTrip('-5.00', 'BAM', 'en', name)).toBe('-5.00');
    expect(roundTrip('-5.00', 'BAM', 'en', { ...name, currencySign: 'accounting' })).toBe('-5.00');
  });
});

describe('parse: the currency’s own text outside the affix class', () => {
  it('reads symbols with a slash or a virama', () => {
    expect(format(money('1234.50', 'PEN'), 'es-PE')).toBe('S/ 1,234.50');
    expect(roundTrip('1234.50', 'PEN', 'es-PE')).toBe('1234.50');
    expect(roundTrip('-1234.50', 'PEN', 'es-PE')).toBe('-1234.50');
    expect(format(money('1234.50', 'PAB'), 'es-PA')).toBe('B/. 1,234.50');
    expect(roundTrip('1234.50', 'PAB', 'es-PA')).toBe('1234.50');
    expect(roundTrip('1234', 'XOF', 'si')).toBe('1234');
  });

  it('reads long names with a virama or a typographic apostrophe', () => {
    const name = { currencyDisplay: 'name' };
    expect(roundTrip('5.00', 'USD', 'ml', name)).toBe('5.00');
    expect(format(money('1.0000', 'CLF'), 'fr', name)).toContain(
      'unité d’investissement chilienne',
    );
    expect(roundTrip('1.0000', 'CLF', 'fr', name)).toBe('1.0000');
  });

  it('parseMoney detects the currency from such a symbol', () => {
    expect(parseMoney('S/ 1,234.50', 'es-PE').toString()).toBe('1234.50 PEN');
  });
});

describe('parse: still strict', () => {
  it('takes the currency’s text only as a whole, and only the expected currency’s', () => {
    for (const [text, currency, locale] of [
      ['S/x 1,234.50', 'PEN', 'es-PE'],
      ['xS/ 1,234.50', 'PEN', 'es-PE'],
      ['S/# 1,234.50', 'PEN', 'es-PE'],
      ['S/ 1,234.50 /', 'PEN', 'es-PE'],
      // another currency's symbol isn't this one's
      ['S/ 1,234.50', 'USD', 'es-PE'],
      ['B/. 1,234.50', 'PEN', 'es-PA'],
      ['#1.00', 'USD', 'en-US'],
      ['US$ 1.00 *', 'USD', 'en-US'],
    ] as const) {
      expect(() => parse(text, currency, locale)).toThrow(
        new SyntaxError(`Cannot parse "${text}": unexpected characters`),
      );
    }
  });

  it('a sign beside the name or symbol still makes it negative', () => {
    expect(toDecimal(parse('-S/ 1,234.50', 'PEN', 'es-PE'))).toBe('-1234.50');
    expect(toDecimal(parse('(S/ 1,234.50)', 'PEN', 'es-PE'))).toBe('-1234.50');
    expect(toDecimal(parse('-1.0000 Chilean units of account (UF)', 'CLF', 'en'))).toBe('-1.0000');
    // a parenthesis that isn't part of the name is a sign, as before
    expect(toDecimal(parse('(1.0000 Chilean units of account)', 'CLF', 'en'))).toBe('-1.0000');
  });
});
