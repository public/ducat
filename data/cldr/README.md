# CLDR 48 snapshot

A trimmed copy of the Unicode Common Locale Data Repository's JSON release, the data the format
and parse oracle (`scripts/gen-format-vectors.py`) reads. ducat's code doesn't read it: `format`
and `parse` use the runtime's `Intl`, whose ICU 78.3 (Node 24, Bun) carries CLDR 48. The npm
package leaves it out.

- archive: https://github.com/unicode-org/cldr-json/releases/download/48.0.0/cldr-48.0.0-json-full.zip
- tag: `48.0.0`
- sha256 `25ab2651a1a874dd62a727d3c213d7c6bf0fc269b09d2937f0499b82d99fa58e`
- fetched: 2026-11-14

`python3 scripts/trim-cldr.py cldr-48.0.0-json-full.zip` rebuilds this directory from the archive
(it checks the sha256 above first). It keeps, for the locales the format and parse documentation,
tests and vectors use:

- `main/<locale>/numbers.json`: numbering systems, symbols, and the standard decimal and currency
  patterns (no compact or scientific forms);
- `main/<locale>/currencies.json`: every currency's symbol, narrow symbol and names;
- `main/<language>/listPatterns.json`: the list patterns of ducat-words' seven languages;
- `supplemental/plurals.json`, `supplemental/ordinals.json`: plural rules for those languages;
- `supplemental/numberingSystems.json`: the digits of the numbering systems used;
- `availableLocales.json`, `defaultContent.json`: which locale tags have data.

cldr-json's `main/` files are resolved (each carries what it inherits), so no parent locales are
kept. The data is under the Unicode License v3 (`LICENSE`, from the archive; see also `NOTICE`).

ICU 78.3 ships one value that differs from this data for the locales used: fr-CH's group
separator. `data/icu/README.md` has the evidence, and those rows have their own vector files.
