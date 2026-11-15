# ICU 78.3 overrides

ICU's shipped data where it deliberately differs from CLDR's. Two things read it:

- `scripts/gen-format-vectors.py`, for the ICU-overrides vectors
  (`spec/vectors/format/icu-overrides.json`, `spec/vectors/parse/icu-overrides.json`), which it
  computes from the CLDR 48 snapshot in `data/cldr/` with these values applied;
- ducat-format's generator (`rust/crates/ducat-format/tests/it/data.rs`), for its `src/icu.rs`.

ducat's TypeScript doesn't read it, and the npm package leaves it out. The files are ICU's own, at
tag `release-78.3` of https://github.com/unicode-org/icu, unchanged:

| file | from (`icu4c/source/data/…`) | sha256 | what it overrides |
| --- | --- | --- | --- |
| `fr_CH.txt` | `locales/fr_CH.txt` | `ffb73f672e4bb219dbbdeacf25d98bfafc1f30f85003dc90725556f5cc7b2ef8` | lines 10-13 set `symbols{ currencyDecimal{"."} group{"'"} }`; CLDR 48's `common/main/fr_CH.xml` (tag `release-48`, lines 215-217) sets only `currencyDecimal`, so CLDR's fr-CH group is fr's U+202F |
| `curr/my.txt` | `curr/my.txt` | `bfece21219c7450f4e144f1ea190308a6008b9ae291bace62a443145b02d34f8` | it has no `CurrencyUnitPatterns`, so ICU writes a Burmese currency name after the number with root's `{0} {1}`; CLDR 48's my has `{1} {0}` (`unitPattern-count-other` in both numbering systems) |
| `curr/root.txt` | `curr/root.txt` | `84aab2f013961df1e74af6d056585f4dcc4e9eb3c5e7e46e763a8affe313cc5f` | root's `CurrencyUnitPatterns` (lines 206-208), which a curr/ file without its own inherits |

`fr_CH.txt` was fetched 2026-11-14 from
https://raw.githubusercontent.com/unicode-org/icu/release-78.3/icu4c/source/data/locales/fr_CH.txt,
the `curr/` files on 2026-11-14 (21:04 UTC) from the same tag's `curr/` directory. The format
generator reads only the files' `NumberElements` symbols and `CurrencyUnitPatterns`.

Neither override is in a locale the format and parse vectors use other than fr-CH, which has its
own vector files. `rust/crates/ducat-format/tests/it/runtime.rs` checks each override against what
ducat's TypeScript writes on Node 24 (ICU 78.3), and parses its text back.

## The survey

ICU 78.3's `locales/*.txt` and `curr/*.txt` for every one of the snapshot's 430 locales (fetched
2026-11-14 from the tag above; 860 files, 4 locales files and 94 curr files absent, where ICU has
none) were compared with CLDR 48, each side resolved through its own parents (ICU's `%%Parent` and
truncation, CLDR's `inherits`): the default numbering system, minimum grouping digits, the number
symbols (decimal, group, minus and plus signs, currency decimal and group), the decimal, currency
and accounting patterns, every currency's symbol and narrow symbol, its own format (pattern and
separators), and the unit patterns. What differs:

- **fr-CH's group separator** and **my's unit pattern**: the two data overrides above.
- **A currency's own format.** Where CLDR gives a currency a pattern or separators in a locale (EUR
  in en-150 and the European English locales, PTE in pt-PT, CVE in pt-CV, LUF in de-LU, EEK in
  et, ESP in ca, GRD in el), ICU stores the pattern together with separators, filling in the
  separators of the locale that defines it (en-150's `.` and `,`) and the pattern of that locale
  where CLDR has none; descendants inherit all three, so en-NL writes EUR as `€1,234.50`, not with
  its own `,` decimal. ICU then writes that currency in that pattern for every sign and display,
  and its symbols load the format of the locale's region's currency for the locale, which other
  currencies without one keep: en-NL writes USD as `US$1,234.50` too. ducat-format does the same
  for a symbol, narrow symbol or code (`Locale::currency_format`), from CLDR's data, so nothing
  here is copied for it. A name it writes as TR35 has it, by ducat's decision: the number, with
  the separators the symbol form uses for the currency (so parse reads it back), the decimal
  pattern's grouping and no symbol, in the unit pattern with the plural name (`1,234.567 Kuwaiti dinars` and
  `1,234.50 euros` in en-NL, `1.234,50 euros` in en-AT), never the currency's own pattern or
  symbol; it follows ICU's data, not its code.
- **Locales ICU doesn't ship**: `be-tarask`, `ca-ES-valencia`, `el-polyton` and `ht` have no
  locales file, and `Intl` falls back (ht formats as English; nb-SJ and ht count as without data
  for ducat's parse). ducat-format has CLDR's data for them, so it formats them as CLDR does and
  parses them.

Not overrides, and not copied: ICU stores one `other` unit pattern where CLDR repeats it for every
plural category, and splits long strings into adjacent pieces (so, yo). Two ICU behaviours that
ducat's TypeScript inherits and ducat-format doesn't copy, found by formatting 21,450 cases in
every locale through both:

- a currency with its own pattern shown by name, at a scale other than the pattern's two digits,
  comes out garbled: `format(money('1234.567', 'KWD'), 'en-NL', { currencyDisplay: 'name' })` is
  `KWD 1,234.56 Kuwaiti dinars7` on Node 24 (ICU 78.3); ducat-format writes TR35's
  `1,234.567 Kuwaiti dinars`, with the separators of en-NL's currency format, and ducat's
  TypeScript is to match (ducat#363);
- sr-Cyrl-ME's currency names are Latin in ICU (`američkih dolara`), Cyrillic in CLDR;
- pt-CV's long names carry the region currency's pattern and a symbol in ICU
  (`1 234 567$88 US$ dólares dos Estados Unidos`); ducat-format writes TR35's
  `1 234 567$88 dólares dos Estados Unidos`, and ducat's TypeScript is to follow.

The files are under the Unicode License v3 (`../cldr/LICENSE`; see also `NOTICE`).
