/**
 * `@ducatjs/money/words/de`: German spell-out rules from CLDR, for `spellOut` and
 * `amountInWords` in `@ducatjs/money/words`.
 */
import { RULES } from '../generated/rbnf-de.js';
import type { SpelloutRules } from '../rbnf.js';

/** German spell-out rules (CLDR 49). */
export const german: SpelloutRules = { locale: 'de', rules: RULES };
