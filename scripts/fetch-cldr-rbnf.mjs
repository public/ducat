#!/usr/bin/env node
// Writes data/rbnf/<language>.txt: CLDR's spell-out rules (RBNF) for the languages ducat ships,
// from the cldr-rbnf package of a pinned CLDR release. `pnpm gen` turns them into
// src/generated/rbnf/<language>.ts.
//
//   node scripts/fetch-cldr-rbnf.mjs            fetch and write the rules
//   node scripts/fetch-cldr-rbnf.mjs --check    exit 1 if a file differs from the release
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '49.0.0';
export const RBNF_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl'];
const directory = join(import.meta.dirname, '..', 'data', 'rbnf');
const isCheck = process.argv.includes('--check');

let differs = false;
mkdirSync(directory, { recursive: true });
for (const language of RBNF_LANGUAGES) {
  const url = `https://unpkg.com/cldr-rbnf@${VERSION}/rbnf/${language}-SpelloutRules.txt`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const text = `# ${url}\n` + (await response.text());
  const path = join(directory, `${language}.txt`);
  if (isCheck) {
    if (readFileSync(path, 'utf8') !== text) {
      console.error(`data/rbnf/${language}.txt differs from cldr-rbnf ${VERSION}`);
      differs = true;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}
if (isCheck) {
  if (differs) {
    process.exit(1);
  }
  console.log(`data/rbnf matches cldr-rbnf ${VERSION}`);
}
