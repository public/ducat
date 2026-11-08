/**
 * `@ducatjs/money/words/en`: English spell-out rules from CLDR, for `spellOut` and
 * `amountInWords` in `@ducatjs/money/words`.
 */
import { RULES } from '../generated/rbnf-en.js';
import type { SpelloutRules } from '../rbnf.js';

/** English spell-out rules (CLDR 49). */
export const english: SpelloutRules = { locale: 'en', rules: RULES };
