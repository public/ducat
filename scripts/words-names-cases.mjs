#!/usr/bin/env node
// Writes ducat's amountInWords with Intl's currency names, as cases for ducat-words' cldr-names
// defaults (rust/crates/ducat-words/tests/it/names.rs, `matches_ducat_on_node`): every currency
// CLDR's snapshot (data/cldr/) or this runtime's Intl names, plus unknown, lower-case and longer
// codes, at a spread of amounts, in the seven languages. Run after `pnpm build`, on the reference
// runtime (Node 24, ICU 78.3):
//
//   node scripts/words-names-cases.mjs /tmp/words-names.json
//   DUCAT_WORDS_NAMES_CASES=/tmp/words-names.json \
//     cargo test -p ducat-words --features cldr-names --test it names:: -- --ignored
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = process.argv[2];
if (out === undefined) {
  console.error('usage: node scripts/words-names-cases.mjs <out.json>');
  process.exit(2);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (file) => import(pathToFileURL(path.join(root, 'dist', file)).href);
const { amountInWords } = await dist('words.js');
const { money, defineCurrency } = await dist('index.js');
const languages = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt'];
const rules = {};
for (const language of languages) {
  rules[language] = Object.values(await dist(`words/${language}.js`)).find((value) => value?.rules);
}
const codes = new Set(Intl.supportedValuesOf('currency'));
for (const language of languages) {
  const file = path.join(root, 'data/cldr/main', language, 'currencies.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const code of Object.keys(data.main[language].numbers.currencies)) {
    codes.add(code);
  }
}
for (const code of ['XBT', 'QQQ', 'eur', 'usd', 'btc', 'Zzz', 'USDC', 'E1R', 'XTS', 'XXX']) {
  codes.add(code);
}
const amounts = ['0', '1', '2', '21', '101', '1000000', '2000000', '1000001', '3000000000', '0.5'];
amounts.push('1.01', '1000000.25', '12345678.99');
const cases = [];
for (const code of codes) {
  try {
    money('1', code);
  } catch {
    // outside ducat's ISO table: the Rust side defines it at exponent 2 too
    defineCurrency(code, 2);
  }
  for (const amount of amounts) {
    let value;
    try {
      value = money(amount, code);
    } catch {
      // more decimals than the currency has (0.5 JPY)
      continue;
    }
    for (const language of languages) {
      let expected;
      try {
        expected = amountInWords(value, rules[language]);
      } catch (error) {
        expected = `${error.constructor.name}: ${error.message}`;
      }
      cases.push({
        language,
        code,
        units: String(value.minor),
        scale: value.scale,
        expected,
      });
    }
  }
}
const runtime = `node ${process.versions.node}, icu ${process.versions.icu}`;
fs.writeFileSync(out, `${JSON.stringify({ runtime, cases })}\n`);
console.log(`${cases.length} cases, ${codes.size} codes`);
