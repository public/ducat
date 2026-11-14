# ducat-rs: design

A Rust port of [@ducatjs/money](https://github.com/public/ducat). It's idiomatic Rust with ducat's feature set,
verified against ducat's language-neutral conformance suite (`@ducatjs/money-spec`, in ducat's `spec/`).

Status: milestones 1 to 3 (the core, allocation and cash, tax, `Fixed`, `ExactMoney` and `Rate`) and milestone 4's
`finance`, with `excel` holding Excel's NPV and IRR so far (Excel-named functions live there, as in ducat). The rate-source
parsers (ECB, BoC, Fed, BoE, HMRC, history, Stripe and Adyen FX) move to milestone 5, with the processors. Rate
providers (tables, chains, `via`) and rate metadata (dates, validity) come with them. The decisions in "Choices that are expensive to reverse" are the coordinator's,
flagged to Alex for review.

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
   - Separate crates hold heavy or optional dependencies: `ducat-icu` (format, parse and words, on ICU4X), `ducat-sqlx`,
     `ducat-diesel` and `ducat-fetch` (rate fetchers, on reqwest).
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
| `/tax`, `/math`, `/exact`, `/policy`, `/pricing`, `/cash` | features of the same names | |
| `/fixed`, `/fixed/money` | `ducat::fixed::Fixed` | |
| `/finance`, `/excel` | `finance`, `excel` | the Excel rule applies to `excel` |
| `/convert`, `/convert/{ecb,boc,fed,boe,hmrc,history}`, `/stripe-fx`, `/adyen-fx` | `convert` plus parsers | the parsers take text and never fetch |
| `/convert/fetch` | `ducat-fetch` | network code only here |
| `/stripe`, `/adyen`, `/checkout`, `/paypal`, `/braintree`, `/klarna` | `processors::{stripe,…}` | |
| `/wire` | `wire` (google.type.Money, ISO 20022, dinero objects) | |
| `/format`, `/parse`, `/words/*` | `ducat-icu` | first check what ICU4X offers for currency formatting; RBNF is an interpreter over CLDR rules, as ducat's is |
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
6. **`ducat-icu`:** format, parse and words. It depends on ducat#337 for format and parse vectors; the RBNF vectors
   exist.
   - Build on ICU4X's `DecimalFormatter`, with ducat's own rounding, not on its currency formatter, which re-rounds
     to CLDR digits (wrong for HUF, IDR, IQD and MGA at ISO scale). Pin `icu_experimental` exactly if it's used at all.
   - Its own MSRV (1.88 or later, as ICU4X 2.x needs); the core stays on 1.85.
   - Parsing and RBNF are ducat-rs's own code: ICU4X has neither.
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
