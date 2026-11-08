/**
 * `@ducatjs/money/words/pt`: Portuguese spell-out rules from CLDR, for `spellOut` and
 * `amountInWords` in `@ducatjs/money/words`.
 */
import { RULES } from '../generated/rbnf-pt.js';
import type { SpelloutRules } from '../rbnf.js';

/** Portuguese spell-out rules (CLDR 49). */
export const portuguese: SpelloutRules = { locale: 'pt', rules: RULES };
