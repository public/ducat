// Evidence for ducat-format's LocaleMatcher (rust/docs/design.md, "Locale matching"): on this
// runtime, Intl.NumberFormat's localeMatcher "lookup" and "best fit" resolve every locale of
// CLDR's snapshot (data/cldr/availableLocales.json) to the same locale and format it alike,
// alone, with an unknown region, with a -u-nu- keyword and with a private-use tag, as do the
// aliases ICU maps to a script (zh-TW, sr-ME, pa-PK, uz-AF). Prints the count, or each
// difference and exits 1.
//
//     node scripts/check-locale-matcher.mjs
import { readFileSync } from 'node:fs';

const available = JSON.parse(
  readFileSync(new URL('../data/cldr/availableLocales.json', import.meta.url), 'utf8'),
).availableLocales.full;
const aliases = [
  'zh-TW',
  'zh-HK',
  'zh-MO',
  'zh-SG',
  'zh-CN',
  'sr-ME',
  'sr-BA',
  'sr-XK',
  'pa-PK',
  'uz-AF',
  'az-IR',
  'mn-CN',
  'iw',
  'in',
  'tl',
  'sh',
  'no-NO',
];
const tags = new Set(aliases);
for (const locale of available) {
  if (locale === 'root' || locale === 'und') {
    continue;
  }
  tags.add(locale);
  tags.add(`${locale}-u-nu-latn`);
  tags.add(`${locale}-x-private`);
  if (!/-[A-Z]{2}$|-\d{3}$/.test(locale)) {
    tags.add(`${locale}-XX`);
  }
}
const resolve = (tag, localeMatcher) => {
  try {
    const numberFormat = new Intl.NumberFormat(tag, {
      style: 'currency',
      currency: 'EUR',
      localeMatcher,
    });
    const { locale, numberingSystem } = numberFormat.resolvedOptions();
    return `${locale} ${numberingSystem} ${numberFormat.format(-1234567.891)}`;
  } catch (error) {
    return `${error.name}`;
  }
};
const differences = [];
for (const tag of tags) {
  const lookup = resolve(tag, 'lookup');
  const bestFit = resolve(tag, 'best fit');
  if (lookup !== bestFit) {
    differences.push(`${tag}: lookup ${lookup}, best fit ${bestFit}`);
  }
}
const name =
  process.versions.bun === undefined
    ? `Node ${process.versions.node}`
    : `Bun ${process.versions.bun}`;
const runtime = `${name} (ICU ${process.versions.icu}, CLDR ${process.versions.cldr})`;
if (differences.length > 0) {
  console.log(differences.join('\n'));
  console.log(`${differences.length} of ${tags.size} tags differ on ${runtime}`);
  process.exit(1);
}
console.log(`${tags.size} tags: lookup and best fit resolve and format alike on ${runtime}`);
