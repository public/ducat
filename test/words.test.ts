import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { money } from '../src/index.js';
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
const { vectors } = JSON.parse(
  readFileSync(new URL('vectors/rbnf.json', import.meta.url), 'utf8'),
) as { vectors: Record<string, Record<string, [string, string][]>> };

describe('the RBNF interpreter matches ICU', () => {
  for (const [locale, sets] of Object.entries(vectors)) {
    for (const [ruleSet, cases] of Object.entries(sets)) {
      it(`${locale} ${ruleSet}`, () => {
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

  it('writes the minor part at the amount scale, and exact for any size', () => {
    expect(amountInWords(money('1.005', 'EUR', { scale: 3 }), english)).toBe(
      'one euro and 005/1000',
    );
    expect(amountInWords(money('1000000000000000000000', 'USD'), english)).toBe(
      '1,000,000,000,000,000,000,000 US dollars and 00/100',
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
