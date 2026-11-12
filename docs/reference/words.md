# `@ducatjs/money/words`

Amounts and numbers in words, as cheques, invoices and legal documents need. **Installs:** nothing, and loads no Money.

Related: [How to write amounts in words](../how-to/write-amounts-in-words.md) · [Decisions](../explanation/decisions.md) (why CLDR's rules)

`Intl` can't spell numbers out, so the words come from CLDR's rule-based number formats (RBNF), the rules ICU uses, through a small interpreter that matches ICU on every test vector (`data/rbnf/`, CLDR release 49). The currency's name, in the right plural and word order, the word for "and" and the digit grouping of numbers the rules write as digits (from 10^18 in most rule sets) come from the runtime's `Intl`.

## Languages

Each language is its own entry, so a bundle carries only the ones it imports (from 0.6 to 1.8 KiB each). Each exports one `SpelloutRules` value:

| entry                     | export       |
| ------------------------- | ------------ |
| `@ducatjs/money/words/en` | `english`    |
| `@ducatjs/money/words/de` | `german`     |
| `@ducatjs/money/words/fr` | `french`     |
| `@ducatjs/money/words/es` | `spanish`    |
| `@ducatjs/money/words/it` | `italian`    |
| `@ducatjs/money/words/nl` | `dutch`      |
| `@ducatjs/money/words/pt` | `portuguese` |

German, Italian and Dutch words keep CLDR's soft hyphens (U+00AD), which show only where a line breaks.

## Functions

### amountInWords

`amountInWords(money: Money<string>, rules: SpelloutRules, options?: AmountInWordsOptions): string`

The whole units spelled out with the currency's name, then the minor part as cheques write it, after the language's "and" ("one hundred twenty-three euros and 45/100"). With `options.minor` names, the minor part is spelled out instead ("one US dollar and one cent"). The minor part is written at the amount's scale, so round first for a currency's usual decimals (an amount at scale 3 gives `/1000`). Zero minor units are written `00/100`, and left out when `minor` names are given. The grammar is CLDR's numbers plus Intl's currency name, so a preposition some languages put after a round million ("un million de yens") isn't added. A three-letter code `Intl` doesn't know is written as the code ("five XBT").

- **Throws:** `RangeError` for a negative amount (words are for amounts to pay), whole units or spelled minor units beyond 2^63 − 1, and a currency code `Intl` can't name (not three letters, such as one registered with `defineCurrency('USDC', 6)`).

### spellOut

`spellOut(value: number | bigint, rules: SpelloutRules, ruleSetName?: string): string`

A whole number in words: cardinals (default `'%spellout-cardinal'`, or the masculine one where the language has no neutral cardinal), ordinals (`'%spellout-ordinal'`) and the other public rule sets `ruleSets` lists. Accepts a safe integer or a bigint.

- **Throws:** `RangeError` where it can't give ICU's words: outside ±(2^63 − 1), the range of ICU's rules; for a private (`%%`) rule set; and for the few English ordinals from 10^18 whose suffix ICU takes from the number cut to 32 bits.

### ruleSets

`ruleSets(rules: SpelloutRules): string[]`

The public rule sets of a language: the names `spellOut` and `options.ruleSet` accept.

```ts
import { money } from '@ducatjs/money';
import { amountInWords, spellOut } from '@ducatjs/money/words';
import { english } from '@ducatjs/money/words/en';
import { spanish } from '@ducatjs/money/words/es';

amountInWords(money('0.45', 'USD'), english, { minor: { one: 'cent', other: 'cents' } }); // → 'forty-five cents'
spellOut(21, spanish, '%spellout-cardinal-feminine'); // → 'veintiuna'
amountInWords(money('-1', 'EUR'), english); // throws RangeError
```

## Types

- `SpelloutRules`: `{ locale: string; rules: string }`: the locale (which also picks plural rules and number formats) and CLDR's RBNF rule text. Import one from `@ducatjs/money/words/<language>`.
- `AmountInWordsOptions`: `{ gender?: 'masculine' | 'feminine' | 'neuter'; ruleSet?: string; minor?: UnitNames }`. `gender` picks the number's agreement where the language has genders (Spanish "veintiún euros", "veintiuna libras"); CLDR doesn't record a currency's gender, so it's the caller's, default masculine. `ruleSet` picks any public rule set instead of the gender's cardinal.
- `UnitNames`: plural forms of a minor unit's name by `Intl.PluralRules` category, `other` required: `{ one: 'cent', other: 'cents' }`. CLDR has no names for minor units.
