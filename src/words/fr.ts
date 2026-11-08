/**
 * `@ducatjs/money/words/fr`: French spell-out rules from CLDR, for `spellOut` and
 * `amountInWords` in `@ducatjs/money/words`.
 */
import { RULES } from '../generated/rbnf-fr.js';
import type { SpelloutRules } from '../rbnf.js';

/** French spell-out rules (CLDR 49). */
export const french: SpelloutRules = { locale: 'fr', rules: RULES };
