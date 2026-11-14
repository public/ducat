# ICU 78.3 overrides

ICU's locale data where it deliberately overrides CLDR's, for the ICU-overrides vectors
(`spec/vectors/format/icu-overrides.json`, `spec/vectors/parse/icu-overrides.json`), which
`scripts/gen-format-vectors.py` computes from the CLDR 48 snapshot in `data/cldr/` with these
values applied, and for ducat-format's `src/icu.rs` (`rust/crates/ducat-format/tests/data.rs`).
ducat's TypeScript doesn't read it, and the npm package leaves it out.

- `fr_CH.txt`: https://raw.githubusercontent.com/unicode-org/icu/release-78.3/icu4c/source/data/locales/fr_CH.txt
  (tag `release-78.3`), sha256 `ffb73f672e4bb219dbbdeacf25d98bfafc1f30f85003dc90725556f5cc7b2ef8`,
  fetched 2026-11-14, unchanged. Lines 10-13 set `symbols{ currencyDecimal{"."} group{"'"} }`;
  CLDR 48's `common/main/fr_CH.xml` (unicode-org/cldr, tag `release-48`, lines 215-217) sets only
  `currencyDecimal`, so CLDR's fr-CH group is fr's U+202F.

The generator reads only the `NumberElements` symbols of these files. To find the overrides, ICU
78.3's locale files for every locale tag the vectors use, and their parent chains (root, en,
en_001, es_419 and the rest), were compared with CLDR 48: number symbols (decimal, group, minus
and plus signs, currency decimal and group), minimum grouping digits, the default numbering
system, and the decimal, currency and accounting patterns with their `alphaNextToNumber` and
`noCurrency` forms. fr_CH's group was the one value that differs. Some locales' ICU files lack
an `alphaNextToNumber` or `noCurrency` accounting pattern, or fa's `arabext` accounting pattern,
that CLDR's resolved JSON has; ICU falls back for those, and every vector agrees with ICU's
output there. ICU's `curr/` data (currency symbols, names and spacing) wasn't compared.

The file is under the Unicode License v3 (`../cldr/LICENSE`; see also `NOTICE`).
