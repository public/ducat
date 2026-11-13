// The layout of the RBNF vector files, shared by scripts/gen-rbnf-vectors.mjs and anything that
// rewrites them without running ICU.
import { fileText } from './spec-vectors.mjs';

/**
 * The vector file: one words.spellOut table per language and rule set, each row a number and
 * ICU's words for it.
 */
export function rbnfVectorText(name, icuVersion, vectorsByLocale) {
  const onData = name === 'rbnf-data';
  const method = onData
    ? `ICU4C ${icuVersion} RuleBasedNumberFormat on the rule text of data/rbnf (CLDR 49)`
    : `ICU4C ${icuVersion} RuleBasedNumberFormat (CLDR 49)`;
  const tables = Object.entries(vectorsByLocale).flatMap(([locale, sets]) =>
    Object.entries(sets).map(([ruleSet, pairs]) => ({
      op: 'words.spellOut',
      parameters: { locale, ruleSet },
      rows: pairs.map(([number, words]) => ({ number, words })),
    })),
  );
  const description = onData
    ? "Integers spelled out by ICU's RBNF engine on the CLDR rule text ducat ships (data/rbnf), for the public rule sets beyond rbnf.json's."
    : "Integers spelled out by ICU's RBNF engine on its own CLDR data, for each language's main rule sets.";
  const provenance = {
    source: 'icu',
    generator: { name: 'scripts/gen-rbnf-vectors.mjs', version: '2' },
    tool: { name: 'ICU4C (scripts/rbnf-oracle.cpp)', version: icuVersion },
    method,
    data: { cldr: '49', icu: icuVersion },
  };
  return fileText('words', name, description, provenance, tables);
}
