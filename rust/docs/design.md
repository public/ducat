# ducat-rs: design

A Rust port of [@ducatjs/money](https://github.com/public/ducat). It's idiomatic Rust with ducat's feature set,
verified against ducat's language-neutral conformance suite (`@ducatjs/money-spec`, in ducat's `spec/`).

Status: milestones 1 to 3 (the core, allocation and cash, tax, `Fixed`, `ExactMoney` and `Rate`) and milestone 4
(`finance`, and `excel` for the functions named after Excel's, as in ducat).

Milestone 5a added rounding policies (`RoundingPolicy`, accepted wherever a mode is, as `impl Into<RoundingInput>`),
pricing, tiers and math, with their vectors in `spec/`.

Milestone 5b added the currency data (numeric codes, historic codes, territories, crypto units, CLDR's cash
rules and `cash_policy`), generated from `data/` by `tests/currency_data.rs` with a drift check, as for ISO. The
ISO exponent, CLDR's display digits and the cash rules stay separate figures.

Milestone 5c added the payment processors, one feature and module each under `ducat::processors`, with their
tables generated from `data/` by `tests/processor_tables.rs` with a drift check. Integer amounts are `i64`, refused
beyond 2^53 − 1 on the way to the processor as in ducat, and read back whatever their size (ducat refuses only
unsafe JavaScript numbers there, and reads any `bigint`); the `from_*` constructors take a `CurrencyCode`, so only the `&str` lookups are
case-insensitive (Adyen's excepted).

Milestone 5d1 extended `ducat::convert` to ducat's rates, providers and bags, still under the `convert` feature
(ducat ships the bag in its convert entry):
- **Times:** `Time` is a UTC day or a `UtcInstant` (UTC, to the millisecond), both `Copy`, on the crate-level `Date`
  that `finance` and `convert` share. A date is the start of its day as an `as_of`, an `available_at` or a lookup
  time, and the whole day as a `valid_until` (through 23:59:59.999Z). Parsing is strict: `YYYY-MM-DD`, or
  `YYYY-MM-DDTHH:MM[:SS[.sss]]` with `Z` or `±HH:MM`. ducat reads times with `new Date`, which also takes
  offset-less local times, `T24:00`, impossible dates and more; that is a deliberate divergence until ducat
  tightens it ([#349](https://github.com/public/ducat/issues/349)).
- **No clock:** `is_expired(now)`, `is_available(at)` and strict validity (`ConvertOptions::valid_at`, ducat's
  `strictValidity`) take the time as an argument, so the library stays `no_std` and deterministic.
- **Rates:** `Rate<F, T>` wraps an `AnyRate`, which holds the metadata (`RateInfo`: source, timing, `RateType`,
  `RateQuote`) and `derived_from`. Derived rates follow ducat's rules for what they keep. A quote must describe its
  rate exactly (ducat #351), so `inverse()` stays infallible. Equality is by value; metadata isn't compared.
- **Rate text** now matches ducat's, a change from milestone 4: a decimal keeps its published digits only when its
  canonical form would drop trailing zeros (`1.10`), so `01.50` prints as `1.5`, and a rounded rate prints as its
  exact decimal (`1.10` rounded to 2 places is `1.1`).
- **Providers:** `RateProvider::rate(from, to, &RateQuery) -> Option<AnyRate>` takes `CurrencyCode`s, so a provider
  can be a trait object and `chain` can mix kinds as `BoxedProvider`s; `rate_of` and `Rate::lookup` are the
  lookups that must succeed (`Error::RateUnavailable`). `RateTable` (a base with a builder, or a list), `identity`,
  `reversed`, `via` and `from_fn` are the providers; `convert_through` on `Money` and `AnyMoney` converts through
  one.
- **Bags:** `MoneyBag` holds `AnyMoney` totals in first-seen order, with `exact_total`, `total` (rounded once),
  `sum_by_currency`, `comparator` and `sort_by_value`. ducat installs no bag methods on money, and neither does the
  port.
- **JSON:** under `serde`, rates serialize in ducat's `RateJSON` shape and order, and deserialize as `rateFromJSON`.
- **Left out:** `snapshots` and `snapshotsFrom`, which load tables asynchronously, and the rate-source parsers
  (milestone 5d2).

Milestone 5d2 ported the rate-source parsers, one feature each (`ecb`, `boc`, `fed`, `boe`, `hmrc`, `history`,
`stripe-fx`, `adyen-fx`), under `ducat::convert`. They take `&str`, never fetch, return `Error::MalformedRates`
(ducat's `SyntaxError`) for a file they can't read, and give `RateTable`s with the metadata ducat attaches. The
fixtures live in `spec/fixtures/`, shared with ducat's tests, and `spec/vectors/convert/sources.json` checks both.
- **Publication times without time-zone data:** the ECB's 16:00 in Frankfurt and the Bank of Canada's 16:30 in Toronto
  use the EU rule (since 1996) and the North American one (since 2007) written out, which agree with tzdata for
  1999 to 2039; ducat reads them from `Intl`. `Publication` is `Unknown`, `Stated` or `Given(&dyn Fn(Date) -> Time)`,
  ducat's `false`, `true` and function.
- **Currency codes** in files are ISO 4217 codes or withdrawn ones (`CurrencyCode::historic`: CYP, VEB…). Any other
  code is skipped and listed in the table's `unknown()`, so a code new to ISO 4217 in a feed doesn't fail every parse
  that day; ducat keeps such a code as a currency of its own (it takes any string).
- **The ECB's XML** follows the Cube elements' nesting, as ducat does since #354: a day ends at its own closing tag,
  inner cubes may be self-closing or explicitly closed, and a self-closing `<Cube time='…'/>` isn't a day.
- **Decimals** a source is said to publish are 0 to 30, as ducat's `withDecimals` allows (`Error::InvalidDecimals`).
- **A small JSON reader** for Valet (no dependency): depth-limited, last repeated key wins in the first one's place,
  as `JSON.parse`.
- **Stripe's `exchange_rate`** is passed as the JSON number's text, not a float, so the library reads no float; it is
  read as ducat reads the number (at most 15 significant digits unless a safe integer).
- **Years 0 to 99** are refused in file dates, as ducat's `Date.UTC` check refuses them.
- **Left out:** Adyen's IANA `timeZone` option (it needs time-zone data; the TimeZone column's abbreviations and
  offsets are read), and `src/fetch.ts`.

Milestone 5e added `ducat::wire` (the default `wire` feature): `GoogleMoney`, `Iso20022Amount`, `MinorUnitAmount`
and `DineroObject`, plain structs with conversions to and from `Money` and `AnyMoney`, and with `serde` each in its
format's JSON shape. Malformed input is an error, never a rounding (`Error::InvalidWire`, `Error::Syntax` for ISO
20022 text). The readers take what the specs allow, as ducat does since #356: ProtoJSON's numbers or strings for
`units` and `nanos`, exponent form included, and `xs:decimal`'s leading sign and `-0`. ducat's rule that a `units`
*number* past 2^53 − 1 is refused is JavaScript's: serde reads JSON integers without loss, so the port has no such
rule. ISO 20022 has no XML in ducat (an amount is its attribute and text), so none here either.

Milestone 6a added amounts and numbers in words, in their own crate, `ducat-words`, so a program that wants only words
never pulls in format and parse data (milestone 6c's `ducat-format`). It is ducat's own RBNF interpreter
over CLDR's rule text (`data/rbnf/*.txt`, CLDR 49, embedded by `tests/rules.rs` with a drift check, without its comment
lines as ducat's generator drops them), one feature per language: `en` (4,081 bytes of rules), `de` (8,506), `fr`
(4,312), `es` (5,829), `it` (11,871), `nl` (2,284), `pt` (4,676), about 41 KB in all, so every language is a default. Values are `i128` within ±(2^63 − 1), ICU's range;
recursion is bounded, so adversarial rule text is an error, not a stack overflow. Plural rules (cardinal and ordinal),
the digit grouping of numbers the rules write as digits (separator and minimum grouping digits), and the word for "and"
come from the CLDR 48 snapshot (`data/cldr/`), generated into `src/cldr.rs` by `tests/cldr.rs` with a drift check, as the
rule text is; ducat reads them from `Intl`, CLDR 48 on Node 24. The rule text is CLDR 49 and these values
CLDR 48, the release ducat's `Intl` carries. `amount_in_words` takes the currency's names from the caller, as both take the minor unit's.

**Currency names diverge here.** ducat's `amountInWords` takes the currency's name, its plural form and its place next to
the number from the runtime's `Intl` (a currency format with `currencyDisplay: 'name'`, its digits replaced by the
words), so the text follows that runtime's CLDR data and build: ICU 78.3 puts U+00A0 before a name in fr-CA, Deno
2.9.8's data a space (spec/README.md, "Runtime divergences"). `ducat-words` has no `Intl`: the caller passes the
names (`UnitNames`: `other`, with `one` and `many` where they differ), they follow the number after a plain space, and the plural category comes from
CLDR 48's rules (`src/cldr.rs`). For the seven languages CLDR 48's `unitPattern` is `{0} {1}` with a plain space, so the
two agree when the caller passes CLDR's names. They differ where the caller's names aren't CLDR's, where a runtime's
data isn't CLDR 48 (or isn't ICU's build of it), and for `many` (a million euros in es, fr, it, pt): CLDR has no
`many` name for most currencies, and `Intl` falls back to `other`, as `UnitNames` does without `many`. The snapshot
in `data/cldr/` carries CLDR's names (`main/<locale>/currencies.json`), so a later milestone can offer them as
defaults; until then they are the caller's, and the words vectors (`words.spellOut`) don't cover names. The core runner delegates `words.spellOut` to `ducat-words`' own spec test, which reads the same files
and runs every row; the MSRV is the core's, 1.85.

Milestone 6c added locale formatting and parsing, in their own crate, `ducat-format`, from CLDR 48's data and ducat's own
code, with no ICU. ICU4X was the plan; ducat chose otherwise because no ICU4X release carries CLDR 48.0 throughout
(`icu_decimal_data` 2.1.1 has 48.0, but `icu_experimental_data` only 48.1, 48.2.x and 49), and its currency formatter
is pre-1.0 experimental and re-rounds to CLDR's digits. ducat's TypeScript formats through the runtime's `Intl`, whose
ICU 78.3 carries CLDR 48, so the crate follows that release and ICU's shipped differences from it:

- **Data:** `tests/data.rs` generates `src/data.rs` (numbers, currency symbols, names and formats, unit patterns,
  plural rules, parents, default content and likely scripts of the 430 modern-coverage locales) and `src/icu.rs`
  (ICU 78.3's overrides: fr-CH's group, my's unit pattern) from `data/cldr/` and `data/icu/`, with a drift check, and
  the Cargo feature per language. `data/cldr/README.md` has the one regeneration that updates the spec, `ducat-words`
  and `ducat-format` together.
- **Engine:** a TR35 pattern parser and formatter over ducat's rounding (`to_scale`, no floats): every display and
  sign, `digits` and `rounding`, `Intl`'s fraction and significant digits and rounding increment, currency spacing,
  names by plural rule, and parts; `parse` and `parse_money` as ducat's. Input is bounded (`MAX_INPUT`, 1,024 bytes;
  patterns 256 characters) and nothing recurses.
- **ICU's data followed, not its code bugs:** a currency's own format (EUR in en-150, PTE in pt-PT) is used for every
  sign with a symbol, narrow symbol or code, with the separators of the locale that defines it, and the format of a
  locale's region's currency for currencies without one (en-NL writes USD as `US$1,234.50`), as ICU's data and symbols
  have it (`data/icu/README.md`). A name follows TR35 everywhere, by ducat's decision: the number, with the separators
  and grouping the symbol form uses for that currency in that locale, so `parse` reads it back, and no symbol, in the
  unit pattern with the plural name (`1,234.50 euros` in en-150, `1,234.567 Kuwaiti dinars` and `1,234.50 euros` in
  en-NL, `1.234,50 euros` in en-AT); never the currency's own pattern or symbol, which ICU's code puts there and
  garbles at other scales (`KWD 1,234.56 Kuwaiti dinars7` on Node 24); ducat's TypeScript is to match (ducat#363).
- **Conformance:** the core runner delegates `format.money`, `parse.money` and `parse.detect` to `ducat-format`'s own
  spec test (2,538, 1,629 and 1,757 rows, all passing, the icu-overrides files included). Its proptests round-trip
  format and parse in every built locale and feed arbitrary tags, options, amounts and text to the public API.

### Coverage

The crate has the locales CLDR rates modern: 430 (root, `und`, included) in 101 languages, a feature each (`full`
for all); `hi` also needs `en` (hi-Latn inherits en-IN), `ht` needs `fr`, `nb` and `nn` need `no`. The default set is
31 languages, 313 locales: those of ducat's vectors (ar, da, de, en, es, fa, fr, hi, it, ja, nl, pt, ru, sv, sw, th)
and the most spoken others (bn, fil, he, id, ko, mr, ms, pl, ta, te, tr, uk, ur, vi, zh). In a stripped release
binary the data costs about 1.15 MB for the default set and 3.25 MB for `full` (`examples/locales.rs`, which links
every built locale); root alone is nearly nothing. CI builds and tests root only and `en` only.

**The one difference from ducat's TypeScript:** Rust's set of locales is fixed when the crate is built; TypeScript
formats any locale its runtime's `Intl` knows. A tag the build lacks falls back by TR35 (dropping subtags down to
root): it still formats, and `Locale::has_data` is false, so parsing refuses it, as ducat refuses a locale `Intl` has
no data for.

A tag is resolved through CLDR's likely scripts first, so a region that writes another script finds that script's
locale. What Node 24 (ICU 78.3) and `ducat-format` resolve, checked in `tests/locale.rs` and `tests/runtime.rs`:

| tag | Node 24 | ducat-format data | has data | |
|---|---|---|---|---|
| `zh-TW` | zh-TW, Traditional (`2.00 歐元`) | `zh-Hant` | yes | same text |
| `zh-HK` | zh-HK, Traditional | `zh-Hant-HK` | yes | same text |
| `zh-CN` | zh-CN, Simplified | `zh-Hans` | yes | |
| `sr-Latn-RS` | sr-Latn-RS, Latin (`2,00 evra`) | `sr-Latn` | yes | same text |
| `sr-ME` | sr-ME, Latin | `sr-Latn-ME` | yes | same text |
| `en-Latn-US` | en | `en` | no | ducat's TypeScript refuses it for parsing too |
| `pa-PK` | pa-PK, Arabic script | `pa` (Gurmukhi) | no | pa-Arab isn't modern coverage |
| `uz-Arab`, `uz-AF` | uz-Arab, Arabic script | `uz` (Latin) | no | uz-Arab isn't modern coverage |

`Intl`'s fraction and significant digits and rounding increment round the decimal here, exactly, with ducat's rounding
kernel. Other known differences from ducat's TypeScript on Node, none of them in a vector: letters around a number are
Rust's `Alphabetic`, which takes some
combining vowel signs `\p{L}` doesn't; the four modern locales ICU doesn't ship (be-tarask, ca-ES-valencia, el-polyton,
ht) and nb-SJ have CLDR's data here, where `Intl` falls back; and sr-Cyrl-ME's currency names are CLDR's Cyrillic
ones, not ICU's Latin. As in ducat since ducat#364, `parse` takes the expected currency's own code, symbol, narrow
symbol and long names (from the CLDR tables) as a whole beside the number, whatever their characters, and they add no
sign: PEN's `S/` in es-PE and CLF's `Chilean units of account (UF)` read back exactly, and anything else around the number
is still refused. It also takes a long name's number grouped in the decimal pattern, as `Intl` writes it (lakhs in ml, mr
and or).

Known gaps, to close later:
- `snapshots` and `snapshotsFrom` (asynchronous loaders), and Adyen's IANA time zones.

The decisions in "Choices that are expensive to reverse" are the coordinator's, flagged to Alex for review.

## Goals
- **The same answers as ducat,** checked by running ducat's conformance vectors, pinned to a ducat commit. The suite's
  implemented/skipped counts per operation are the measurable definition of "the feature set".
- **Idiomatic Rust,** not transliterated TypeScript:
  - `Result` for anything that can fail;
  - types that make mixing currencies a compile error where the currency is known;
  - `Copy` values, `Display`/`FromStr`, `serde` behind a feature, iterators, and no global state.
- **Exactness:** no floats in arithmetic, ever. Every rounding is explicit, as in ducat.

## Non-goals and rules
- **No inherited claims.** ducat's speed, size and Lean-proof claims are about ducat. ducat-rs claims only what it
  measures or proves itself. Its README says "verified against ducat's conformance suite", nothing more.
- **Spec fixes go to the spec.** A problem found while porting is fixed in `spec/` (or in ducat's TypeScript), with a
  reproduction, never by special-casing the Rust runner. A vector that looks wrong is raised with the coordinator first.
- **Data is generated from ducat's `data/`** (ISO 4217, CLDR cash data, processor tables), not from ducat's generated
  TypeScript.

## Choices that are expensive to reverse
1. **Amounts are integers of any size at an explicit scale, as in ducat** (Alex, 2026-11-14, replacing the first
   draft's `i128`-only rule).
   - `ducat::Int` holds a value inline as an `i128` while it fits, with machine arithmetic, and moves it to the heap
     (num-bigint, private behind `Int`) only when it doesn't, moving it back as soon as it fits again. The
     representation is canonical, so derived equality and hashing stay structural. This is ducat's
     number-then-bigint switch.
   - Amounts, `Ratio` numerators and denominators, and allocation weights are all unbounded. Only the scale and a
     decimal string's exponent are capped, at 1000, as in ducat.
   - There is no digit cap on input, matching ducat. The cost of parsing, formatting and arithmetic grows with the
     number of digits, so callers taking untrusted input bound its length; `FromStr` and `parse_at` say so, and a
     test parses, prints and round-trips 100,000 digits.
   - Money can't be `Copy` with a heap case, so `Money<C>` and `AnyMoney` are `Clone`, methods take `&self`, and the
     operators work on references as well as values.
2. **Currencies are typed where they're known, and dynamic where they aren't.** This mirrors ducat's
   `Money<'EUR'>` against `Money<string>`.
   - `Money<C: Currency>` uses a zero-sized marker type per ISO code (`ducat::iso::Eur`, generated from ISO 4217).
     Its arithmetic implements `Add`, `Sub` and `Neg`, which can't fail on currency.
   - `AnyMoney` has a runtime `CurrencyCode`, for values from databases, JSON and user input. Its arithmetic returns
     `Result<_, Error::CurrencyMismatch>`.
   - `AnyMoney::try_into::<Money<Eur>>()` narrows, like `assertCurrency`.
   - Custom currencies (`define_currency`) work at run time through `AnyMoney`, or as user-defined marker types.
3. **Fallible operations return `Result`.** Operator traits are implemented only where nothing can fail: typed
   add, sub and neg (and `Sum`), which can't overflow now that amounts are unbounded. `AnyMoney`'s `checked_add` and
   `checked_sub` return `Result` for a currency mismatch. Multiply, divide, allocate, convert and parse return
   `Result`.
4. **Rounding is an argument, never ambient:** `Rounding` is an enum of ducat's nine modes, with Intl's names
   (`HalfExpand`, `HalfEven`, …), plus `Unnecessary`, which errors instead of rounding. ducat's rounding policies
   (scale, increment, mode) are a `RoundingPolicy` value.
5. **Factors are exact rationals** (`Ratio`: a reduced numerator and denominator of any size), built
   from integers, decimal strings and ducat's binary64 rule for floats (`Ratio::try_from(f64)` uses the shortest
   round-trip form, and refuses more than 15 significant digits).
6. **MSRV and edition:** Rust 1.85, edition 2024.
   - The core is `no_std + alloc` (formatting and I/O behind `std`).
   - The default features are `std`, `iso` and `serde`.
7. **Layout:** a cargo workspace.
   - `ducat` holds core, allocate, tax, math, convert (rates and providers, without fetchers), cash, policy, pricing,
     exact, fixed, finance, excel and the processors, each behind a feature.
   - Separate crates hold heavy or optional data and dependencies: `ducat-words` (amounts in words), `ducat-format`
     (format and parse, on CLDR's data), `ducat-sqlx`, `ducat-diesel` and `ducat-fetch` (rate fetchers, on reqwest).
8. **The licence is MIT,** as ducat's is.

## Decisions made while building milestone 1
Agreed with the coordinator on 2026-11-14. The port moved into ducat's repository the same day (see "Where it
lives").

1. **Equality is by value; `identical` also checks the scale** (Alex, 2026-11-14, reversing a first rule that made
   `==` structural).
   - `PartialEq`, `Eq`, `Hash` and (for `Money<C>`) `Ord` compare by value, as ducat's `equals` and `compare`: 1.0
     EUR at scale 1 is `==` to 1.00 EUR, and they are one `HashMap` or `BTreeMap` key, with the representation
     inserted first kept. `Hash` uses the value at its smallest exact scale, so it agrees with `==` across scales
     and across the inline and heap representations; a proptest checks it, and a test checks 1 against 10^1000 at
     scale 1000.
   - `identical` compares amount, currency and scale, as ducat's `identical`, for round-trip tests. The conformance
     runner judges by the spec's written `{amount, currency, scale}`, so it is unaffected.
   - `AnyMoney` in different currencies is never `==`, and has no `Ord`; its `compare` returns a currency-mismatch
     error, as ducat's does.
2. **Currencies carry their exponent; there is no registry.**
   - `CurrencyCode` holds the code and its exponent. `FromStr` and `CurrencyCode::iso` accept only ISO 4217 List One
     codes with a minor unit (a typo is an error; XAU and the other "N.A." codes have no exponent).
   - `CurrencyCode::custom("BTC", 8)` replaces ducat's `defineCurrency`: 1 to 12 ASCII letters and digits, exponent
     at most 30, never an ISO code. `define_currency!` makes a marker type for one, checked at compile time.
   - Currency equality is code plus exponent, never display data.
   - Exponents come from ISO 4217 List One only. CLDR display digits and cash rules are separate figures, added
     with milestone 5, and never change an amount's scale.
3. **serde writes the value's own scale and reads at the currency's exponent.**
   - The one format is ducat's: `{"amount":"12.34","currency":"EUR"}`, the amount a string. Alternatives will only
     ever be `#[serde(with = …)]` modules, never cargo features.
   - Serialize writes the exact amount at the value's scale. Deserialize reads it as `FromStr` does, at the
     currency's exponent with no rounding, as ducat's `fromJSON`. So 12.340 EUR (scale 3) reads back as 12.34 EUR,
     and 1.005 EUR (scale 3) fails on the way back in rather than losing a digit. That asymmetry is deliberate and
     documented on the impls. Where the spec gets JSON vectors, they decide.
   - Only ISO codes deserialize, since a custom currency's exponent isn't in the JSON.
4. **No default rounding.** ducat defaults arithmetic to `halfExpand`; ducat-rs requires a `Rounding` on every
   operation that may round, and parsing never rounds unless asked to (`parse_at` with a mode).
5. **Display is exact.** `"12.34 EUR"`, never an exponent, never `-0` (an integer has no negative zero). Format flags
   such as `{:.1}` are ignored rather than rounding or truncating: round explicitly with `to_scale` first. Tested.
6. **Typed `+`, `-` and unary `-` never overflow** (they panicked on `i128` overflow before amounts became
   unbounded). `Error::Overflow` is left only for narrowing: an `Int` into a machine integer, or a count of parts
   beyond what can be held.
7. **Boundaries are strict and never panic.** Parsing, serde and (later) the database decoders return errors for
   excess precision, NaN and the infinities, and out-of-range values. No `f64` is used in arithmetic, and a float is
   never a `Factor`. Floats come in only through explicit conversions, under ducat's binary64 rule (the shortest
   round-trip form; more than 15 significant digits is refused unless the value is a safe integer or a rounding is
   given): `Ratio::try_from(f64)`, and `from_f64`/`from_f64_at` on the money types. The money constructors exist
   because the spec's `money.fromBinary64` vectors check the order of the two errors: the rounding check comes
   first, so `0.1 + 0.2` in EUR is a rounding error, as in ducat, which a `Ratio` can't express.
8. **One rounding kernel, two paths.** Every multiply, divide, convert and rescale rounds once, through one private
   kernel. When the operands fit `i128` it forms `units × numerator × 10^k` in 256 bits; when they don't, or the
   result doesn't fit, it computes the same quotient in arbitrary precision. Differential proptests check the two
   paths against each other and against num-bigint around the boundaries (±`i128::MAX`, `i128::MIN`, and products
   just past them).
9. **The ISO table is committed generated code.** `tests/iso_table.rs` is the generator (it reads the repository's
   `data/iso4217-list-one.xml`) and fails when `src/iso_table.rs` is stale; `DUCAT_REGENERATE=1` rewrites it.
10. **Features:** `std`, `iso` (the marker types; the ISO table itself is always present, since `CurrencyCode`
    parsing needs it) and `serde`, all default.
11. **Dependencies:** num-bigint, num-integer and num-traits (without default features, so the core stays
    `no_std + alloc`), for amounts beyond `i128`; serde, optional. For tests, `serde_json` (reading the vectors) and
    `proptest`. The
    runner checks the vector files' structure by hand rather than with a JSON Schema crate. proptest needs Rust
    1.88, so the 1.85 MSRV applies to the library, not its tests.

## Mapping ducat's entries
| ducat entry | ducat-rs | notes |
|---|---|---|
| `.` (core), `/fn` | `ducat` core: `Money`, `AnyMoney`, methods plus free functions where natural | Rust doesn't need ducat's /fn split: unused methods cost nothing |
| `/iso`, `/iso/*`, `/currencies`, `/territories`, `/historic` | `ducat::iso` (markers plus the table), `currencies`, `territories`, `historic` features | static tables, no registration step |
| `/allocate` | `allocate` (allocate, split, instalments, schedule, chunk) | the Lean vectors apply |
| `/tax`, `/math`, `/exact`, `/policy`, `/pricing`, `/cash` | features of the same names | `cash::cldr_cash` is Rust-only (no ducat equivalent; the spec checks it against `data/` only) |
| `/fixed`, `/fixed/money` | `ducat::fixed::Fixed` | |
| `/finance`, `/excel` | `finance`, `excel` | the Excel rule applies to `excel` |
| `/convert`, `/convert/{ecb,boc,fed,boe,hmrc,history}`, `/stripe-fx`, `/adyen-fx` | `convert` plus parsers | rates with metadata, providers and `MoneyBag` in `convert` (5d1); the parsers, a feature each, take text and never fetch (5d2) |
| `/convert/fetch` | `ducat-fetch` | network code only here |
| `/stripe`, `/adyen`, `/checkout`, `/paypal`, `/braintree`, `/klarna` | `processors::{stripe,…}`, a feature each | conversions are methods on `Money` and `AnyMoney`; the FX files are M5d |
| `/wire` | `wire` (google.type.Money, ISO 20022, minor units, dinero objects) | ported in 5e |
| `/words/*` | `ducat-words` (6a) | its own interpreter, no ICU |
| `/format`, `/parse` | `ducat-format` (6c) | CLDR 48's data with ICU 78.3's overrides, no ICU; a feature per language |
| `currencyName`, `currencySymbol` | `ducat-format` (6c) | from CLDR, as `currency_name` and `currency_symbol` |
| `/context` | not ported | `Money<Eur>` already binds a currency; a locale goes to the formatter |
| `/zod`, `/valibot` | not ported | TypeScript schema libraries; `serde` covers validation |
| `/prisma`, `/drizzle/*`, `/kysely`, `/typeorm`, `/pg` | `ducat-sqlx`, `ducat-diesel` | Postgres numeric and bigint, plus the composite type |
| `/testing`, `/testing/{vitest,jest,arbitraries}` | a `proptest` feature: `Arbitrary` strategies and assertion helpers | |
| `/all`, plugins, `extendMoney` | not ported | Rust uses extension traits; there's no prototype to install on |

## Where it lives, and the conformance runner
- **In ducat's repository,** as `rust/` (a cargo workspace), beside `proofs/` and `compare/`. The runner reads `spec/`
  and `data/` from the same checkout, so the Rust port always runs the spec at its own commit: a spec change and the
  Rust change it needs land in one pull request, and there is no vendored copy to drift. `rust/` is not part of the
  npm package.
- **The runner:** `rust/crates/ducat/tests/spec.rs` maps each neutral operation to the Rust API. It runs every vector
  it knows, and fails on an unknown operation unless that operation is listed as "not yet". It prints implemented,
  skipped (with the reason) and failed counts per operation and area, checks each file's structure, checks the
  number of cases per area (so a lost file fails), and changes one expectation per implemented operation to show
  the judgement can fail. Nothing is skipped for size.
- **The judgement rules come from `spec/README.md`:** Money compares amount, currency and scale; the tables carry their
  own rules (15 significant digits, bounds, exact).

## Milestones, in order of vector coverage
1. **Scaffold:** this design doc, the runner, and the core battery (core, rounding, convert, battery.json).
2. **Arithmetic:** allocate, schedule, instalments and chunk (the Lean vectors), and cash increments.
3. **Tax and convert** (the pydecimal vectors), exact and fixed (the fixed battery).
4. **Excel and finance:** the fractions, Calc, Microsoft and Lean xnpv/xirr vectors.
5. **Currency data:** ISO, historic, territories, cash rules and processors. Vectors mostly don't exist yet, so add
   them to ducat's spec first, from an independent source.
6. **Words, format and parse:** `ducat-words` (6a, RBNF) and `ducat-format` (6c, format and parse), both ducat-rs's own
   code over CLDR's data, with no ICU. ICU4X was the plan, but no release carries CLDR 48.0 throughout and its currency
   formatter is experimental and re-rounds to CLDR digits (wrong for HUF, IDR, IQD and MGA at ISO scale); the format
   and parse vectors came with ducat#337. Both keep the core's MSRV, 1.85.
7. **Integrations:** `ducat-sqlx`, `ducat-diesel`, `ducat-fetch` and `proptest`.
8. **Fuzzing** of every boundary (parsing, serde, database decoding, `Ratio`) with `cargo fuzz`.

Allocation (milestone 2) takes its remainder strategy as an argument, as ducat does, with conservation property tests
on both sides of the `i128` boundary; sub-minor fractions follow the spec's vectors, never silently floored.

The research in `docs/research/rust-money-libs.md` (section 6.1) lists 24 bug classes from other Rust libraries. Each
becomes a regression test with the milestone it belongs to (T5, T7, T8, T10–T14, T16, T18–T21 and T23 with
milestone 1).

## Working rules
- Conventional Commits, and no AI attribution in commits or PRs (ducat's rule).
- Pull requests to ducat's repository, titled as Conventional Commits with the `rust` scope.
- `CARGO_BUILD_JOBS=1` locally, with one shared `CARGO_TARGET_DIR`. CI runs the full matrix
  (stable, MSRV, `no_std`, every feature).
