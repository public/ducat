#!/usr/bin/env node
// Writes data/cldr-territories.json: which currencies each territory uses and since when, from a CLDR
// release's supplementalData.xml (`<currencyData><region iso3166><currency iso4217 from to tender>`).
// Pinned to a CLDR release tag; `pnpm gen` turns the snapshot into src/generated/territories.ts.
//
//   node scripts/fetch-cldr-territories.mjs            fetch and write the snapshot
//   node scripts/fetch-cldr-territories.mjs --check    exit 1 if the snapshot differs from the release
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE = 'release-49';
const URL = `https://raw.githubusercontent.com/unicode-org/cldr/${RELEASE}/common/supplemental/supplementalData.xml`;
const path = join(import.meta.dirname, '..', 'data', 'cldr-territories.json');

const response = await fetch(URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
  throw new Error(`${URL}: HTTP ${response.status}`);
}
const xml = await response.text();
const currencyData = /<currencyData>([\s\S]*?)<\/currencyData>/.exec(xml)?.[1];
if (currencyData === undefined) {
  throw new Error(`${URL}: no <currencyData>`);
}

// In CLDR's order: the currency in use first, then earlier ones.
const regions = {};
for (const region of currencyData.matchAll(/<region iso3166="([A-Z0-9]+)">([\s\S]*?)<\/region>/g)) {
  const entries = [];
  for (const currency of region[2].matchAll(/<currency\s+([^>]*?)\/>/g)) {
    const attributes = Object.fromEntries(
      [...currency[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
    );
    const entry = { currency: attributes.iso4217 };
    if (attributes.from !== undefined) {
      entry.from = attributes.from;
    }
    if (attributes.to !== undefined) {
      entry.to = attributes.to;
    }
    if (attributes.tender === 'false') {
      entry.tender = false;
    }
    entries.push(entry);
  }
  regions[region[1]] = entries;
}

const snapshot = {
  source: URL,
  note:
    'CLDR <currencyData> regions: the currencies each territory (ISO 3166 code, or a CLDR region ' +
    'such as EZ) has used, newest first, with the first and last day of use where CLDR knows them. ' +
    'tender: false marks a non-tender code (a fund or accounting unit such as CHE, CHW, USN).',
  regions: Object.fromEntries(
    Object.entries(regions).sort(([left], [right]) => (left < right ? -1 : 1)),
  ),
};
const text = JSON.stringify(snapshot, null, 2) + '\n';

if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== text) {
    console.error(`data/cldr-territories.json differs from CLDR ${RELEASE}`);
    process.exit(1);
  }
  console.log(`data/cldr-territories.json matches CLDR ${RELEASE}`);
} else {
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}
