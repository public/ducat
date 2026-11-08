#!/usr/bin/env node
// Writes test/vectors/rbnf.json: ICU's own spell-out of a set of numbers in every shipped language
// and its main rule sets, the oracle test/words.test.ts checks the RBNF interpreter against. ICU
// isn't exposed to JavaScript, so this drives scripts/rbnf-oracle.cpp, built against ICU4C 79.1,
// the release whose CLDR data (49) data/rbnf comes from:
//
//   g++ -std=c++17 -I$ICU/include scripts/rbnf-oracle.cpp -L$ICU/lib -licui18n -licuuc -licudata \
//     -o rbnf-oracle
//   RBNF_ORACLE=./rbnf-oracle LD_LIBRARY_PATH=$ICU/lib node scripts/gen-rbnf-vectors.mjs [--check]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RULE_SETS = {
  en: [
    '%spellout-cardinal',
    '%spellout-cardinal-verbose',
    '%spellout-ordinal',
    '%spellout-numbering',
  ],
  de: [
    '%spellout-cardinal-masculine',
    '%spellout-cardinal-feminine',
    '%spellout-cardinal-neuter',
    '%spellout-ordinal',
    '%spellout-numbering',
  ],
  fr: [
    '%spellout-cardinal-masculine',
    '%spellout-cardinal-feminine',
    '%spellout-ordinal-masculine',
  ],
  es: [
    '%spellout-cardinal-masculine',
    '%spellout-cardinal-feminine',
    '%spellout-ordinal-masculine',
  ],
  it: [
    '%spellout-cardinal-masculine',
    '%spellout-cardinal-feminine',
    '%spellout-ordinal-masculine',
  ],
  pt: [
    '%spellout-cardinal-masculine',
    '%spellout-cardinal-feminine',
    '%spellout-ordinal-masculine',
  ],
  nl: ['%spellout-cardinal', '%spellout-ordinal', '%spellout-numbering'],
};

const numbers = new Set();
for (let i = 0; i <= 30; i++) {
  numbers.add(i);
}
for (let i = 31; i <= 130; i += 3) {
  numbers.add(i);
}
for (const value of [
  60,
  61,
  70,
  71,
  77,
  80,
  81,
  90,
  91,
  99,
  100,
  101,
  110,
  111,
  121,
  180,
  199,
  200,
  201,
  281,
  999,
  1000,
  1001,
  1010,
  1100,
  1981,
  1999,
  2000,
  2001,
  2026,
  10000,
  12345,
  21000,
  80000,
  99999,
  100000,
  100001,
  101000,
  999999,
  1000000,
  1000001,
  1100000,
  2000000,
  2000001,
  21000000,
  123456789,
  1000000000,
  2000000000,
  1000000000000,
  1000000000000000,
  999999999999999999n,
  1000000000000000000n,
  9007199254740991,
  -1,
  -21,
  -1000,
  -123456,
]) {
  numbers.add(value);
}

const oracle = process.env.RBNF_ORACLE;
if (oracle === undefined) {
  throw new Error('Set RBNF_ORACLE to the built scripts/rbnf-oracle.cpp');
}
const lines = [];
const keys = [];
for (const [locale, sets] of Object.entries(RULE_SETS)) {
  for (const ruleSet of sets) {
    for (const value of numbers) {
      lines.push(`${locale}\t${ruleSet}\t${value}`);
      keys.push([locale, ruleSet, String(value)]);
    }
  }
}
const run = spawnSync(oracle, { input: lines.join('\n') + '\n', encoding: 'utf8' });
if (run.status !== 0) {
  throw new Error(`oracle failed: ${run.stderr}`);
}
const outputs = run.stdout.split('\n');
const vectors = {};
keys.forEach(([locale, ruleSet, value], i) => {
  const text = outputs[i];
  if (text.startsWith('ERR')) {
    throw new Error(`${locale} ${ruleSet} ${value}: ${text}`);
  }
  ((vectors[locale] ??= {})[ruleSet] ??= []).push([value, text]);
});

const path = join(import.meta.dirname, '..', 'test', 'vectors', 'rbnf.json');
const output =
  JSON.stringify({ source: 'ICU4C 79.1 RuleBasedNumberFormat (CLDR 49)', vectors }, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) {
    console.error('test/vectors/rbnf.json differs from ICU');
    process.exit(1);
  }
  console.log('test/vectors/rbnf.json matches ICU');
} else {
  writeFileSync(path, output);
  console.log(`wrote ${path} (${keys.length} vectors)`);
}
