/**
 * `@ducatjs/money/words/it`: Italian spell-out rules from CLDR, for `spellOut` and
 * `amountInWords` in `@ducatjs/money/words`.
 */
import { RULES } from '../generated/rbnf-it.js';
import type { SpelloutRules } from '../rbnf.js';

/** Italian spell-out rules (CLDR 49). */
export const italian: SpelloutRules = { locale: 'it', rules: RULES };
