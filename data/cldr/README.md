# CLDR 48 snapshot

A trimmed copy of the Unicode Common Locale Data Repository's JSON release. Three things read it:

- the format and parse oracle, `scripts/gen-format-vectors.py`, which writes `spec/vectors/format/`
  and `spec/vectors/parse/`;
- ducat-words' generator, `rust/crates/ducat-words/tests/cldr.rs` (plural rules, digit grouping
  and the word for "and" of its seven languages);
- ducat-format's generator, `rust/crates/ducat-format/tests/data.rs` (its locale tables and Cargo
  features).

ducat's TypeScript doesn't read it: `format` and `parse` use the runtime's `Intl`, whose ICU 78.3
(Node 24, Bun) carries CLDR 48. The npm package leaves it out.

- archive: https://github.com/unicode-org/cldr-json/releases/download/48.0.0/cldr-48.0.0-json-full.zip
- tag: `48.0.0`
- sha256 `25ab2651a1a874dd62a727d3c213d7c6bf0fc269b09d2937f0499b82d99fa58e`
- fetched: 2026-11-14

`python3 scripts/trim-cldr.py cldr-48.0.0-json-full.zip` rebuilds this directory from the archive
(it checks the sha256 above first). It keeps every locale CLDR's `coverageLevels.json` rates
modern (430, root `und` included, which covers every locale the format and parse documentation,
tests and vectors use):

- `main/<locale>/numbers.json`: the default and latn numbering systems' symbols, and the standard
  decimal and currency patterns (no compact or scientific forms), resolved;
- `main/<locale>/currencies.json`: every currency's symbol, narrow symbol and names, written as
  what differs from the locale named by its `inherits` field (`parents.json`), down to root;
  the script checks that resolving them gives back cldr-json's resolved data exactly;
- `main/<language>/listPatterns.json`: the list patterns of ducat-words' seven languages;
- `supplemental/plurals.json`, `supplemental/ordinals.json`: the plural rules of those locales and
  their languages;
- `supplemental/numberingSystems.json`: the digits of the numbering systems used;
- `supplemental/likelySubtags.json`: the likely subtags of the kept languages, alone or with a
  region (`zh-TW` is `zh-Hant-TW`), which ducat-format resolves tags with;
- `parents.json`: the locale each locale's currencies inherit from (CLDR's `parentLocales`, else
  the tag without its last subtag, else root);
- `coverageLevels.json`: the locales kept;
- `availableLocales.json`, `defaultContent.json`: which locale tags have data.

The data is under the Unicode License v3 (`LICENSE`, from the archive; see also `NOTICE`).

ICU 78.3 ships one value that differs from this data for the locales the vectors use: fr-CH's
group separator. `data/icu/README.md` has the evidence; those rows have their own vector files,
and ducat-format applies the override.

## Updating CLDR

One regeneration updates the spec, ducat-words and ducat-format together, so the three never
describe different CLDR releases:

1. Fetch the new release's `cldr-<version>-json-full.zip` from the URL pattern above (plain
   `curl -L -A curl/8`), outside the repository. Record its URL, tag, sha256 and fetch date here.
2. `python3 scripts/trim-cldr.py <archive>` rewrites `data/cldr/`. Delete the archive afterwards.
3. `python3 scripts/gen-format-vectors.py` rewrites the format and parse vectors (and their
   provenance's `cldr`). Review every changed row: a change is CLDR's, and ducat's Intl must carry
   the same release, so update the files' `referenceRuntime` and the runtime it names in step 6.
4. `DUCAT_REGENERATE=1 cargo test -p ducat-words --test cldr` and
   `DUCAT_REGENERATE=1 cargo test -p ducat-format --test data` (from `rust/`) rewrite the Rust
   tables; the same commands without `DUCAT_REGENERATE` are the drift checks CI runs.
   If the shape of the tables changed (`src/tables.rs`, or what `src/data.rs` must define), the
   crate can't compile its own generator against the old file: first replace `src/data.rs` with
   a placeholder that defines the items the crate reads (`CLDR_VERSION`, `NAMES`, `locale`,
   `is_default_content`, `likely_script`, returning nothing), then regenerate. ducat-words'
   `src/cldr.rs` is bootstrapped the same way.
5. Survey the new ICU release's locale files against the new CLDR (`data/icu/README.md`) and
   update `data/icu/`; the format generator writes the override vectors and ducat-format's
   `src/icu.rs` from it.
6. Run the checks: `pnpm vectors:check`, the spec test on Node and Bun, and the Rust workspace
   tests. A row ducat or a port fails is investigated, never regenerated away.
