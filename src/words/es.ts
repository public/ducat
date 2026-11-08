/**
 * `@ducatjs/money/words/es`: Spanish spell-out rules from CLDR, for `spellOut` and
 * `amountInWords` in `@ducatjs/money/words`.
 */
import { RULES } from '../generated/rbnf-es.js';
import type { SpelloutRules } from '../rbnf.js';

/** Spanish spell-out rules (CLDR 49). */
export const spanish: SpelloutRules = { locale: 'es', rules: RULES };
