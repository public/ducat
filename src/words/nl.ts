/**
 * `@ducatjs/money/words/nl`: Dutch spell-out rules from CLDR, for `spellOut` and
 * `amountInWords` in `@ducatjs/money/words`.
 */
import { RULES } from '../generated/rbnf-nl.js';
import type { SpelloutRules } from '../rbnf.js';

/** Dutch spell-out rules (CLDR 49). */
export const dutch: SpelloutRules = { locale: 'nl', rules: RULES };
