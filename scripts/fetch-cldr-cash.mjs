#!/usr/bin/env node
// Writes data/cldr-cash.json: the cash-rounding data from a CLDR release's supplementalData.xml
// (`<info iso4217 digits rounding cashDigits cashRounding>`), the second source that
// test/cash-cldr.test.ts checks data/cash-rounding.json against. Pinned to a CLDR release tag.
//
//   node scripts/fetch-cldr-cash.mjs            fetch and write the snapshot
//   node scripts/fetch-cldr-cash.mjs --check    exit 1 if the snapshot differs from the release
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE = 'release-49';
const URL = `https://raw.githubusercontent.com/unicode-org/cldr/${RELEASE}/common/supplemental/supplementalData.xml`;
const path = join(import.meta.dirname, '..', 'data', 'cldr-cash.json');

const response = await fetch(URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
  throw new Error(`${URL}: HTTP ${response.status}`);
}
const xml = await response.text();

// Only the currencies with a cash rule: everything else is cashed at its `digits`.
const currencies = {};
for (const match of xml.matchAll(/<info iso4217="([A-Z]{3})"([^>]*)\/>/g)) {
  const attributes = Object.fromEntries(
    [...match[2].matchAll(/(\w+)="(\d+)"/g)].map(([, name, value]) => [name, Number(value)]),
  );
  if (attributes.cashDigits === undefined && attributes.cashRounding === undefined) {
    continue;
  }
  currencies[match[1]] = {
    digits: attributes.digits,
    cashDigits: attributes.cashDigits ?? attributes.digits,
    cashRounding: attributes.cashRounding ?? 0,
  };
}

const snapshot = {
  source: URL,
  note:
    'CLDR <currencyData> fractions with a cash rule. cashDigits is the number of decimals cash ' +
    'amounts show, and cashRounding (0 means 1) the step in units of the last of them: CHF ' +
    'cashDigits 2, cashRounding 5 is CHF 0.05.',
  currencies: Object.fromEntries(
    Object.entries(currencies).sort(([left], [right]) => (left < right ? -1 : 1)),
  ),
};
const text = JSON.stringify(snapshot, null, 2) + '\n';

if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== text) {
    console.error(`data/cldr-cash.json differs from CLDR ${RELEASE}`);
    process.exit(1);
  }
  console.log(`data/cldr-cash.json matches CLDR ${RELEASE}`);
} else {
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}
