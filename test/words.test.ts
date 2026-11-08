import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defineCurrency, money } from '../src/index.js';
import { amountInWords } from '../src/words.js';
import { ruleSets, spellOut, type SpelloutRules } from '../src/rbnf.js';
import { german } from '../src/words/de.js';
import { english } from '../src/words/en.js';
import { spanish } from '../src/words/es.js';
import { french } from '../src/words/fr.js';
import { italian } from '../src/words/it.js';
import { dutch } from '../src/words/nl.js';
import { portuguese } from '../src/words/pt.js';

const LANGUAGES: Record<string, SpelloutRules> = {
  en: english,
  de: german,
  fr: french,
  es: spanish,
  it: italian,
  pt: portuguese,
  nl: dutch,
};
// ICU4C 79.1 on its own CLDR 49 data, and ICU4C 74.2 on data/rbnf's text for the other rule sets
const vectorFiles = ['vectors/rbnf.json', 'vectors/rbnf-data.json'].map(
  (file) =>
    JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as {
      source: string;
      vectors: Record<string, Record<string, [string, string][]>>;
    },
);

describe('the RBNF interpreter matches ICU', () => {
  for (const { source, vectors } of vectorFiles) {
    for (const [locale, sets] of Object.entries(vectors)) {
      for (const [ruleSet, cases] of Object.entries(sets)) {
        it(`${locale} ${ruleSet} (${source})`, () => {
          const wrong = cases
            .map(([value, expected]) => [
              value,
              expected,
              spellOut(BigInt(value), LANGUAGES[locale]!, ruleSet),
            ])
            .filter(([, expected, actual]) => expected !== actual);
          expect(wrong).toEqual([]);
        });
      }
    }
  }
});

describe('spellOut', () => {
  it('lists public rule sets', () => {
    expect(ruleSets(english)).toContain('%spellout-cardinal');
    expect(ruleSets(english).some((name) => name.startsWith('%%'))).toBe(false);
  });
});

const SOFT = '­';
const words = (text: string) => text.replaceAll('·', SOFT);

describe('amountInWords', () => {
  it('writes the whole units with the currency name, and the minor part cheque-style', () => {
    expect(amountInWords(money('123.45', 'EUR'), english)).toBe(
      'one hundred twenty-three euros and 45/100',
    );
    expect(amountInWords(money('1', 'EUR'), english)).toBe('one euro and 00/100');
    expect(amountInWords(money('1000000', 'JPY'), english)).toBe('one million Japanese yen');
    expect(amountInWords(money('123.45', 'EUR'), german)).toBe(
      words('ein·hundert·drei·und·zwanzig Euro und 45/100'),
    );
    expect(amountInWords(money('123.45', 'EUR'), french)).toBe('cent vingt-trois euros et 45/100');
    expect(amountInWords(money('123.45', 'EUR'), spanish)).toBe('ciento veintitrés euros y 45/100');
    expect(amountInWords(money('123.45', 'EUR'), italian)).toBe(
      words('cento·venti·tré euro e 45/100'),
    );
    expect(amountInWords(money('123.45', 'EUR'), portuguese)).toBe(
      'cento e vinte e três Euros e 45/100',
    );
    expect(amountInWords(money('123.45', 'EUR'), dutch)).toBe(
      words('honderddrie·ën·twintig euro en 45/100'),
    );
  });

  it('agrees with the gender it is given', () => {
    expect(amountInWords(money('21', 'EUR'), spanish)).toBe('veintiún euros y 00/100');
    expect(amountInWords(money('21', 'GBP'), spanish, { gender: 'feminine' })).toMatch(
      /^veintiuna /,
    );
    expect(amountInWords(money('21', 'EUR'), french)).toBe('vingt-et-un euros et 00/100');
    expect(amountInWords(money('21', 'EUR'), french, { gender: 'feminine' })).toMatch(
      /^vingt-et-une /,
    );
    // English has one cardinal, whatever the gender
    expect(amountInWords(money('21', 'EUR'), english, { gender: 'feminine' })).toBe(
      'twenty-one euros and 00/100',
    );
  });

  it('spells the minor part with names the caller gives', () => {
    const cents = { one: 'cent', other: 'cents' };
    expect(amountInWords(money('0.45', 'USD'), english, { minor: cents })).toBe('forty-five cents');
    expect(amountInWords(money('1.01', 'USD'), english, { minor: cents })).toBe(
      'one US dollar and one cent',
    );
    expect(
      amountInWords(money('2', 'GBP'), english, { minor: { one: 'penny', other: 'pence' } }),
    ).toBe('two British pounds');
  });

  it('writes the minor part at the amount scale, and refuses whole units past the range of ICU', () => {
    expect(amountInWords(money('1.005', 'EUR', { scale: 3 }), english)).toBe(
      'one euro and 005/1000',
    );
    expect(amountInWords(money('9223372036854775807', 'USD'), english)).toBe(
      '9,223,372,036,854,775,807 US dollars and 00/100',
    );
    expect(() => amountInWords(money('1000000000000000000000', 'USD'), english)).toThrow(
      RangeError,
    );
    expect(() => amountInWords(money('1000000000000000000000', 'USD'), english)).toThrow(
      /within ±\(2\^63 - 1\)/,
    );
  });

  it('picks the plural form of the minor unit exactly, past 2^53', () => {
    // 10^18 + 1 hundred-sextillionths: French 'many' is for exact multiples of a million only
    const names = { one: 'centime', many: 'de centimes', other: 'centimes' };
    // the rules write these as digits, grouped by the runtime's Intl
    const digits = (value: bigint) => new Intl.NumberFormat('fr').format(value);
    expect(
      amountInWords(money('0.00001000000000000000001', 'EUR', { scale: 23 }), french, {
        minor: names,
      }),
    ).toBe(`${digits(10n ** 18n + 1n)} centimes`);
    expect(amountInWords(money('0.00001', 'EUR', { scale: 23 }), french, { minor: names })).toBe(
      `${digits(10n ** 18n)} de centimes`,
    );
  });

  it('refuses a currency Intl cannot name', () => {
    // a code only this test registers (Bun runs every test file in one process)
    defineCurrency('WORDSTEST', 2);
    expect(() => amountInWords(money('1', 'WORDSTEST'), english)).toThrow(RangeError);
    expect(() => amountInWords(money('1', 'WORDSTEST'), english)).toThrow(
      'amountInWords takes currencies Intl can name (three-letter codes), got WORDSTEST',
    );
  });

  it('takes a rule set, and refuses negative amounts', () => {
    expect(
      amountInWords(money('3', 'EUR'), english, { ruleSet: '%spellout-cardinal-verbose' }),
    ).toBe('three euros and 00/100');
    expect(() => amountInWords(money('-1', 'EUR'), english)).toThrow(RangeError);
    expect(() => amountInWords(money('1', 'EUR'), english, { ruleSet: '%nope' })).toThrow(
      'No rule set %nope for en',
    );
    expect(() => amountInWords(money('1', 'EUR'), english, { ruleSet: '%%and' })).toThrow(
      RangeError,
    );
    expect(() => amountInWords(money('1', 'EUR'), english, { ruleSet: '%%and' })).toThrow(
      '%%and is a private rule set of en',
    );
  });
});

describe('spellOut', () => {
  it('spells whole numbers by any public rule set', () => {
    expect(spellOut(123, english)).toBe('one hundred twenty-three');
    expect(spellOut(21, english, '%spellout-ordinal')).toBe('twenty-first');
    expect(spellOut(-1999n, english)).toBe('minus one thousand nine hundred ninety-nine');
    expect(spellOut(21, spanish)).toBe('veintiún');
    expect(() => spellOut(1.5, english)).toThrow(RangeError);
  });

  it('refuses private rule sets, as ICU does', () => {
    expect(() => spellOut(5, english, '%%2d-year')).toThrow(RangeError);
    expect(() => spellOut(5, english, '%%2d-year')).toThrow(
      '%%2d-year is a private rule set of en',
    );
  });

  it('refuses values outside ±(2^63 - 1), where ICU writes digits instead of the rules', () => {
    const max = 2n ** 63n - 1n;
    expect(spellOut(max, english)).toBe('9,223,372,036,854,775,807');
    expect(spellOut(-max, spanish)).toBe('menos 9.223.372.036.854.775.807');
    for (const [value, rules] of [
      [2n ** 63n, english],
      [-(2n ** 63n), english],
      [2n ** 63n, spanish],
      [-(2n ** 63n), spanish],
    ] as const) {
      expect(() => spellOut(value, rules)).toThrow(RangeError);
      expect(() => spellOut(value, rules, ruleSets(rules).at(-1))).toThrow(
        /spellOut takes whole numbers within ±\(2\^63 - 1\)/,
      );
    }
  });

  it('refuses ordinals whose plural form ICU picks from a 32-bit truncation', () => {
    // ICU casts the quotient to int32 for $(ordinal,…)$; where that changes the form, refuse
    expect(() => spellOut(8721694496465577220n, english, '%spellout-ordinal')).toThrow(RangeError);
    expect(() => spellOut(8721694496465577220n, english, '%spellout-ordinal')).toThrow(
      /ICU picks the ordinal plural form of 8721694496465577220 from it cast to 32 bits/,
    );
    // where the truncated value has the same form, the words are ICU's (and exact, not by float)
    expect(spellOut(3827107958841198709n, english, '%spellout-ordinal')).toBe(
      '3,827,107,958,841,198,709th',
    );
    expect(spellOut(10n ** 18n, english, '%spellout-ordinal')).toBe('1,000,000,000,000,000,000th');
  });

  it('spells every value in every language, the same for numbers and bigints (property)', () => {
    // the ICU vectors above check the words; this checks every rule is reachable without gaps
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: 0, max: 1_000_000 }), fc.maxSafeInteger()),
        fc.constantFrom(...Object.values(LANGUAGES)),
        (value, rules) => {
          const text = spellOut(value, rules);
          expect(text).toBe(spellOut(BigInt(value), rules));
          expect(text.length).toBeGreaterThan(0);
          expect(/undefined|NaN|[<>=$%[\]]/.test(text)).toBe(false);
        },
      ),
    );
  });
});
