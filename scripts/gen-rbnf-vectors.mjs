#!/usr/bin/env node
// Writes @ducatjs/money-spec's spec/vectors/words/rbnf.json: ICU's own spell-out of a set of
// numbers in every shipped language and its main rule sets, the oracle test/spec.test.ts checks the
// RBNF interpreter against. ICU
// isn't exposed to JavaScript, so this drives scripts/rbnf-oracle.cpp, built against ICU4C 79.1,
// the release whose CLDR data (49) data/rbnf comes from:
//
//   g++ -std=c++17 -I$ICU/include scripts/rbnf-oracle.cpp -L$ICU/lib -licui18n -licuuc -licudata \
//     -o rbnf-oracle
//   RBNF_ORACLE=./rbnf-oracle LD_LIBRARY_PATH=$ICU/lib node scripts/gen-rbnf-vectors.mjs [--check]
//
// With --from-data it writes spec/vectors/words/rbnf-data.json instead: ICU's engine run on the rule text
// in data/rbnf rather than on ICU's own data, for every other public rule set, so an ICU older than
// CLDR 49 (the box's ICU4C 74 made the committed file) checks the rules ducat ships. Rule sets that
// reach a '[…|…]' rule are left out: that syntax is newer than ICU 74.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rbnfVectorText } from './rbnf-vectors.mjs';
import { vectorPath } from './spec-vectors.mjs';

const fromData = process.argv.includes('--from-data');
const dataDirectory = join(import.meta.dirname, '..', 'data', 'rbnf');

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
if (fromData) {
  for (const value of [
    300,
    400,
    500,
    600,
    700,
    800,
    900,
    1000000000000000001n,
    1000000000000000021n,
    2n ** 63n - 1n,
    -(2n ** 63n - 1n),
  ]) {
    numbers.add(value);
  }
}

/** The public rule sets of a language's data/rbnf text that never reach a '[…|…]' rule. */
function publicSetsWithoutOrElse(language) {
  const sets = new Map();
  let current;
  for (const line of readFileSync(join(dataDirectory, `${language}.txt`), 'utf8').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') {
      continue;
    }
    if (line.startsWith('%') && line.trim().endsWith(':')) {
      current = { orElse: false, targets: new Set() };
      sets.set(line.trim().slice(0, -1), current);
      continue;
    }
    current.orElse ||= /\[[^\]]*\|/.test(line);
    for (const match of line.matchAll(/[<>=](%%?[\w-]+)[<>=]/g)) {
      current.targets.add(match[1]);
    }
  }
  const reachesOrElse = (name, seen = new Set()) => {
    if (seen.has(name)) {
      return false;
    }
    seen.add(name);
    const set = sets.get(name);
    return set.orElse || [...set.targets].some((target) => reachesOrElse(target, seen));
  };
  return [...sets.keys()].filter(
    (name) => !name.startsWith('%%') && !RULE_SETS[language].includes(name) && !reachesOrElse(name),
  );
}

const oracle = process.env.RBNF_ORACLE;
if (oracle === undefined) {
  throw new Error('Set RBNF_ORACLE to the built scripts/rbnf-oracle.cpp');
}
const lines = ['VERSION'];
const keys = [];
for (const locale of Object.keys(RULE_SETS)) {
  for (const ruleSet of fromData ? publicSetsWithoutOrElse(locale) : RULE_SETS[locale]) {
    for (const value of numbers) {
      lines.push(`${locale}\t${ruleSet}\t${value}`);
      keys.push([locale, ruleSet, String(value)]);
    }
  }
}
const run = spawnSync(oracle, fromData ? [dataDirectory] : [], {
  input: lines.join('\n') + '\n',
  encoding: 'utf8',
  maxBuffer: 1 << 30,
});
if (run.status !== 0) {
  throw new Error(`oracle failed: ${run.stderr}`);
}
const [version, ...outputs] = run.stdout.split('\n');
const vectors = {};
keys.forEach(([locale, ruleSet, value], i) => {
  const text = outputs[i];
  if (text.startsWith('ERR')) {
    throw new Error(`${locale} ${ruleSet} ${value}: ${text}`);
  }
  ((vectors[locale] ??= {})[ruleSet] ??= []).push([value, text]);
});

const name = fromData ? 'rbnf-data' : 'rbnf';
const path = vectorPath('words', name);
const output = rbnfVectorText(name, version, vectors);
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) {
    console.error(`spec/vectors/words/${name}.json differs from ICU`);
    process.exit(1);
  }
  console.log(`spec/vectors/words/${name}.json matches ICU`);
} else {
  writeFileSync(path, output);
  console.log(`wrote ${path} (${keys.length} vectors)`);
}
