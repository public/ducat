/**
 * `@ducatjs/money/words`: amounts and numbers in words, as cheques, invoices and legal documents
 * need. The words come from CLDR's rule-based number formats (RBNF), the rules ICU uses, through a
 * small interpreter; each language is its own entry (`@ducatjs/money/words/en`, `/de`, `/fr`, `/es`,
 * `/it`, `/pt`, `/nl`), so a bundle carries only the languages it imports. The currency's name, in
 * the right plural, comes from the runtime's `Intl`.
 *
 *     import { amountInWords } from '@ducatjs/money/words';
 *     import { english } from '@ducatjs/money/words/en';
 *
 *     amountInWords(money('123.45', 'EUR'), english); // 'one hundred twenty-three euros and 45/100'
 *
 * Nothing here loads Money or the currency table: an amount is read through its fields.
 */
import type { Money } from './money.js';
import { cardinalFor, pluralOperand, spellOut, type SpelloutRules } from './rbnf.js';

export { ruleSets, spellOut, type SpelloutRules } from './rbnf.js';

/** Plural forms of a minor unit's name, by `Intl.PluralRules` category: `{ one: 'cent', other: 'cents' }`. */
export type UnitNames = Readonly<Partial<Record<Intl.LDMLPluralRule, string>>> & {
  readonly other: string;
};

/** Options for `amountInWords`. */
export interface AmountInWordsOptions {
  /**
   * The grammatical gender of the currency's name, which some languages' numbers agree with
   * (Spanish 'un euro' but 'una libra', French 'vingt et un' and 'vingt et une'). CLDR doesn't say
   * which gender a currency has, so it's yours to give; default masculine, where the language has
   * genders.
   */
  readonly gender?: 'masculine' | 'feminine' | 'neuter';
  /** A public rule set to spell numbers with, instead of the gender's cardinal (see `ruleSets`). */
  readonly ruleSet?: string;
  /**
   * How to write the minor part. By default, as cheques do: '45/100' after the language's 'and'
   * ('one hundred twenty-three euros and 45/100'). Give the minor unit's names to spell it out
   * instead ('and forty-five cents'): CLDR has no names for minor units, so they are yours to
   * give, in the plural forms the language uses.
   */
  readonly minor?: UnitNames;
}

const currencyNames = /* @__PURE__ */ new Map<string, Intl.NumberFormat>();
const conjunctions = /* @__PURE__ */ new Map<string, string>();
const pluralRules = /* @__PURE__ */ new Map<string, Intl.PluralRules>();

function cached<T>(cache: Map<string, T>, key: string, build: () => T): T {
  let value = cache.get(key);
  if (value === undefined) {
    if (cache.size >= 64) {
      cache.clear();
    }
    value = build();
    cache.set(key, value);
  }
  return value;
}

/** The language's 'and' between two items, with its spaces: ' and ', ' und ', ' et '. */
function conjunction(locale: string): string {
  return cached(conjunctions, locale, () => {
    const parts = new Intl.ListFormat(locale, { type: 'conjunction' }).formatToParts(['a', 'b']);
    return parts.find((part) => part.type === 'literal')?.value ?? ' ';
  });
}

/**
 * `count` of the currency in words, in the locale's order and plural: the number Intl would write
 * with the currency's name, with the digits replaced by `words`.
 */
function withCurrencyName(locale: string, currency: string, count: bigint, words: string): string {
  const format = cached(currencyNames, `${locale}\u0000${currency}`, () => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'name',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    } catch {
      // Intl names only three-letter codes
      throw new RangeError(
        `amountInWords takes currencies Intl can name (three-letter codes), got ${currency}`,
      );
    }
  });
  let output = '';
  let isNumberWritten = false;
  for (const part of format.formatToParts(count)) {
    if (part.type === 'integer' || part.type === 'group') {
      if (!isNumberWritten) {
        output += words;
        isNumberWritten = true;
      }
    } else {
      output += part.value;
    }
  }
  return output;
}

/**
 * An amount in words: the whole units spelled out with the currency's name, then the minor part.
 *
 *     amountInWords(money('123.45', 'EUR'), english) // 'one hundred twenty-three euros and 45/100'
 *     amountInWords(money('123.45', 'EUR'), german)  // 'einhundertdreiundzwanzig Euro und 45/100'
 *     amountInWords(money('21', 'EUR'), french)      // 'vingt-et-un euros et 00/100'
 *     amountInWords(money('0.45', 'USD'), english, { minor: { one: 'cent', other: 'cents' } })
 *     // 'forty-five cents'
 *
 * The minor part is written at the amount's scale, so round first for a currency's usual decimals
 * (an amount at scale 3 gives '/1000'). Zero minor units are written as '00/100' cheque-style, and
 * left out when `minor` names are given. Negative amounts throw a RangeError: words are for amounts
 * to pay, and so do whole units or spelled minor units past 2^63 - 1, where ICU's rules stop (see
 * `spellOut`). German, Italian and Dutch words keep CLDR's soft hyphens (U+00AD), which show only
 * where a line breaks. The grammar is CLDR's numbers plus Intl's currency name: languages that put
 * a preposition after a round million ('un million de yens') don't get it. The currency's name, the
 * word for 'and' and the digit grouping of numbers the rules write as digits come from the
 * runtime's `Intl`. A code Intl can't name (not three letters, such as one registered with
 * `defineCurrency('USDC', 6)`) throws a RangeError; a three-letter code Intl doesn't know is
 * written as the code ('five XBT').
 */
export function amountInWords(
  money: Money,
  rules: SpelloutRules,
  options?: AmountInWordsOptions,
): string {
  const minor = BigInt(money.minor);
  if (minor < 0n) {
    throw new RangeError(`amountInWords takes amounts of zero or more, got ${money.toString()}`);
  }
  const ruleSet = options?.ruleSet ?? cardinalFor(rules, options?.gender);
  const unit = 10n ** BigInt(money.scale);
  const whole = minor / unit;
  const fraction = minor % unit;
  const locale = rules.locale;

  const named = options?.minor;
  if (named !== undefined) {
    const plural = cached(pluralRules, locale, () => new Intl.PluralRules(locale));
    const minorWords = `${spellOut(fraction, rules, ruleSet)} ${named[plural.select(pluralOperand(fraction))] ?? named.other}`;
    if (fraction > 0n && whole === 0n) {
      return minorWords;
    }
    const majorWords = withCurrencyName(
      locale,
      money.currency,
      whole,
      spellOut(whole, rules, ruleSet),
    );
    return fraction === 0n ? majorWords : majorWords + conjunction(locale) + minorWords;
  }

  const majorWords = withCurrencyName(
    locale,
    money.currency,
    whole,
    spellOut(whole, rules, ruleSet),
  );
  if (money.scale === 0) {
    return majorWords;
  }
  const digits = String(fraction).padStart(money.scale, '0');
  return `${majorWords}${conjunction(locale)}${digits}/${unit}`;
}
