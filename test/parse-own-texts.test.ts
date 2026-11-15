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

/**
 * Whether this runtime's Intl writes `expected` for the case: the repros need Node's full ICU data
 * (Deno's smaller build has no si, and writes some long names as the code). Elsewhere the case is
 * skipped with a warning; the round-trip sweep still covers whatever the runtime has.
 */
function writes(
  expected: string,
  amount: string,
  currency: string,
  locale: string,
  options?: object,
): boolean {
  const supported = Intl.NumberFormat.supportedLocalesOf(locale).length > 0;
  const text = supported ? format(money(amount, currency), locale, options as never) : '';
  if (!text.includes(expected)) {
    console.warn(
      `${locale} ${currency}: this runtime writes ${JSON.stringify(text)}, not ${JSON.stringify(expected)}: skipped`,
    );
    return false;
  }
  return true;
}

describe('parse: a name with a parenthesis or hyphen is not a sign', () => {
  it('reads positive amounts whose long name has a sign character as positive', () => {
    const name = { currencyDisplay: 'name' } as const;
    if (writes('1.0000 Chilean units of account (UF)', '1.0000', 'CLF', 'en', name)) {
      expect(roundTrip('1.0000', 'CLF', 'en', name)).toBe('1.0000');
      // the sign outside the name still counts
      expect(roundTrip('-1.0000', 'CLF', 'en', name)).toBe('-1.0000');
    }
    if (writes('5.00 Bosnia-Herzegovina convertible marks', '5.00', 'BAM', 'en', name)) {
      expect(roundTrip('5.00', 'BAM', 'en', name)).toBe('5.00');
      expect(roundTrip('-5.00', 'BAM', 'en', name)).toBe('-5.00');
      expect(roundTrip('-5.00', 'BAM', 'en', { ...name, currencySign: 'accounting' })).toBe(
        '-5.00',
      );
    }
  });

  it('reads a hyphen inside a long name as part of the name (fr NZD, pt-CV CVE)', () => {
    const name = { currencyDisplay: 'name' } as const;
    if (writes('dollars néo-zélandais', '1234.50', 'NZD', 'fr', name)) {
      expect(toDecimal(parse('1 234,50 dollars néo-zélandais', 'NZD', 'fr'))).toBe('1234.50');
      expect(toDecimal(parse('-1 234,50 dollars néo-zélandais', 'NZD', 'fr'))).toBe('-1234.50');
      expect(roundTrip('1234.50', 'NZD', 'fr', name)).toBe('1234.50');
      expect(roundTrip('-1234.50', 'NZD', 'fr', name)).toBe('-1234.50');
    }
    if (writes('escudos cabo-verdianos', '1234.50', 'CVE', 'pt-CV', name)) {
      expect(toDecimal(parse('1234$50 escudos cabo-verdianos', 'CVE', 'pt-CV'))).toBe('1234.50');
      expect(toDecimal(parse('-1234$50 escudos cabo-verdianos', 'CVE', 'pt-CV'))).toBe('-1234.50');
      expect(toDecimal(parse('1234$50- CVE', 'CVE', 'pt-CV'))).toBe('-1234.50');
    }
    expect(toDecimal(parse('USD -5.00', 'USD', 'en-US'))).toBe('-5.00');
  });

  it('reads a long name without the symbol ICU 78.3 glues to it in pt-CV and kea-CV', () => {
    // ICU 78.3 writes "BAM marcos bósnio-herzegóvinos conversíveis"; format writes the name
    // without the symbol, and parse reads both, positive
    const name = { currencyDisplay: 'name' } as const;
    const read: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const locale of ['pt-CV', 'kea-CV']) {
      if (new Intl.NumberFormat(locale).resolvedOptions().locale !== locale) {
        console.warn(`no Intl data for ${locale} in this runtime: skipped`);
        continue;
      }
      for (const currency of ['BAM', 'CRC', 'CVE', 'KRW', 'SSP', 'XAF', 'XOF', 'ZAR']) {
        for (const amount of ['1234', '-1234']) {
          read[`${locale} ${currency} ${amount}`] = roundTrip(amount, currency, locale, name);
          want[`${locale} ${currency} ${amount}`] = toDecimal(money(amount, currency));
        }
        // Intl's own text, with the symbol glued where the runtime glues it
        const intl = new Intl.NumberFormat(locale, { style: 'currency', currency, ...name });
        read[intl.format(1234)] = toDecimal(parse(intl.format(1234), currency, locale));
        want[intl.format(1234)] = toDecimal(money('1234', currency));
      }
    }
    expect(read).toEqual(want);
  });
});

describe('parse: the currency’s own text outside the affix class', () => {
  it('reads symbols with a slash or a virama', () => {
    if (writes('S/ 1,234.50', '1234.50', 'PEN', 'es-PE')) {
      expect(roundTrip('1234.50', 'PEN', 'es-PE')).toBe('1234.50');
      expect(roundTrip('-1234.50', 'PEN', 'es-PE')).toBe('-1234.50');
    }
    if (writes('B/. 1,234.50', '1234.50', 'PAB', 'es-PA')) {
      expect(roundTrip('1234.50', 'PAB', 'es-PA')).toBe('1234.50');
    }
    if (writes('1,234', '1234', 'XOF', 'si')) {
      expect(roundTrip('1234', 'XOF', 'si')).toBe('1234');
    }
  });

  it('reads long names with a virama or a typographic apostrophe', () => {
    const name = { currencyDisplay: 'name' } as const;
    if (writes('5.00', '5.00', 'USD', 'ml', name)) {
      expect(roundTrip('5.00', 'USD', 'ml', name)).toBe('5.00');
    }
    if (writes('unité d’investissement chilienne', '1.0000', 'CLF', 'fr', name)) {
      expect(roundTrip('1.0000', 'CLF', 'fr', name)).toBe('1.0000');
    }
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
