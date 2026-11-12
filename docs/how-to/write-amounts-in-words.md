# How to write amounts in words

This guide shows you how to write an amount in words for a cheque, an invoice or a legal document, in English, German, French, Spanish, Italian, Portuguese or Dutch. The functions are in `@ducatjs/money/words`, and each language is its own entry (`@ducatjs/money/words/en`, `/de`, `/fr`, `/es`, `/it`, `/pt`, `/nl`), so a bundle carries only the languages it imports.

## Write an amount, or spell a number

Import `amountInWords` and the language, and pass the language as the second argument:

```ts
import { money } from '@ducatjs/money';
import { amountInWords, spellOut } from '@ducatjs/money/words';
import { english } from '@ducatjs/money/words/en';
import { french } from '@ducatjs/money/words/fr';

amountInWords(money('123.45', 'EUR'), english); // → 'one hundred twenty-three euros and 45/100'
amountInWords(money('21', 'EUR'), french); // → 'vingt-et-un euros et 00/100'
amountInWords(money('1.01', 'USD'), english, { minor: { one: 'cent', other: 'cents' } }); // → 'one US dollar and one cent'
spellOut(21, english, '%spellout-ordinal'); // → 'twenty-first'
```

## Spell the minor part out

By default the minor part is written as cheques do ("and 45/100"). CLDR has no names for minor units, so if you want it in words, pass them: `{ minor: { one: 'cent', other: 'cents' } }`, as in the third line.

## Pick the gender or the rule set

If the language has genders, pass `gender` for the number's agreement (Spanish "veintiún euros", "veintiuna libras"): CLDR doesn't record a currency's gender, so it's yours to choose. Pick another of the language's rule sets with `ruleSet`; `ruleSets(language)` lists them.

## Watch for soft hyphens

German, Italian and Dutch words keep CLDR's soft hyphens (U+00AD), which show only where a line breaks. If you compare the text or put it in a fixed-width field, remove them first.

## Related

- Reference: [`@ducatjs/money/words`](../reference/words.md) (ranges and errors)
- Explanation: [Decisions](../explanation/decisions.md) (why CLDR's rules)
