# Rust money and decimal libraries: research for ducat-rs

Research for the questions in [`docs/design.md`](../design.md): i128 minor units at an explicit scale, typed `Money<C>`
against runtime `AnyMoney`, `Result` for fallible operations, rounding modes, allocation, exact rationals, ICU4X
formatting, serde, sqlx/diesel.

- **Date:** 2026-11-14.
- **Sources:**
  - crates.io API (`/api/v1/crates/<name>` and `/versions`);
  - the published crate sources at the versions named below;
  - every issue tracker, read with `gh`;
  - a small reproduction crate (see [Appendix A](#appendix-a-reproductions)).
- **How issues are reported:**
  - **"Fixed"** means a linked merged PR, a release note, or our own run. An issue's closed state alone is not enough:
    rusty-money bulk-closed issues on 2026-01-12 and 2026-02-13, some of them unfixed.
  - **Reproductions** are quoted from the issue, unless they are marked *(our run)*.
- **Source links** go to the release tag on GitHub, or to docs.rs source where there is no tag. Line numbers are for
  that version.

## Key findings
1. **No Rust crate has the combination ducat-rs proposes:** typed and dynamic currencies, integer minor units,
   `Result` arithmetic, full rounding modes and allocation strategies.
   - The only adopted money crate, rusty-money (221k downloads in 90 days), stores a `rust_decimal` amount and checks
     currencies at run time.
   - It dropped operator traits for `Result` methods ([PR #119](https://github.com/varunsrin/rusty_money/pull/119)).
   - Its most requested feature is dynamic money ([#66](https://github.com/varunsrin/rusty_money/issues/66)).
2. **Currency exponents differ between ISO and CLDR, and the Rust crates disagree with each other.**
   - rusty-money 0.5.1 has HUF 0 and MGA/MRU 1, where ISO says 2 ([PR #153](https://github.com/varunsrin/rusty_money/pull/153) is open).
   - CLDR 49 gives HUF, IDR, IQD and MGA 0 digits.
   - ICU4X's currency formatter rounds to the CLDR digits, half-expand, with no override.
3. **ICU4X covers part of what ducat-icu needs, not all of it.**
   - `DecimalFormatter` and fixed_decimal are stable, and fixed_decimal has exactly ducat's nine Intl rounding modes.
   - Currency formatting is experimental and breaks with every release.
   - There is no cash rounding, no localized parsing, and no RBNF ([#7803](https://github.com/unicode-org/icu4x/issues/7803) was closed as not planned).
   - The MSRV is 1.88.
4. **Decimal crates round silently** on underflow, in parsing, in serde and in DB decode (rust_decimal
   [#515](https://github.com/paupino/rust-decimal/issues/515), [#569](https://github.com/paupino/rust-decimal/issues/569);
   decimal-rs [#6](https://github.com/yashan-technologies/decimal-rs/issues/6); our runs in [A.2](#a2-rust_decimal-1430)).
5. **Default rounding is inconsistent and surprises users.** In rust_decimal, `round_dp` is half-even, division ties
   have no guaranteed rule and round up for wide divisors ([#843](https://github.com/paupino/rust-decimal/issues/843)), and `{:.2}` truncates
   ([#895](https://github.com/paupino/rust-decimal/issues/895)). bigdecimal and fastnum set their defaults through
   build-time environment variables.
6. **Serialization is the most bug-dense area.**
   - Global serde features are not additive (rust_decimal [#602](https://github.com/paupino/rust-decimal/issues/602), [#857](https://github.com/paupino/rust-decimal/issues/857); bigdecimal [#151](https://github.com/akubera/bigdecimal-rs/issues/151)).
   - primitive_fixed_point_decimal writes f64 to binary formats.
   - Scientific notation breaks round trips (fastnum [#70](https://github.com/neogenie/fastnum/issues/70)).
   - Invalid scales are accepted on deserialize.
7. **Postgres NUMERIC handling has a long history of bugs:** NaN becoming 0, panics, off-by-one-ulp decodes, lost
   scale (§5). One of them was reported as a DoS ([sqlx #3052](https://github.com/transact-rs/sqlx/issues/3052)).
8. **rusty-money's allocation has three problems.** It floors sub-minor amounts away, it gives the remainder by input
   order ([#103](https://github.com/varunsrin/rusty_money/issues/103), confirmed on 0.5.1), and it invented units at
   its limits ([PR #137](https://github.com/varunsrin/rusty_money/pull/137)).
9. **Equality, display and negative zero are inconsistent.** 1.0 and 1.00 are equal and hash equal, yet display and
   serialize differently. `-$0.00` still prints in rusty-money 0.5.1, although #79 is closed. rust_decimal and
   bigdecimal both have negative-zero bugs.
10. **Exact rationals and i128 rounding division are easy to get wrong.**
    - num-rational panics on intermediate overflow ([#117](https://github.com/rust-num/num-rational/issues/117), [#143](https://github.com/rust-num/num-rational/issues/143)).
    - It can't parse decimals ([#131](https://github.com/rust-num/num-rational/issues/131)).
    - primitive_fixed_point_decimal shipped three i128 rounding-division fixes.

## Contents
1. [Which libraries matter](#1-which-libraries-matter)
2. [Money crates](#2-money-crates): rusty-money, iso_currency, doubloon, moneta, currency_rs
3. [Decimal crates](#3-decimal-crates): rust_decimal, bigdecimal, fastnum, primitive_fixed_point_decimal, decimal-rs, dec, num-rational
4. [Formatting and locale data: ICU4X](#4-formatting-and-locale-data-icu4x)
5. [Database boundaries](#5-database-boundaries-sqlx-diesel-postgres)
6. [For ducat-rs](#6-for-ducat-rs): regression tests, design evidence, gaps
7. [Appendix A: reproductions](#appendix-a-reproductions)

---

## 1. Which libraries matter

The download figures are crates.io totals and "recent" downloads (the last 90 days), as of 2026-11-14.

| crate | role | downloads (all / 90 d) | latest release | licence | MSRV | verdict |
|---|---|---|---|---|---|---|
| [rust_decimal](https://github.com/paupino/rust-decimal) | 96-bit decimal | 176.2M / 44.8M | 1.43.0, 2026-09-02 | MIT | 1.67.1 | **Covered.** The default "money decimal" in Rust, and what rusty-money, doubloon and money2 are built on. |
| [bigdecimal](https://github.com/akubera/bigdecimal-rs) | arbitrary-precision decimal | 146.4M / 38.8M | 0.4.11, 2026-09-28 | MIT/Apache-2.0 | 1.43 (badge) | **Covered.** sqlx and diesel support it natively. |
| [fixed_decimal](https://github.com/unicode-org/icu4x/tree/icu%402.4.0/utils/fixed_decimal) / [icu_decimal](https://github.com/unicode-org/icu4x/tree/icu%402.4.0/components/decimal) | ICU4X formatting input / formatter | 18.5M / 8.0M; 18.2M / 7.9M | 0.7.3 / 2.4.0, 2026-10-22 | Unicode-3.0 | 1.82 / 1.88 | **Covered** (§4). |
| [fastnum](https://github.com/neogenie/fastnum) | fixed-width decimal, D64–D512 | 11.5M / 6.1M | 0.7.5, 2026-06-11 | MIT OR Apache-2.0 | 1.94 | **Covered.** Fast-growing; has sqlx and diesel features. |
| [icu_experimental](https://github.com/unicode-org/icu4x/tree/icu%402.4.0/components/experimental) | ICU4X currency formatting | 3.9M / 1.5M | 0.7.0, 2026-10-22 | Unicode-3.0 | 1.88 | **Covered** (§4). |
| [iso_currency](https://github.com/zbrox/iso_currency) | ISO 4217 enum | 2.7M / 724k | 0.7.1, 2026-09-06 | MIT | none | **Covered.** The most-downloaded currency table. |
| [decimal-rs](https://github.com/yashan-technologies/decimal-rs) | u128 decimal, 38 digits | 1.26M / 219k | 0.2.0, 2026-07-30 | Apache-2.0 | 1.87 | **Covered briefly.** Only 6 issues; it shows the silent-rounding policy. |
| [rusty-money](https://github.com/varunsrin/rusty_money) | money + currency | 1.10M / 221k | 0.5.1, 2026-09-25 | MIT | 1.85 | **Covered in depth.** The most-used money crate by a wide margin, and actively maintained again since 2026-01. |
| [dec](https://github.com/MaterializeInc/rust-dec) | libdecnumber bindings | 896k / 205k | 0.4.11, 2025-05-07 | Apache-2.0 | none | **Covered briefly.** Mostly Materialize's own use. |
| [primitive_fixed_point_decimal](https://github.com/WuBingzheng/primitive_fixed_point_decimal) | primitive integer at a fixed scale | 122k / 94k | 1.6.0, 2026-10-31 | MIT | none | **Covered.** The closest design to ducat-rs's i128-at-a-scale. |
| [num-rational](https://github.com/rust-num/num-rational) | `Ratio<T>` | 467.8M / 116.1M | 0.4.2, 2025-01-25 | MIT OR Apache-2.0 | 1.60 | **Covered** for design item 5, exact rationals. |
| [doubloon](https://github.com/davestearns/penny-for-your-thoughts) | typed + dynamic money | 3.5k / 124 | 3.2.0, 2026-06-30 | MIT | none | **Covered** as prior art for `Money<C>` against `AnyMoney`, not for its usage. |
| [moneta](https://github.com/mamrhein/money.rs) | money on fpdec | 13k / 98 | 0.7.1, 2026-07-31 | BSD-3-Clause | 1.81 | **Covered briefly** as a contrasting design (it panics and quantizes on every operation). |
| [currency_rs](https://github.com/Adel-ak/currency_rs) | currency.js port | 29k / 1.7k | 1.3.1, 2026-08-10 | non-standard | none | **Footgun note only:** amounts are `f64` ([src/currency.rs L7-L11](https://docs.rs/crate/currency_rs/1.3.1/source/src/currency.rs)). |
| steel-cent | i64 minor units | 92k / 387 | 0.2.3, **2019-07-12** | MIT/Apache-2.0 | none | **Excluded:** dead since 2019, and hosted on GitLab, so it has no GitHub tracker. |
| money2 | money with async FX | 29k / 134 | 1.4.0, 2023-11-04 | **GPL-3.0-only** | none | **Excluded:** unmaintained since 2023, and its GPL licence rules out reuse in an MIT crate. |
| currencies | currency marker types | 34k / 1.6k | 0.4.1, 2024-06-21 | MIT | none | **Excluded:** no release since 2024 and no issues to learn from. |
| money | — | 72 / 37 | 0.1.0 | — | — | **Excluded:** essentially unused. |
| decimal | decNumber bindings | 1.8M / 46k | 2.1.0, **2021-03-08** | Apache-2.0 | none | **Excluded:** unmaintained since 2021; `dec` supersedes it. |
| accounting | accounting.js port | 17k / 614 | 0.2.0, 2022-02-20 | — | none | **Excluded:** unmaintained, and formatting only. |

**Takeaways:**
- rusty-money is the only money type with real adoption, and it is two orders of magnitude smaller than the decimal
  crates. Most Rust code that handles money uses `rust_decimal` or `bigdecimal` directly, next to a currency code.
- `iso_currency` is used as a bare currency table about 2.5 times as much as rusty-money is used as a money type.

---

## 2. Money crates

### 2.1 rusty-money 0.5.1

**Features**

| aspect | rusty-money 0.5.1 | source |
|---|---|---|
| Representation | `Money<'a, T> { amount: rust_decimal::Decimal, currency: &'a T }`. `Copy`, `Hash`, derived `PartialEq`. Stored precision is independent of the currency exponent. | [money.rs L14-L25](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L14-L25) |
| Integer type | `FastMoney<'a, T>`, i64 minor units, behind the `fast` feature (added in 0.5.0, [PR #123](https://github.com/varunsrin/rusty_money/pull/123)). Fractional minor units can't be stored. | [fast_money.rs L7-L43](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/fast_money.rs#L7-L43) |
| Precision | Decimal's: 96-bit mantissa, scale ≤ 28. `from_minor` panics if exponent > 28; `try_from_minor` returns an error instead. | [money.rs L107-L135](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L107-L135) |
| Rounding | `Round::{HalfUp, HalfDown, HalfEven}` only, and only through `round(digits, strategy)`. `Display` rounds half-even to the exponent. | [money.rs L670-L716](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L670-L716) |
| Allocation | `split(n)` and `allocate(Vec<u32>)`. Both **floor the amount to whole minor units first**, then hand out the remainder one unit at a time in input order, skipping zero weights. | [money.rs L520-L668](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L520-L668) |
| Currency data | A `macro_rules!` table of 189 ISO entries and a crypto set. The doc comment cites SIX lists, but the table is hand-edited: there is no generator or update script in the crate. | [iso_currencies.rs L1-L10](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/currency/iso_currencies.rs#L1-L10) |
| Custom currencies | `define_currency_set!` creates a new currency *family* type. | [currency.rs L44-L120](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/currency.rs#L44-L120) |
| Exchange | `Exchange` (a `HashMap` keyed by code pair) and `ExchangeRate { rate: Decimal }`. `convert` multiplies and **does not round**. There is no inverse rate. | [exchange.rs L6-L67](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/exchange.rs#L6-L67) |
| Formatting | `Display`, plus a `Formatter` with `Params`. Separators come from a 4-value `Locale` enum (`EnUs`, `EnIn`, `EnEu`, `EnBy`) stored **on the currency**, not supplied by the caller. | [locale.rs L1-L60](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/locale.rs#L1-L60) |
| Parsing | `Money::from_str(&str, &T)`, using the currency's locale separators. | [money.rs L40-L104](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L40-L104) |
| serde | `{"amount": <Decimal as string>, "currency": "USD"}`, through `rust_decimal/serde-str`. Deserialize requires `T: Findable` and `'static`. | [money.rs L742-L830](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L742-L830); [Cargo.toml](https://github.com/varunsrin/rusty_money/blob/v0.5.1/Cargo.toml) |
| DB, no_std | Neither. no_std is requested in [#44](https://github.com/varunsrin/rusty_money/issues/44), still open. | |
| MSRV, licence | 1.85 (edition 2024, [PR #149](https://github.com/varunsrin/rusty_money/pull/149)); MIT. | Cargo.toml |

**API idioms**
- **No operator traits except `Neg`.** `add`, `sub`, `mul`, `div` and `compare` are methods returning
  `Result<_, MoneyError>`.
  - [PR #119](https://github.com/varunsrin/rusty_money/pull/119) ("refactor interfaces to be safe by default") removed
    the panicking operators. In the author's words: "Eliminate reliance on operators which cause panics. This is
    problematic for any serious app which may be dealing with data from external sources … Considered using compile
    type safety approach, but that adds far too much application level complexity when handling multiple currency
    types together."
  - Inherent methods named `add`, `mul`, `div` shadow the trait names. Users then hit confusing errors when
    chaining: `.mul(a)` with a `Money` argument fails because `mul` takes `Into<Decimal>`
    ([#129](https://github.com/varunsrin/rusty_money/issues/129)).
- **The type parameter is a currency family (ISO or crypto), not a currency.** `Money<iso::Currency>` for USD and
  for EUR is the same type, so mixing currencies is always a runtime check.
  - The check compares *all* currency metadata: exponent, locale, symbol, name and so on
    ([iso_currencies.rs L29-L42](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/currency/iso_currencies.rs#L29-L42)).
  - A USD descriptor with a different symbol therefore counts as a different currency.
- **Currencies are held by reference (`&'a T`).** The lifetime spreads to every type that stores money.
  - [#93](https://github.com/varunsrin/rusty_money/issues/93), still open: "Why Currency as ref?".
  - [PR #130](https://github.com/varunsrin/rusty_money/pull/130), open, makes the currency owned.
  - doubloon's README names "requires the use of explicit lifetimes (which naturally infect all types that use it)" as
    its reason for existing ([README](https://docs.rs/crate/doubloon/3.2.0/source/README.md)).
  - Deserialization forces `'static` ([money.rs L768](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L768)).
- **Dynamic money is the most requested missing feature.** [#66 "NaiveMoney"](https://github.com/varunsrin/rusty_money/issues/66)
  asks for exactly this. One commenter: "I think the decision to have the currency type be static was a mistake … I am
  parsing a stream of transactions that have transactions in different currencies." Another: "money amounts coming
  from protocol buffers that encode a currency code and a string value – there is no way to use this data."
- **`to_minor_units()` returns `0` when the value doesn't fit in `i64`.** This is documented, and `try_to_minor_units`
  is the checked alternative ([money.rs L200-L227](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L200-L227)).
  Silently returning zero is a footgun anyway; see [A.1](#a1-rusty-money-051).

**Bugs** (correctness only, with fix status)

| # | bug | reproduction | status |
|---|---|---|---|
| [#103](https://github.com/varunsrin/rusty_money/issues/103) (**now documented behaviour, not a bug fix**) | Allocation remainder goes by input order, so reordering the weights changes who gets the extra unit. | 613 over weights `98,92,98,123,102,92` gives `100,94,99,124,103,93`; the order `123,102,98,98,92,92` gives `125,104,99,99,93,93`. | **Unfixed and now documented**: `allocate` "allocates the remainder to shares with non-zero weights in input order" ([money.rs L568-L580](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L568-L580)). A comment says it still happens on 0.5. A fix PR, [#104](https://github.com/varunsrin/rusty_money/pull/104), was closed unmerged. *Our run on 0.5.1:* the same 613 USD with weights reordered gives the first 92-weight recipient 93.22 in one order and 93.21 in the other, and the 102-weight recipient 103.34 against 103.35 ([A.1](#a1-rusty-money-051)). |
| [PR #132](https://github.com/varunsrin/rusty_money/pull/132) | Zero-weight recipients got remainder units. | 1 cent over `[0, 1, 1]` gave `[1, 0, 0]`. | Fixed in 0.5.1 |
| [PR #137](https://github.com/varunsrin/rusty_money/pull/137) | Allocation **invented a unit** near Decimal's limits. | Splitting `Decimal::MAX - 1` JPY 3 ways returned one extra unit, because Decimal rounded the quotient before `floor()`. | Fixed in 0.5.1 |
| [PR #134](https://github.com/varunsrin/rusty_money/pull/134) | `add`, `sub`, `div` and `convert` panicked on overflow even though they return `Result`. | `Decimal::MAX + 1` | Fixed in 0.5.1 |
| [PR #138](https://github.com/varunsrin/rusty_money/pull/138), [PR #139](https://github.com/varunsrin/rusty_money/pull/139) | FastMoney constructors, conversion and **serde deserialization** panicked on overflow. | Deserializing Decimal's maximum in USD panics. | Fixed in 0.5.1 |
| [#100](https://github.com/varunsrin/rusty_money/issues/100) / [PR #132](https://github.com/varunsrin/rusty_money/pull/132) | `from_str` parsed the fraction as `i32`. | `Money::from_str("1.11111111111", crypto::ETH)` gives `Err(InvalidAmount)`. | Fixed in 0.5.1. The i64 minor-unit limit raised in the comments remains: 40891626854930000000000 wei doesn't fit `from_minor`. |
| [#83](https://github.com/varunsrin/rusty_money/issues/83) | `from_str` rejected anything above `i32::MAX`. | `Money::from_str("2147483648", EUR)` gives `Err`. | Fixed, [PR #85](https://github.com/varunsrin/rusty_money/pull/85) (2023) |
| [#79](https://github.com/varunsrin/rusty_money/issues/79) | `Display` prints a negative zero. | `Money::from_str("-0.005", USD)` displays `-$0.00`. | **Closed but unfixed:** 0.5.1 still prints `-$0.00` *(our run, [A.1](#a1-rusty-money-051))* |
| [#105](https://github.com/varunsrin/rusty_money/issues/105) | Display depends on the constructor. | `from_minor(10000, EUR)` gives `€100,00`, but `from_major(100, EUR)` gives `€100`. | Fixed, [PR #111](https://github.com/varunsrin/rusty_money/pull/111) (rescales before display) |
| [#107](https://github.com/varunsrin/rusty_money/issues/107), [#62](https://github.com/varunsrin/rusty_money/issues/62) | Wrong separators or symbol in the currency table. | BRL showed `R$ 1,234.56`; RON had the wrong symbol. | Fixed, [PR #110](https://github.com/varunsrin/rusty_money/pull/110), [PR #81](https://github.com/varunsrin/rusty_money/pull/81) |
| [PR #153](https://github.com/varunsrin/rusty_money/pull/153) (open) | **Wrong currency exponents in 0.5.1.** | HUF has exponent 0 ([L768](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/currency/iso_currencies.rs#L768)). MGA and MRU have 1, with the comment "TODO - exponent is 1/5th" ([L1038](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/currency/iso_currencies.rs#L1038), [L1088](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/currency/iso_currencies.rs#L1088)). ISO list-one says 2 for all three. The PR notes that `from_minor(100, HUF)` will change meaning, and that IDR input `1.234` currently means 1.234 where 1234 is intended. | **Open, not released** |
| [PR #140](https://github.com/varunsrin/rusty_money/pull/140) | Grouping with a multibyte separator counted bytes, not characters. | `1234567` with a narrow no-break space gave `12 3 4 567`. | Fixed in 0.5.1 |

**Documented design choices that users report as bugs** (ducat-rs should take a position on each)

| issue | what users expected | what rusty-money does |
|---|---|---|
| [#71](https://github.com/varunsrin/rusty_money/issues/71) (closed 2026-09-24) | `100 EUR / 3 * 3` should be `€99,99`, i.e. money quantized to the minor unit. | It keeps full Decimal precision, so the result is `€100,00`. The owner: "you should use max precision and round at the end". |
| [#61](https://github.com/varunsrin/rusty_money/issues/61) | `Money::from_str("2.00", EUR)` should parse as 2. | EUR parses with `.` as the grouping separator, so `"2.000"` is 2000 and `"2.00"` is an error. A commenter: "separators should not be a matter of the currency, but a matter of surrounding context". |
| [#59](https://github.com/varunsrin/rusty_money/issues/59) (open) | Format with exactly *n* minor digits. | No option for this. |
| allocation floors | Allocating 1.005 USD should conserve 1.005, or fail. | It floors to whole minor units first and discards the rest ([money.rs L521-L530](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L521-L530), [L568-L580](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L568-L580)). Documented: "Successful results preserve the floored total". |

**Requested features:**
- [#66](https://github.com/varunsrin/rusty_money/issues/66), NaiveMoney or dynamic currency. The only issue with reactions.
- [#154](https://github.com/varunsrin/rusty_money/issues/154) / [PR #155](https://github.com/varunsrin/rusty_money/pull/155), money ÷ money as a ratio.
- [#96](https://github.com/varunsrin/rusty_money/issues/96), `Ord` on `Currency` for `BTreeMap`.
- [#51](https://github.com/varunsrin/rusty_money/issues/51), inverse rates.
- [#44](https://github.com/varunsrin/rusty_money/issues/44), no_std.
- [#101](https://github.com/varunsrin/rusty_money/issues/101), the unused `minor_units` field.
- [#59](https://github.com/varunsrin/rusty_money/issues/59), fixed minor digits in formatting.

### 2.2 iso_currency 0.7.1

| aspect | detail | source |
|---|---|---|
| What it is | A build-script-generated `enum Currency` with `code()`, `numeric()`, `name()`, `symbol()`, `exponent() -> Option<u16>`, `subunit_fraction()`, `used_by() -> Vec<Country>`, `is_fund()`, `is_superseded()`, `latest()` and `flags()`. | [build.rs](https://github.com/zbrox/iso_currency/blob/0.7.1/build.rs) |
| Data source | A hand-maintained `isodata.tsv` (184 lines) holding ISO codes plus symbols and countries. The maintainer declined to switch to the SIX XML: it "is missing some of the datapoints" ([#12](https://github.com/zbrox/iso_currency/issues/12)). Changes arrive as user PRs, for example ANG → XCG in [#38](https://github.com/zbrox/iso_currency/issues/38). | [isodata.tsv](https://github.com/zbrox/iso_currency/blob/0.7.1/isodata.tsv) |
| Exponents | ISO's. HUF, MGA and MRU are 2 ([L65](https://github.com/zbrox/iso_currency/blob/0.7.1/isodata.tsv#L65), [L92](https://github.com/zbrox/iso_currency/blob/0.7.1/isodata.tsv#L92), [L97](https://github.com/zbrox/iso_currency/blob/0.7.1/isodata.tsv#L97)), so **this crate and rusty-money disagree on at least these three currencies**. BGN is flagged `superseded(EUR)` ([L15](https://github.com/zbrox/iso_currency/blob/0.7.1/isodata.tsv#L15)). | |
| Features | `with-serde`, `with-schemars`, `with-specta`, `iterator` (strum), and `with-sqlx-{postgres,mysql,sqlite}`. | [Cargo.toml](https://github.com/zbrox/iso_currency/blob/0.7.1/Cargo.toml) |
| sqlx | **`Decode` and `Type` only, no `Encode`** ([src/lib.rs L146-L195](https://github.com/zbrox/iso_currency/blob/0.7.1/src/lib.rs#L146-L195)): you can read a currency column but not bind one. | |
| no_std | No. | |
| Formatting | Out of scope: "the format comes not from the currency itself but the user's locale data … left more to something like icu" ([#32](https://github.com/zbrox/iso_currency/issues/32), [#3](https://github.com/zbrox/iso_currency/issues/3)). | |

**Data bugs and decisions:**
- **Wrong subunit fractions.** [#15](https://github.com/zbrox/iso_currency/issues/15) (fixed 2022): `subunit_fraction` disagreed with 10^exponent for 21 currencies. JPY and KRW showed 100; MGA and MRU showed 5.
- **Missing currencies.** [#16](https://github.com/zbrox/iso_currency/issues/16) and [#17](https://github.com/zbrox/iso_currency/issues/17) (titled "Missing currency: SEL"): VES and SLE were missing.
- **Non-ISO codes declined.** [#42](https://github.com/zbrox/iso_currency/issues/42) asked for unofficial codes (XBT/BTC, RMB/CNY); the maintainer prefers "to keep this close to the ISO standard".

### 2.3 doubloon 3.2.0: prior art for typed plus dynamic

doubloon is small (3.5k downloads), but it is the only Rust crate that implements the shape the ducat-rs draft proposes.
- **Typed and dynamic currencies.**
  - `Money<C>` uses a zero-sized struct per currency.
  - `Money<&dyn Currency>` handles currencies known only at run time.
  - The `&self` receiver on trait methods exists only to make the trait object-safe
    ([README](https://docs.rs/crate/doubloon/3.2.0/source/README.md)).
- **Operators.**
  - Typed + typed gives `Output = Self`.
  - Dynamic + dynamic, and typed + dynamic, give `Output = Result<Self, MoneyMathError>`
    ([src/lib.rs L397-L495](https://docs.rs/crate/doubloon/3.2.0/source/src/lib.rs)).
  - Chaining therefore needs `.and_then()`, which the README acknowledges.
  - Equality works across typed and dynamic values, since it "can never fail" (L348-L390).
- **Weak points.** Both kinds of operator call `Decimal`'s `add`, so they still **panic on overflow**. Dynamic equality
  compares `code()` only (L194-L198).
- **Requests.**
  - [#10](https://github.com/davestearns/penny-for-your-thoughts/issues/10), open: deserializing custom currencies.
  - [#8](https://github.com/davestearns/penny-for-your-thoughts/issues/8): creating a currency from a string, for
    database values.
  - [#3](https://github.com/davestearns/penny-for-your-thoughts/issues/3): money that shouldn't carry more fractions
    than the currency allows. The answer was a separate `Price` type.
  - [#6](https://github.com/davestearns/penny-for-your-thoughts/issues/6): money ÷ money.

### 2.4 moneta 0.7.1 and currency_rs 1.3.1: designs to avoid
- **moneta** ([docs.rs source](https://docs.rs/crate/moneta/0.7.1/source/src/lib.rs)):
  - It **quantizes on construction and after every operation**. `Money::new` rounds to the minor unit (L566-L576),
    and `qty * price` rounds (L721-L767).
  - Its `Add`/`Sub`/`Div` **panic on mismatched currencies** (L613-L690).
  - Custom currencies go into a **global `RwLock` registry** ([src/currency.rs L15-L60](https://docs.rs/crate/moneta/0.7.1/source/src/currency.rs)).
    That is global state, which the draft rules out.
- **currency_rs** stores `value: f64` and `int_value: f64`
  ([src/currency.rs L7-L11](https://docs.rs/crate/currency_rs/1.3.1/source/src/currency.rs)), so every amount is a
  binary float. Its issues are formatting ([#3](https://github.com/Adel-ak/currency_rs/issues/3)), operator traits
  ([#2](https://github.com/Adel-ak/currency_rs/issues/2)) and regex performance
  ([#1](https://github.com/Adel-ak/currency_rs/issues/1)).

---

## 3. Decimal crates

None of these is a money type. They matter for two reasons. They define the bugs Rust users already meet at the
money boundary (parsing, serde, Postgres). And they are what a `ducat-rs` user will convert to and from.

### 3.1 rust_decimal 1.43.0

**Design facts** (links `S/…` = `https://github.com/paupino/rust-decimal/blob/1.43.0/…`)

| topic | fact | source |
|---|---|---|
| Representation | m / 10^e, with \|m\| < 2^96 and 0 ≤ e ≤ 28. About 28–29 significant digits; modelled on .NET `decimal`. | [decimal.rs L112-L138](https://github.com/paupino/rust-decimal/blob/1.43.0/src/decimal.rs#L112-L138), [README L450-L457](https://github.com/paupino/rust-decimal/blob/1.43.0/README.md#L450-L457) |
| Rounding | `MidpointNearestEven`, `MidpointAwayFromZero`, `MidpointTowardZero`, `ToZero`, `AwayFromZero`, `ToNegativeInfinity`, `ToPositiveInfinity`. There is no half-ceil, half-floor, or "unnecessary" mode. `round_dp` defaults to banker's rounding. | [decimal.rs L145-L183](https://github.com/paupino/rust-decimal/blob/1.43.0/src/decimal.rs#L145-L183), [L1637-L1653](https://github.com/paupino/rust-decimal/blob/1.43.0/src/decimal.rs#L1637-L1653) |
| Operators | `+ - * / %` **panic** on overflow or division by zero. `checked_*` return `None` on overflow only: **underflow is rounded silently**. | [arithmetic_impls.rs L161-L259](https://github.com/paupino/rust-decimal/blob/1.43.0/src/arithmetic_impls.rs#L161-L259) |
| Eq / Hash | Both by value: 1.0 == 1.00 and they hash the same. Display keeps the scale. | [decimal.rs L2772-L2794](https://github.com/paupino/rust-decimal/blob/1.43.0/src/decimal.rs#L2772-L2794) |
| Floats | `from_f64` narrows to about 15.95 digits; `from_f64_retain` keeps the binary expansion. | [decimal.rs L1904-L1922](https://github.com/paupino/rust-decimal/blob/1.43.0/src/decimal.rs#L1904-L1922) |
| serde | A string by default. `serde-float`, `serde-str` and `serde-arbitrary-precision` change behaviour **globally**; `serde-with-*` add per-field modules. | [serde.rs L532-L551](https://github.com/paupino/rust-decimal/blob/1.43.0/src/serde.rs#L532-L551) |
| DB | `db-postgres`, `db-tokio-postgres`, `db-diesel-postgres`, `db-diesel-mysql`. sqlx implements its support on the sqlx side. | [Cargo.toml](https://github.com/paupino/rust-decimal/blob/1.43.0/Cargo.toml) |
| no_std, MSRV, licence | no_std without default features; `forbid(unsafe_code)`; MSRV 1.67.1; MIT. | [lib.rs L2-L5](https://github.com/paupino/rust-decimal/blob/1.43.0/src/lib.rs#L2-L5) |

**Design decisions and maintainer positions** (some of these issues are still open: #511, #569, #602, #695, #789). These show where a money library has to choose differently.

| issue | behaviour | maintainer position |
|---|---|---|
| [#843](https://github.com/paupino/rust-decimal/issues/843) | **Division rounds exact ties up when the divisor is wider than 64 bits**; the issue says the same tie with a 32-bit divisor rounds to even. `15845632502852867518708790069 / 200000000000000000000` gives `…395035`; the exact quotient is `…3950345`. | "I don't _think_ we guarantee a particular tie-breaker here", then "we've always rounded up so this would be a breaking change … modeled … from the .NET Decimal". So there is no guaranteed tie rule. |
| [#515](https://github.com/paupino/rust-decimal/issues/515), [#511](https://github.com/paupino/rust-decimal/issues/511) | `checked_mul(1.000000000000000000000000001, same)` gives `Some(1.000000000000000000000000002)`. `MAX.checked_add(0.45)` gives `Some(MAX)`. | Underflow is rounded "to make it fit". A strict mode is on the v2 roadmap ([#354](https://github.com/paupino/rust-decimal/issues/354)). |
| [#411](https://github.com/paupino/rust-decimal/issues/411), [#569](https://github.com/paupino/rust-decimal/issues/569) | `from_str` rounds input with more than 28 fractional digits. serde has no way to opt into `from_str_exact`. | It follows .NET `Decimal.Parse`; `from_str_exact` exists, but serde can't use it. |
| [#789](https://github.com/paupino/rust-decimal/issues/789), [#414](https://github.com/paupino/rust-decimal/issues/414) | `(100/3)*3` gives `100.00000000000000000000000000`; `1/(1/3)` gives `3.0000000000000000000000000003`. | "an explicit choice"; rationals are out of scope. |
| [#632](https://github.com/paupino/rust-decimal/issues/632), [#391](https://github.com/paupino/rust-decimal/issues/391), [#695](https://github.com/paupino/rust-decimal/issues/695) | The result scale grows with each operation and **depends on evaluation order**: `-d3+d3+d2` has scale 2, `-d3+d2+d3` has scale 3. | Expected; equality ignores scale "for a reason". |
| [#777](https://github.com/paupino/rust-decimal/issues/777), [#765](https://github.com/paupino/rust-decimal/issues/765), [#706](https://github.com/paupino/rust-decimal/issues/706) | `0.525.round_dp(2)` gives `0.52`, which surprises users. A request for a configurable default was declined. | "Create your own wrapper type." |
| [#602](https://github.com/paupino/rust-decimal/issues/602) | The global `serde-*` features are not additive, so Cargo feature unification lets one dependency change another's JSON. | These "should probably be mutually exclusive"; a redesign is planned in [#611](https://github.com/paupino/rust-decimal/issues/611). |
| [#799](https://github.com/paupino/rust-decimal/issues/799) | `-dec!(0)` is a negative zero. | Allowed. |

**Correctness bugs** (the money-relevant subset)

| issue | reproduction (from the issue) | status in 1.43.0 |
|---|---|---|
| [#895](https://github.com/paupino/rust-decimal/issues/895) | **`format!("{:.2}", 2.999)` gives `2.99`**: precision formatting truncates where f64 gives `3.00`. "receipts, invoices and logs show a different value than the number". | Open |
| [#845](https://github.com/paupino/rust-decimal/issues/845), [#548](https://github.com/paupino/rust-decimal/issues/548) | `from_f64_retain(7.9)` gives `…3552713678765`, but the correct value is `…8801`. `try_from(1652185258.8058286)` gives `1652185258.805829`. | Open |
| [#828](https://github.com/paupino/rust-decimal/issues/828), [#829](https://github.com/paupino/rust-decimal/issues/829) | `to_f64("9533848929109301.5")` gives `9533848929109300.0`, not the correctly rounded `…302.0`. `to_f32` double-rounds. | #828 fixed on master ([PR #831](https://github.com/paupino/rust-decimal/pull/831)), unreleased; #829 open |
| [#838](https://github.com/paupino/rust-decimal/issues/838), [#704](https://github.com/paupino/rust-decimal/issues/704) | `from_str("0.00000000000000000000000000001234e5")` gives `Ok(0.00000000000000000000000)`. JSON `1E-29` is rejected, while the same value written out is accepted. | Open |
| [#844](https://github.com/paupino/rust-decimal/issues/844) | `4294967295 % 1.0000000000000000000000000000` gives `0.9232812099469197934124335104`; the answer is 0. | Open |
| [#842](https://github.com/paupino/rust-decimal/issues/842), [#860](https://github.com/paupino/rust-decimal/issues/860) | A product that underflows to zero displays as `-0.0000…`; `dec!(-0.4).ceil()` displays `-0`. | #842 fixed on master ([PR #871](https://github.com/paupino/rust-decimal/pull/871)), unreleased; #860 open |
| [#834](https://github.com/paupino/rust-decimal/issues/834), [#854](https://github.com/paupino/rust-decimal/issues/854), [#858](https://github.com/paupino/rust-decimal/issues/858) | Values with scale > 28 can be built (`trunc_with_scale(40)`, `deserialize`, bytemuck). They then serialize to other values, or panic in Display. | Fixed on master ([PR #863](https://github.com/paupino/rust-decimal/pull/863), [PR #864](https://github.com/paupino/rust-decimal/pull/864)), unreleased; bytemuck open |
| [#857](https://github.com/paupino/rust-decimal/issues/857), [#856](https://github.com/paupino/rust-decimal/issues/856) | Turning on `serde-with-arbitrary-precision` changes float deserialization for **every** `Decimal`. With bincode `float_option`, `Some(1.5)` round-trips to `None`. | #856 fixed on master ([PR #876](https://github.com/paupino/rust-decimal/pull/876)), unreleased; #857 open |
| [#835](https://github.com/paupino/rust-decimal/issues/835) | `format!("{:.28}", Decimal::from(1000))` panics with `CapacityError`. | Open |
| PG: [#852](https://github.com/paupino/rust-decimal/issues/852), [#853](https://github.com/paupino/rust-decimal/issues/853), [#655](https://github.com/paupino/rust-decimal/issues/655), [#652](https://github.com/paupino/rust-decimal/issues/652), [#645](https://github.com/paupino/rust-decimal/issues/645), [#763](https://github.com/paupino/rust-decimal/issues/763), [#241](https://github.com/paupino/rust-decimal/issues/241) | Decoding `1e32::numeric` panics. `99999999999999999999.0000000050000001` decodes off by one unit in the last place. **PG `NaN` silently became 0.** `1e29` panicked. `0.1000…0001` gave an invalid scale-29 value. Zero had a non-canonical encoding. `0.000001660` round-tripped as `0.000000166`. | #852 fixed on master (commit [d7e8ed4](https://github.com/paupino/rust-decimal/commit/d7e8ed4342), "Fix panic decoding PostgreSQL NUMERIC values from 1e32 (#862)"), unreleased; #853 decode half open; #655 fixed in 1.36.0; #652 in 1.35.0; #645 in 1.34.3; #763 in 1.41.0; #241 via [PR #243](https://github.com/paupino/rust-decimal/pull/243) |
| [#859](https://github.com/paupino/rust-decimal/issues/859) | diesel MySQL: `Long` 825307441 decodes to `1111`. | Open |
| [#127](https://github.com/paupino/rust-decimal/issues/127) | `7314.6229858868828353570724702 + 1000` gave `391.80…`, a silent overflow in 0.8.1. | Fixed by rounding to fit, which became the policy above. |
| regression in 1.42.0 | `34028236693 - 7.0000000000000000000000000000` gave `68056473378.09…` after a speed-up ([PR #794](https://github.com/paupino/rust-decimal/pull/794)). | Fixed in 1.42.1 ([PR #804](https://github.com/paupino/rust-decimal/pull/804)) |

**Most requested:**
- [#354](https://github.com/paupino/rust-decimal/issues/354), the v2 roadmap: a strict underflow mode, removing the
  fallible `From` impls, configurable precision.
- [#569](https://github.com/paupino/rust-decimal/issues/569), exact serde parsing.
- [#611](https://github.com/paupino/rust-decimal/issues/611), the serde feature redesign.
- [#527](https://github.com/paupino/rust-decimal/issues/527), `const fn try_new`.
- [#623](https://github.com/paupino/rust-decimal/issues/623), MongoDB support.
- [#169](https://github.com/paupino/rust-decimal/issues/169), `pow`, is the most-reacted issue overall (closed).

### 3.2 bigdecimal 0.4.11

Links: [docs.rs source](https://docs.rs/crate/bigdecimal/0.4.11/source/).

**Design**
- **Representation:** a `BigInt` plus an `i64` scale ([src/lib.rs L217-L221](https://docs.rs/crate/bigdecimal/0.4.11/source/src/lib.rs)).
- **Build-time defaults set by environment variables:** precision 100, rounding `HalfEven`, exponent-format thresholds
  5 and 15, serde scale limit 150000 ([build.rs L5-L11](https://docs.rs/crate/bigdecimal/0.4.11/source/build.rs)).
  Division uses the 100-digit default.
- **Rounding modes:** `Up, Down, Ceiling, Floor, HalfUp, HalfDown, HalfEven` ([src/rounding.rs L18-L104](https://docs.rs/crate/bigdecimal/0.4.11/source/src/rounding.rs)). `with_scale` truncates ([src/lib.rs L321-L327](https://docs.rs/crate/bigdecimal/0.4.11/source/src/lib.rs)); `round()` uses the build-time default (L863-L869).
- **Panics:** division by zero panics ([src/impl_ops_div.rs L9-L10](https://docs.rs/crate/bigdecimal/0.4.11/source/src/impl_ops_div.rs)). There is no checked or `Result` arithmetic apart from `parse_bytes` and `sqrt`, which return `Option`.
- **Serde:** `Serialize` goes through `Display` via `collect_str`, so the exponent thresholds end up in serialized strings. The default `Deserialize` uses `deserialize_any` and accepts f64 ([src/impl_serde.rs L16, L72-L103](https://docs.rs/crate/bigdecimal/0.4.11/source/src/impl_serde.rs)).
- **Other:** no_std is supported ([src/lib.rs L42](https://docs.rs/crate/bigdecimal/0.4.11/source/src/lib.rs)); MIT/Apache-2.0; features `std`, `serde`, `serde-json`, `string-only` ([Cargo.toml L48-L59](https://docs.rs/crate/bigdecimal/0.4.11/source/Cargo.toml)). sqlx and diesel implement their own support for the type.

**Decisions closed as by-design**
- [#135](https://github.com/akubera/bigdecimal-rs/issues/135): `to_string()` gives `"1E-38"`; `to_plain_string` was
  added in 0.4.7. Scientific notation was chosen to stop memory amplification: "1e-1000000000 would be amplified to
  1GB worth of zeros".
- [#103](https://github.com/akubera/bigdecimal-rs/issues/103): `try_from(20_000.000001_f64)` gives the full binary
  expansion `20000.0000010000003385357558727264404296875` (labelled ProbablyWontFix).
- [#146](https://github.com/akubera/bigdecimal-rs/issues/146): `zero().round(2)` displays `"0"`.
- [#149](https://github.com/akubera/bigdecimal-rs/issues/149), open: `round()` is half-even, which surprised the user.

**Bugs**

| issue | reproduction (from the issue) | status |
|---|---|---|
| [#140](https://github.com/akubera/bigdecimal-rs/issues/140) (also [sqlx #3575](https://github.com/transact-rs/sqlx/issues/3575)) | `format!("{:.2}", 999999991/1e6)` gives `"100.00"`, not `"1000.00"`. | Fixed in 0.4.6 |
| [#126](https://github.com/akubera/bigdecimal-rs/issues/126) | `{:.2}` of 68.21003 gave `"68"`; the reporter was formatting money. | Fixed in 0.4.4 |
| [#136](https://github.com/akubera/bigdecimal-rs/issues/136) | `"-0.68".round(0)` gave `1`. | Fixed ([PR #137](https://github.com/akubera/bigdecimal-rs/pull/137)) |
| [#47](https://github.com/akubera/bigdecimal-rs/issues/47), [#150](https://github.com/akubera/bigdecimal-rs/issues/150) | Rounding carries: `1.00009.with_prec(4)` added a spurious 1. `99.9` rounded to 1 digit prints `1.0e2` where `100.0` prints `1e2`. | #47 fixed; #150 open |
| [#113](https://github.com/akubera/bigdecimal-rs/issues/113) | JSON `16.7` gives `16.699999999999999289457264239899814128875732421875` (a 0.4 regression). | Open |
| [#151](https://github.com/akubera/bigdecimal-rs/issues/151) | The `serde-json` feature turns on serde_json `arbitrary_precision`, which breaks unrelated `#[serde(flatten)]` f64 structs. | Open |
| [#109](https://github.com/akubera/bigdecimal-rs/issues/109), [#125](https://github.com/akubera/bigdecimal-rs/issues/125), [#93](https://github.com/akubera/bigdecimal-rs/issues/93), [#108](https://github.com/akubera/bigdecimal-rs/issues/108) | Huge exponents: `"1e99999999999999" == 0` hangs; `cmp` loops; `==` overflows; Display of `1E{i64::MIN}` panics. Parsing is quick: the blow-up comes later. | #109 open (the owner says the "primary issue is fixed"); others fixed in 0.4.3–0.4.4 |
| [#23](https://github.com/akubera/bigdecimal-rs/issues/23), [#143](https://github.com/akubera/bigdecimal-rs/issues/143) | `1.234 == 1.234000`, but their hashes differed (derived `Hash`). `"1011"` and `"0.01011"` hash alike, a collision. | #23 fixed (2017); #143 open |

**Most requested:**
- [#74](https://github.com/akubera/bigdecimal-rs/issues/74) `powf` and [#45](https://github.com/akubera/bigdecimal-rs/issues/45) pow.
- Relevant to money: [#124](https://github.com/akubera/bigdecimal-rs/issues/124) a maximum number of decimals (a
  fixed scale), [#87](https://github.com/akubera/bigdecimal-rs/issues/87) custom round up/down, and
  [#159](https://github.com/akubera/bigdecimal-rs/issues/159) the `05Up` rounding mode.

### 3.3 fastnum 0.7.5

Links: [docs.rs source](https://docs.rs/crate/fastnum/0.7.5/source/).

**Design**
- **Representation:** fixed-width coefficients (D64 to D512) with a 16-bit exponent and signal flags ([src/decimal/dec.rs L46-L54](https://docs.rs/crate/fastnum/0.7.5/source/src/decimal/dec.rs); [doc/LIB.md L107-L116, L193](https://docs.rs/crate/fastnum/0.7.5/source/doc/LIB.md)).
- **Rounding modes:** `No, Up, Down, Ceiling, Floor, HalfUp, HalfDown, HalfEven` ([src/decimal/context/rounding_mode.rs L12-L100](https://docs.rs/crate/fastnum/0.7.5/source/src/decimal/context/rounding_mode.rs)). The default is **HalfUp, set at
  build time** by `RUST_FASTNUM_DEFAULT_ROUNDING_MODE` ([build.rs L6](https://docs.rs/crate/fastnum/0.7.5/source/build.rs); doc/LIB.md L1928).
- **Traps:** by default, overflow, invalid operation and division by zero **panic** ([src/decimal/signals.rs L56-L57](https://docs.rs/crate/fastnum/0.7.5/source/src/decimal/signals.rs); doc/LIB.md L355-L385). An inexact result only raises a
  flag, even though the docs claim "Strictly exact precision: no round-off errors" (`doc/LIB.md` L55, L430-L448).
- **Serde:** always writes a string. The deserialize mode (`Strict`, `Stringify`, `Any`) is set at build time (doc/LIB.md L1813-L1821).
- **Integrations:** sqlx, diesel and tokio-postgres features.
- **Other:** no_std ([src/lib.rs L3](https://docs.rs/crate/fastnum/0.7.5/source/src/lib.rs)); **MSRV 1.94** ([Cargo.toml L14](https://docs.rs/crate/fastnum/0.7.5/source/Cargo.toml)); MIT OR Apache-2.0.

**Bugs**
- **[#70](https://github.com/neogenie/fastnum/issues/70), open:** `"50000E15".parse::<D64>()` displays
  `50000000000000000000`, and re-parsing that output fails. `to_string` and serde therefore don't round-trip.
- **[#62](https://github.com/neogenie/fastnum/issues/62), open:** `1.01` rounded `Up` to 0 places gives `1`. The
  maintainer says `Up`/`Down` look only at the next digit, which contradicts the docs.
- **[#59](https://github.com/neogenie/fastnum/issues/59), fixed in 0.7.5:** `1 == 1.1.floor()`, but their hashes
  differed, because signal flags were hashed.
- **[#22](https://github.com/neogenie/fastnum/issues/22) and [#21](https://github.com/neogenie/fastnum/issues/21),
  fixed:** `35000 < 19205.17…` evaluated true, and sorting panicked. The reporter had migrated a 400k-line trading
  codebase.
- **[#41](https://github.com/neogenie/fastnum/issues/41) and [#16](https://github.com/neogenie/fastnum/issues/16),
  fixed:** sqlx Postgres decode of a stored 1/3 overflowed (NUMERIC's 4-digit groups add padding zeros), and encode
  failed for `9e18 + 9e-16`.
- **[#24](https://github.com/neogenie/fastnum/issues/24), fixed:** `{:.2}` of `0.999405000` gave `"0.10"`.

**Decisions closed as by-design**
- [#25](https://github.com/neogenie/fastnum/issues/25): `0.000000432.round(9)` displays `"4.32E-7"`.
- [#26](https://github.com/neogenie/fastnum/issues/26): `from_f64(0.2)` gives the exact binary value.
- [#19](https://github.com/neogenie/fastnum/issues/19): the rounding environment variable was "ignored". It was user
  error, which shows how fragile build-time defaults are.

### 3.4 primitive_fixed_point_decimal 1.6.0: the closest design to ducat-rs

Links: [docs.rs source](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/).

**Design**
- **Representation:** a primitive integer (i8 to i128) at a const-generic scale (`ConstScaleFpdec<I, S>`) or at a
  run-time scale (`OobScaleFpdec`).
- **Arithmetic:** `+` and `-` only between identical types. `*` and `/` take an explicit `Rounding` through the
  `*_ext` variants.
- **Rounding modes:** `Round` (ties away from zero, [src/fpdec_inner.rs L193-L200](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/src/fpdec_inner.rs)), `Floor`, `Ceiling`, `TowardsZero`, `AwayFromZero` ([src/lib.rs L78-L90](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/src/lib.rs)). **There is no
  half-even.** `Mul`/`Div` panic via `.expect("overflow in decimal multiplication")` ([src/const_scale_fpdec.rs L459-L533](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/src/const_scale_fpdec.rs)).
- **Parsing is strict:** too many fraction digits is `ParseError::Precision` ([src/lib.rs L38-L47](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/src/lib.rs)). From [#11](https://github.com/WuBingzheng/primitive_fixed_point_decimal/issues/11):
  "Silently loss precision might cover up some potential issues, so throwing an error directly would be a better
  choice".
- **Other:** no_std without alloc; MIT.

**Footguns we confirmed in the source**
- `Add` is `Self(self.0 + rhs.0)`
  ([src/const_scale_fpdec.rs L417-L424](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/src/const_scale_fpdec.rs)).
  It **panics in debug and wraps silently in release**, like the primitive it wraps.
- serde writes **`f64` to non-human-readable formats**
  ([src/serde_impl.rs L23-L27](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/src/serde_impl.rs),
  with the comment "XXX how to selete dump type?"). That loses precision above 2^53.

**Bugs**
- [#13](https://github.com/WuBingzheng/primitive_fixed_point_decimal/issues/13), fixed in 1.4.1: `{:.2}` of `0.999`
  panicked with "attempt to subtract with overflow". The cause was a rounding carry.
- Three fixes listed only in the CHANGELOG: "Fix bug in division for i128 type" (1.4.2), "Fix rounding bug for negative
  quotient" (1.5.0), and "Fix and optimize `rounding_div()`" (1.3.0). Together they are direct evidence that
  **rounding division on i128 is easy to get wrong**.

### 3.5 decimal-rs 0.2.0 and dec 0.4.11
- **decimal-rs** ([yashan-technologies/decimal-rs](https://github.com/yashan-technologies/decimal-rs)):
  - Representation: a u128 magnitude with precision 38 and scale −126..130 ([src/decimal.rs L27-L31, L418-L424](https://docs.rs/crate/decimal-rs/0.2.0/source/src/decimal.rs)). `round` is half away from zero (L766), with no mode enum.
  - Operators panic ([src/ops.rs L49-L53, L89-L93](https://docs.rs/crate/decimal-rs/0.2.0/source/src/ops.rs)), and `checked_*` catch overflow only (src/decimal.rs L1063-L1214).
  - [#6](https://github.com/yashan-technologies/decimal-rs/issues/6): `1.0000000000000000000000000001²` gives
    `1.0000000000000000000000000002`. The maintainer: "the decimal will be rounded if it overflowed. This is a feature
    … no plan to add `exact_mul`". The reporter wanted it for money.
- **dec** ([MaterializeInc/rust-dec](https://github.com/MaterializeInc/rust-dec)):
  - It wraps the C library libdecnumber, and offers 8 rounding modes, including `ZeroFiveUp`.
  - **Default rounding differs between types.** `Rounding::default()` and `Decimal128` are HalfEven, but
    `Context<Decimal<N>>` inherits libdecnumber's **HALF_UP** (`src/decimal.rs` L1305; `decContext.c` L77-L87).
  - Operators throw away the status flags, so overflow and inexact results go unreported (`src/decimal128.rs` L545-L551).
  - Its bugs are memory-safety issues in the C core ([#80](https://github.com/MaterializeInc/rust-dec/issues/80),
    [#76](https://github.com/MaterializeInc/rust-dec/issues/76)).

### 3.6 num-rational 0.4.2 (for `Ratio`)
- **Overflow in ordinary operations panics, and this is expected.** [#117](https://github.com/rust-num/num-rational/issues/117):
  `Rational64::new(1, 3000000000) / Rational64::from_integer(3080000000)` panics with "attempt to multiply with
  overflow", even though "the correct fully-reduced result" fits. The advice was to use `checked_div`.
- **[#143](https://github.com/rust-num/num-rational/issues/143), open:** `floor` and `ceil` overflow too easily. With
  `Ratio::<i8>::new(70, 81).ceil()`, the intermediate values don't fit in `i8`.
- **[#72](https://github.com/rust-num/num-rational/issues/72) and [#73](https://github.com/rust-num/num-rational/issues/73),
  fixed in 0.2.4:** `checked_div` itself panicked, on 0/0 and on `i64::MIN` negation. [#6](https://github.com/rust-num/num-rational/issues/6)
  (`i64::MIN` overflow) is still open after ten years.
- **[#140](https://github.com/rust-num/num-rational/issues/140), open:** comparing two big rationals overflows the
  stack. The reporter notes the risk "on a server where the numbers can be user supplied".
- **[#102](https://github.com/rust-num/num-rational/issues/102), open:** `ToPrimitive` truncates non-integral values
  instead of returning `None`.
- **Missing:** there is no way to parse a decimal string into a `Ratio`
  ([#131](https://github.com/rust-num/num-rational/issues/131), open, "do we have any hope for a proper
  implementation?").

---

## 4. Formatting and locale data: ICU4X

Versions: icu 2.4.0, icu_decimal 2.4.0, fixed_decimal 0.7.3 and icu_experimental 0.7.0, all released 2026-10-22.
Links below are to the `icu@2.4.0` tag.

### 4.1 icu_decimal and fixed_decimal (stable)
- **Formatter:** `DecimalFormatter::try_new(prefs, options)` and `format(&Decimal)`.
  - The only option is `grouping_strategy` (`Auto`, `Never`, `Always`, `Min2`).
  - Sign display is a property of the input (`fixed_decimal::SignDisplay`).
  - Sources: [components/decimal/src/options.rs L11-L68](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/decimal/src/options.rs#L11-L68), [decimal_formatter.rs L115-L158](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/decimal/src/decimal_formatter.rs#L115-L158), [fixed_decimal signed_decimal.rs L106, L150](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/utils/fixed_decimal/src/signed_decimal.rs#L106).
- **Input:** `fixed_decimal::Decimal`, arbitrary precision with a magnitude range of `i16` ([decimal.rs L88-L101](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/utils/fixed_decimal/src/decimal.rs#L88-L101)). It converts from every
  integer type up to `i128`, from ASCII strings ([lib.rs L116-L128](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/utils/fixed_decimal/src/lib.rs#L116-L128)), and from `f64` behind the `ryu` feature ([rounding.rs L155-L176](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/utils/fixed_decimal/src/rounding.rs#L155-L176)). It is a formatting type with
  no arithmetic.
- **Rounding modes match ducat's nine Intl names exactly.**
  - `UnsignedRoundingMode`: `Expand`, `Trunc`, `HalfExpand`, `HalfTrunc`, `HalfEven`.
  - `SignedRoundingMode`: those plus `Ceil`, `Floor`, `HalfCeil`, `HalfFloor`.
  - Rounding increments: 1, 2, 5, 25.
  - Source: [utils/fixed_decimal/src/rounding.rs L63-L149](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/utils/fixed_decimal/src/rounding.rs#L63-L149).
  - ducat-rs's `Rounding` therefore maps one-to-one onto ICU4X.
- **Compact notation:** `CompactDecimalFormatter`, behind `icu_decimal`'s `unstable` feature ([lib.rs L116-L138](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/decimal/src/lib.rs#L116-L138)).
- **Platform:** no_std (alloc optional, [lib.rs L77-L114](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/decimal/src/lib.rs#L77-L114)). MSRV **1.88** for icu_decimal ([published Cargo.toml L14](https://docs.rs/crate/icu_decimal/2.4.0/source/Cargo.toml)) and 1.82 for fixed_decimal (crates.io `rust_version`).

### 4.2 Currency formatting (icu_experimental, unstable)
- **Status:** the crate is experimental and "will usually undergo a major `SemVer` bump for every ICU4X release" ([lib.rs L23](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/experimental/src/lib.rs#L23)).
  Graduation is tracked in [#8159](https://github.com/unicode-org/icu4x/issues/8159), open.
- **API:** one `CurrencyFormatter<V>`.
  - The display style is chosen by constructor ([formatter.rs L497-L870, L1034ff](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/experimental/src/dimension/currency/formatter.rs#L497)): `try_new_symbol`, `try_new_symbol_narrow`, `try_new_code`,
    `try_new_name` ("12,345.67 US dollars", with no options), `try_new_no_currency`, and compact variants.
  - There is no `currencyDisplay` option ([#7785](https://github.com/unicode-org/icu4x/issues/7785), open).
  - Options are `CurrencyUsage::{Standard, Accounting}`, which corresponds to ECMA-402 `currencySign`
    ([options.rs L15-L44](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/experimental/src/dimension/currency/options.rs#L15-L44)).
- **It always rounds to CLDR digits, using HalfExpand.**
  - Every format path calls `apply_precision`, which rounds to the CLDR `fractions` digits and increment with a
    hard-coded `SignedRoundingMode::Unsigned(UnsignedRoundingMode::HalfExpand)`
    ([formatter.rs L1498](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/experimental/src/dimension/currency/formatter.rs#L1498),
    [L1654-L1670](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/experimental/src/dimension/currency/formatter.rs#L1654-L1670)).
  - There is no option for the mode, the digits, significant digits, or trailing zeros.
  - Per-currency data work is in [#8153](https://github.com/unicode-org/icu4x/issues/8153), open.
- **Cash rounding is not supported.** The data is there (`FractionInfo { cash_digits, cash_rounding }` in an unstable
  provider module, [fractions.rs L63-L90](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/experimental/src/dimension/provider/currency/fractions.rs#L63-L90)), but the formatter doesn't use it. [PR #8175](https://github.com/unicode-org/icu4x/pull/8175), which
  would add a cash option, was closed unmerged.
- **Absent:** territory-to-currency data (none in `src/dimension`). **Open issues:** `formatToParts` with a currency part
  ([#8455](https://github.com/unicode-org/icu4x/issues/8455)), non-ISO currencies
  ([#8327](https://github.com/unicode-org/icu4x/issues/8327)), and choosing the numeric input type
  ([#8146](https://github.com/unicode-org/icu4x/issues/8146)).

**ISO digits and CLDR digits differ, and ICU4X uses CLDR's.** CLDR 49 `supplementalData.xml` gives:

| currency | ISO 4217 minor units | CLDR 49 `digits` | source |
|---|---|---|---|
| HUF | 2 | 0, plus `cashRounding="5"` | [L34](https://github.com/unicode-org/cldr/blob/release-49/common/supplemental/supplementalData.xml#L34) |
| IDR | 2 | 0 | [L35](https://github.com/unicode-org/cldr/blob/release-49/common/supplemental/supplementalData.xml#L35) |
| IQD | 3 | 0 | [L36](https://github.com/unicode-org/cldr/blob/release-49/common/supplemental/supplementalData.xml#L36) |
| MGA | 2 | 0 | [L50](https://github.com/unicode-org/cldr/blob/release-49/common/supplemental/supplementalData.xml#L50) |

The ISO figures were read from ducat's vendored `data/iso4217-list-one.xml` (published 2026-09-17).

- ICU4X's experimental data was generated from CLDR 49.0.0 (icu_experimental_data README).
- **Consequence** (derived from the source above, not run): an amount that is exact at ISO scale, such as HUF 12.34 or IDR 1234.56, is re-rounded half-expand
  to whole units when formatted. ducat's chosen rounding mode is ignored at that step.
- rusty-money's HUF exponent of 0 matches CLDR's value, not ISO's (§2.1).

### 4.3 Parsing and RBNF
- **Localized parsing:** none. fixed_decimal parses only ASCII `-?digits(.digits)?`.
  [#567](https://github.com/unicode-org/icu4x/issues/567) is about parsing CLDR *patterns*, not user input. We found no
  tracking issue for user-input parsing (based on searches of issue titles; not otherwise verified).
- **RBNF / spellout:** none.
  - [#595](https://github.com/unicode-org/icu4x/issues/595) (algorithmic numbering systems, RBNF) has been open since
    2021, still at the design stage.
  - [#7803](https://github.com/unicode-org/icu4x/issues/7803) (localized money-in-words) was closed as **not planned**
    on 2026-07-08.
- **Licence:** Unicode-3.0. This is permissive. Distributed binaries must include the notice; it doesn't prevent
  `ducat-icu` being MIT.

---

## 5. Database boundaries (sqlx, diesel, Postgres)

Most of the panics and silent value changes across these crates happen at the database boundary.

| source | finding |
|---|---|
| rust_decimal PG codec | NaN became 0 ([#655](https://github.com/paupino/rust-decimal/issues/655)). A value with more than 28 digits panicked ([#652](https://github.com/paupino/rust-decimal/issues/652), [#852](https://github.com/paupino/rust-decimal/issues/852)), or became an invalid scale-29 value ([#645](https://github.com/paupino/rust-decimal/issues/645)). Decoding was off by one unit in the last place ([#853](https://github.com/paupino/rust-decimal/issues/853), open). Zero had a non-canonical encoding ([#763](https://github.com/paupino/rust-decimal/issues/763)). The value was scaled wrongly ([#241](https://github.com/paupino/rust-decimal/issues/241)). |
| [sqlx #3052](https://github.com/transact-rs/sqlx/issues/3052) | "DoS: Panic in sqlx when sending a large BigDecimal to PostgreSQL". It came from an `expect` in the encoder and was found by fuzzing JSON input. Fixed. The reporter notes "some places run with panic=abort". |
| [sqlx #3015](https://github.com/transact-rs/sqlx/issues/3015) (open) | `PgNumeric::decode` panics on an unconstrained `NUMERIC` column decoded into `rust_decimal::Decimal`. |
| [sqlx #2247](https://github.com/transact-rs/sqlx/issues/2247) | A Decimal's scale isn't preserved through `PgNumeric`: a decoded value of `21474836.47` comes back with a different mantissa and scale. A commenter pointed to the sqlx source and said it "seems like this is intended"; JSON output then changes too. |
| [sqlx #2303](https://github.com/transact-rs/sqlx/issues/2303) (open) | Users want serde on `PgMoney`. |
| fastnum [#41](https://github.com/neogenie/fastnum/issues/41), [#16](https://github.com/neogenie/fastnum/issues/16) | NUMERIC's base-10000 padding overflowed on decode. Values with a wide spread of digits failed to encode. |
| rust_decimal [#859](https://github.com/paupino/rust-decimal/issues/859) | diesel MySQL type confusion: an integer column decoded as its ASCII bytes. |
| iso_currency | sqlx `Decode` without `Encode` (§2.2). |

---

## 6. For ducat-rs

### 6.1 Bug classes to turn into regression tests

Most of these belong in ducat's language-neutral `spec/`, following the draft's rule that spec fixes go upstream.
Rust-only boundaries (serde formats, sqlx, diesel, `Display` flags) stay in ducat-rs's own tests.

| # | test | source |
|---|---|---|
| T1 | **Allocation conserves the exact total.** A total with a sub-minor fraction, such as 1.005 USD, is either an error or fully allocated; never silently floored. | rusty-money docs ([money.rs L568-L580](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/money.rs#L568-L580)); [A.1](#a1-rusty-money-051) |
| T2 | **Allocation never invents or loses a unit at the `i128` limits**, e.g. `i128::MAX - 1` split 3 ways, or one recipient with weight `u64::MAX`. | rusty-money [PR #137](https://github.com/varunsrin/rusty_money/pull/137) |
| T3 | **The remainder strategy decides who gets the extra unit.** Reordering the weights `98,92,98,123,102,92` must not change any recipient's share under a largest-remainder strategy. | [#103](https://github.com/varunsrin/rusty_money/issues/103) |
| T4 | **Zero-weight recipients get exactly zero.** `[0, 1, 1]` over 1 unit. | [PR #132](https://github.com/varunsrin/rusty_money/pull/132) |
| T5 | **Exponent table** (values from ducat's ISO list-one, published 2026-09-17): HUF, MGA, MRU = 2; IDR = 2; IQD = 3; ISK = 0; CLF, UYW = 4; VND = 0. XCG, SLE, VED and VES are in list-one; ANG, BGN and SLL are not, so they belong in the historic table. | rusty-money [PR #153](https://github.com/varunsrin/rusty_money/pull/153); iso_currency [#15](https://github.com/zbrox/iso_currency/issues/15), [#38](https://github.com/zbrox/iso_currency/issues/38), [#16](https://github.com/zbrox/iso_currency/issues/16), [#17](https://github.com/zbrox/iso_currency/issues/17) |
| T6 | **Formatting HUF, IDR, IQD and MGA** at ISO scale with ducat-icu doesn't silently re-round, or else does exactly what ducat's spec says. | §4.2, [formatter.rs L1654-L1670](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/experimental/src/dimension/currency/formatter.rs#L1654-L1670) |
| T7 | **No negative zero.** Rounding −0.005 USD half-even gives `0.00`, not `-0.00`, in `Display`, in ducat-icu formatting and in serde. A product that underflows to zero isn't negative either. | rusty-money [#79](https://github.com/varunsrin/rusty_money/issues/79); rust_decimal [#842](https://github.com/paupino/rust-decimal/issues/842), [#860](https://github.com/paupino/rust-decimal/issues/860), [#799](https://github.com/paupino/rust-decimal/issues/799); bigdecimal [#160](https://github.com/akubera/bigdecimal-rs/issues/160) |
| T8 | **`format!("{:.2}", m)` never truncates or panics.** Whatever rule is chosen (rounding, refusal, or ignoring the flag) is tested on `2.999`, `0.999`, `9.995`, and `{:.28}` of a large value. | rust_decimal [#895](https://github.com/paupino/rust-decimal/issues/895), [#835](https://github.com/paupino/rust-decimal/issues/835); bigdecimal [#140](https://github.com/akubera/bigdecimal-rs/issues/140), [#126](https://github.com/akubera/bigdecimal-rs/issues/126); fastnum [#24](https://github.com/neogenie/fastnum/issues/24); primitive_fixed_point_decimal [#13](https://github.com/WuBingzheng/primitive_fixed_point_decimal/issues/13) |
| T9 | **Rounding carries into a new digit:** 9.995 → 10.00, 99.9 at 1 significant digit, −0.68 → −1. | bigdecimal [#136](https://github.com/akubera/bigdecimal-rs/issues/136), [#150](https://github.com/akubera/bigdecimal-rs/issues/150), [#47](https://github.com/akubera/bigdecimal-rs/issues/47) |
| T10 | **Exact ties in division round by the requested mode**, including with 96-bit-plus divisors, e.g. `15845632502852867518708790069 / 200000000000000000000` half-even. | rust_decimal [#843](https://github.com/paupino/rust-decimal/issues/843) |
| T11 | **i128 rounding division with negative quotients**, for every mode and sign combination, and at `i128::MIN`. | primitive_fixed_point_decimal CHANGELOG 1.3.0, 1.4.2, 1.5.0 |
| T12 | **Parsing and deserialization never round silently.** Input with more fraction digits than the target scale is an error (or follows an explicit rounding argument). This applies to `FromStr`, serde and DB decode alike. | rust_decimal [#411](https://github.com/paupino/rust-decimal/issues/411), [#569](https://github.com/paupino/rust-decimal/issues/569), [#838](https://github.com/paupino/rust-decimal/issues/838); decimal-rs [#6](https://github.com/yashan-technologies/decimal-rs/issues/6) |
| T13 | **Scientific and odd inputs:** `1E-29`, `50000E15`, `1e99999999999999`, `1_1.2_2`, `1.23abc`. Each either parses exactly or errors, quickly and without panicking. Output never uses exponent notation, and `Display` output always re-parses. | rust_decimal [#704](https://github.com/paupino/rust-decimal/issues/704), [PR #807](https://github.com/paupino/rust-decimal/pull/807); fastnum [#70](https://github.com/neogenie/fastnum/issues/70); bigdecimal [#109](https://github.com/akubera/bigdecimal-rs/issues/109), [#100](https://github.com/akubera/bigdecimal-rs/issues/100), [#135](https://github.com/akubera/bigdecimal-rs/issues/135) |
| T14 | **Float input:** `Ratio::try_from(f64)` against ducat's binary64 vectors, including 7.9, 0.1, 1652185258.8058286, 20000.000001, and values above 15 significant digits (refused). | rust_decimal [#845](https://github.com/paupino/rust-decimal/issues/845), [#548](https://github.com/paupino/rust-decimal/issues/548); bigdecimal [#103](https://github.com/akubera/bigdecimal-rs/issues/103); fastnum [#26](https://github.com/neogenie/fastnum/issues/26) |
| T15 | **Float output** (if offered, e.g. `to_f64_lossy`) is correctly rounded: `9533848929109301.5` gives `9533848929109302.0`. | rust_decimal [#828](https://github.com/paupino/rust-decimal/issues/828), [#829](https://github.com/paupino/rust-decimal/issues/829) |
| T16 | **serde round trip** in JSON, bincode and postcard, with no f64 anywhere. Bad scales or out-of-range amounts in untrusted input give `Err`, never a panic. Enabling another crate's serde features doesn't change ducat-rs's format. | primitive_fixed_point_decimal [serde_impl.rs](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/src/serde_impl.rs); rust_decimal [#602](https://github.com/paupino/rust-decimal/issues/602), [#857](https://github.com/paupino/rust-decimal/issues/857), [#856](https://github.com/paupino/rust-decimal/issues/856), [#834](https://github.com/paupino/rust-decimal/issues/834), [#854](https://github.com/paupino/rust-decimal/issues/854); rusty-money [PR #139](https://github.com/varunsrin/rusty_money/pull/139); bigdecimal [#151](https://github.com/akubera/bigdecimal-rs/issues/151) |
| T17 | **Postgres NUMERIC decode** of `NaN`, `Infinity`, `1e32`, `1e-130`, `0.100…0001` (scale above the currency's), values beyond `i128`, zero, and trailing-zero scales. Each gives an exact value or an `Err`, never a panic or a silent change. Encode followed by decode preserves the scale. | rust_decimal [#655](https://github.com/paupino/rust-decimal/issues/655), [#852](https://github.com/paupino/rust-decimal/issues/852), [#853](https://github.com/paupino/rust-decimal/issues/853), [#645](https://github.com/paupino/rust-decimal/issues/645), [#564](https://github.com/paupino/rust-decimal/issues/564), [#763](https://github.com/paupino/rust-decimal/issues/763); sqlx [#3052](https://github.com/transact-rs/sqlx/issues/3052), [#3015](https://github.com/transact-rs/sqlx/issues/3015), [#2247](https://github.com/transact-rs/sqlx/issues/2247); fastnum [#41](https://github.com/neogenie/fastnum/issues/41) |
| T18 | **Hash agrees with Eq** under ducat's equality rule (amount, currency and scale), including 1.0 against 1.00 and `Money<Eur>` against an `AnyMoney` in EUR. | bigdecimal [#23](https://github.com/akubera/bigdecimal-rs/issues/23); fastnum [#59](https://github.com/neogenie/fastnum/issues/59); rust_decimal [#858](https://github.com/paupino/rust-decimal/issues/858) |
| T19 | **Ord is a total order** (sorting never panics), and order is consistent with Eq. | fastnum [#21](https://github.com/neogenie/fastnum/issues/21), [#22](https://github.com/neogenie/fastnum/issues/22) |
| T20 | **`Ratio` overflow returns an error everywhere it can arise**, including where the reduced result fits but intermediate values don't. Covers `1/3000000000 ÷ 3080000000`, `floor`/`ceil` near `i128::MAX`, `i128::MIN` negation, and 0/0. | num-rational [#117](https://github.com/rust-num/num-rational/issues/117), [#143](https://github.com/rust-num/num-rational/issues/143), [#72](https://github.com/rust-num/num-rational/issues/72), [#73](https://github.com/rust-num/num-rational/issues/73), [#6](https://github.com/rust-num/num-rational/issues/6) |
| T21 | **Typed `+`/`-` overflow panics in release builds too**, never wraps. Every `checked_*` method returns `Err(Overflow)`. | primitive_fixed_point_decimal [const_scale_fpdec.rs L417-L424](https://docs.rs/crate/primitive_fixed_point_decimal/1.6.0/source/src/const_scale_fpdec.rs); rusty-money [PR #134](https://github.com/varunsrin/rusty_money/pull/134) |
| T22 | **Conversion results carry an explicit rounding** and are never left at unbounded scale. Inverting a rate and converting back follows the spec. | rusty-money [exchange.rs L58-L67](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/exchange.rs#L58-L67), [#51](https://github.com/varunsrin/rusty_money/issues/51) |
| T23 | **Wei-scale crypto amounts:** `40891626854930000000000` at scale 18 fits and round-trips. | rusty-money [#100](https://github.com/varunsrin/rusty_money/issues/100) |
| T24 | **Locale-driven parsing:** `"2.000"` and `"2,00"` in EUR depend on the *locale*, not the currency. A bare `"2.00"` with an explicit locale parses as 2. | rusty-money [#61](https://github.com/varunsrin/rusty_money/issues/61) |

### 6.2 What the evidence says about the draft's choices

| draft choice | verdict | evidence |
|---|---|---|
| **1. `i128` minor units at an explicit scale, no bigint** | **Supported.** | Every decimal crate here rounds silently somewhere: underflow in checked operations, parsing, serde, or DB decode ([#515](https://github.com/paupino/rust-decimal/issues/515), [#569](https://github.com/paupino/rust-decimal/issues/569), [#838](https://github.com/paupino/rust-decimal/issues/838), decimal-rs [#6](https://github.com/yashan-technologies/decimal-rs/issues/6), fastnum's inexact flag). Scale drift that depends on evaluation order ([#695](https://github.com/paupino/rust-decimal/issues/695)) is impossible with an explicit scale. `i64` is too small: wei amounts already exceed it ([#100](https://github.com/varunsrin/rusty_money/issues/100)), and i128 holds them. The unbounded types show the costs ducat-rs avoids by not porting bigint: hangs and memory blow-ups (bigdecimal [#109](https://github.com/akubera/bigdecimal-rs/issues/109), [#125](https://github.com/akubera/bigdecimal-rs/issues/125), [#135](https://github.com/akubera/bigdecimal-rs/issues/135)). **Caveat:** i128 rounding division is easy to get wrong (primitive_fixed_point_decimal's three CHANGELOG fixes), so T10 and T11 should be property tests against a reference. |
| **2. Typed `Money<C>` plus dynamic `AnyMoney`** | **Supported, with one decision to make.** | Users want dynamic money ([#66](https://github.com/varunsrin/rusty_money/issues/66)). rusty-money gave up on compile-time currencies "for complexity" ([PR #119](https://github.com/varunsrin/rusty_money/pull/119)); doubloon shows that both together work. Owned ZST markers avoid rusty-money's `&'a T` lifetime problem ([#93](https://github.com/varunsrin/rusty_money/issues/93), [PR #130](https://github.com/varunsrin/rusty_money/pull/130)). **Decision:** doubloon puts `Add<Output = Result<…>>` on dynamic values, so `a + b + c` doesn't type-check and needs `and_then`. The draft's `Result`-returning methods are cleaner. Add `try_sum` over iterators, and cross-type `PartialEq` between `Money<C>` and `AnyMoney` (doubloon L348-L390). |
| **2b. Currency equality** | **Define by code.** | rusty-money compares all metadata, so a USD with a different symbol counts as a different currency ([iso_currencies.rs L29-L42](https://github.com/varunsrin/rusty_money/blob/v0.5.1/src/currency/iso_currencies.rs#L29-L42)). doubloon compares by code. ducat-rs should compare by code (plus the custom-currency identity) and never by display data. |
| **3. `Result` for fallible operations; typed add/sub panic on overflow** | **Supported, with a refinement.** | rust_decimal, decimal-rs, dec and bigdecimal all have panicking operators. rusty-money moved off them ([PR #119](https://github.com/varunsrin/rusty_money/pull/119), [PR #134](https://github.com/varunsrin/rusty_money/pull/134)), and panics on untrusted input are a DoS ([sqlx #3052](https://github.com/transact-rs/sqlx/issues/3052)). Overflow in typed `+` is only reachable with amounts near 1.7 × 10³⁸, so the panic is acceptable **provided every boundary is panic-free** (parse, serde, DB, f64, `Ratio`). **Refinement:** "panic on overflow, like integer overflow in debug" reads as though release builds might wrap, as primitive_fixed_point_decimal's `Add` does. State that it always panics (`checked_add().expect(..)`). |
| **4. Rounding is an argument, never ambient; nine Intl modes plus `Unnecessary`** | **Strongly supported.** | Default rounding is the most common user complaint across these crates: rust_decimal [#777](https://github.com/paupino/rust-decimal/issues/777), [#765](https://github.com/paupino/rust-decimal/issues/765), [#706](https://github.com/paupino/rust-decimal/issues/706); bigdecimal [#149](https://github.com/akubera/bigdecimal-rs/issues/149). Defaults also differ between operations: half-even `round_dp`, division ties with no guaranteed rule ([#843](https://github.com/paupino/rust-decimal/issues/843)), truncating `{:.2}` ([#895](https://github.com/paupino/rust-decimal/issues/895)). Some are set by build-time environment variables (bigdecimal [build.rs](https://docs.rs/crate/bigdecimal/0.4.11/source/build.rs), fastnum [#19](https://github.com/neogenie/fastnum/issues/19)), and dec's differ by type. No Rust crate has `Unnecessary`. The Intl names match fixed_decimal exactly (§4.1). |
| **5. `Ratio`: reduced i128 numerator and denominator with an overflow error; decimal strings; binary64 rule** | **Supported; don't build on num-rational.** | num-rational's operators panic where the reduced result fits ([#117](https://github.com/rust-num/num-rational/issues/117)), `floor`/`ceil` overflow ([#143](https://github.com/rust-num/num-rational/issues/143)), and it can't parse decimals ([#131](https://github.com/rust-num/num-rational/issues/131)). Write ducat-rs's own checked `Ratio` with cross-reduction before multiplying. The float rule is justified by rust_decimal's narrowing and retaining paths both being wrong in different ways ([#845](https://github.com/paupino/rust-decimal/issues/845), [#548](https://github.com/paupino/rust-decimal/issues/548), [#438](https://github.com/paupino/rust-decimal/issues/438)). |
| **6. MSRV 1.85, edition 2024; core no_std + alloc** | **Supported for core; argues against for `ducat-icu`.** | The same MSRV as rusty-money 0.5.1. **But** icu_decimal and icu_experimental 2.4/0.7 require **1.88**, and fastnum requires 1.94. `ducat-icu` needs its own MSRV (at least 1.88), or a pin to older ICU4X. The CI matrix should test that crate's MSRV separately. |
| **6b. Default features `std`, `iso`, `serde`** | **Mostly supported; make one rule explicit.** | Having serde on by default is fine; rust_decimal does the same. What breaks users is **cargo features that change the serialization format** (rust_decimal [#602](https://github.com/paupino/rust-decimal/issues/602), [#857](https://github.com/paupino/rust-decimal/issues/857); bigdecimal [#151](https://github.com/akubera/bigdecimal-rs/issues/151); fastnum's build-time deserialize mode). Keep one canonical format, ducat's `{"amount":"12.34","currency":"EUR"}`. Put alternatives in `#[serde(with = "ducat::serde::minor")]` modules, never behind features. Never write `f64` to non-human-readable formats (primitive_fixed_point_decimal does). |
| **7. `ducat-icu` on ICU4X; "first check what ICU4X offers"** | **Partly supported.** | `DecimalFormatter` and fixed_decimal are a good base: stable, no_std, with the nine modes. The **currency formatter is not**: it is unstable with a major bump every release ([#8159](https://github.com/unicode-org/icu4x/issues/8159)); it forces CLDR digits with HalfExpand ([formatter.rs L1654-L1670](https://github.com/unicode-org/icu4x/blob/icu%402.4.0/components/experimental/src/dimension/currency/formatter.rs#L1654-L1670)), which conflicts with ISO-scale amounts for HUF, IDR, IQD and MGA; and it has no cash rounding ([PR #8175](https://github.com/unicode-org/icu4x/pull/8175) closed). ICU4X has no parsing and no RBNF ([#595](https://github.com/unicode-org/icu4x/issues/595), [#7803](https://github.com/unicode-org/icu4x/issues/7803) not planned). The draft is right that RBNF must be ducat's own interpreter; parsing must be ducat's own too. |
| **7b. `ducat-sqlx`, `ducat-diesel`** | **Supported, and high-value.** | §5 is the densest bug cluster in the ecosystem. iso_currency's sqlx support is decode-only. Users ask for dynamic money built from database values ([#66](https://github.com/varunsrin/rusty_money/issues/66), doubloon [#8](https://github.com/davestearns/penny-for-your-thoughts/issues/8)). Decode should reject NaN and Infinity, and reject excess scale unless a rounding is given. Encode should preserve scale. |
| **Data generated from ducat's `data/`** | **Strongly supported.** | Hand-edited tables drift. rusty-money has HUF 0 and MGA/MRU 1 against ISO's 2 ([PR #153](https://github.com/varunsrin/rusty_money/pull/153) still open), and iso_currency's subunit fractions were wrong ([#15](https://github.com/zbrox/iso_currency/issues/15)). The two crates disagree on at least three currencies. |
| **`/context` not ported** | **Supported.** | rusty-money ties formatting and parsing to the currency through a 4-value `Locale` ([#61](https://github.com/varunsrin/rusty_money/issues/61), [#107](https://github.com/varunsrin/rusty_money/issues/107)), and users want the locale to come from context. Passing a locale to the formatter is the right split; iso_currency says the same ([#32](https://github.com/zbrox/iso_currency/issues/32)). |

**Not yet decided in the draft, but the evidence forces a choice:**
- **Scale in Eq, Hash and Display.**
  - rust_decimal and rusty-money treat 1.0 and 1.00 as equal but display them differently
    ([#627](https://github.com/paupino/rust-decimal/issues/627), [#105](https://github.com/varunsrin/rusty_money/issues/105)).
  - The spec judges Money on amount, currency **and scale**.
  - Proposed rule: `PartialEq`/`Hash` follow the spec (structural, scale included). A separate value comparison
    (`cmp_value`, or `Ord` on a normalised key) ignores scale. `Display` is exact and canonical.
- **`Display` and format flags.** Pick a rule for `{:.N}`: round half-even, ignore the flag, or document something
  else. Test it (T8). Never truncate.
- **Excess precision (rusty-money [#71](https://github.com/varunsrin/rusty_money/issues/71); doubloon
  [#3](https://github.com/davestearns/penny-for-your-thoughts/issues/3)).** ducat's explicit scale answers this: you
  can hold more digits than the currency's, but only by asking for that scale.
- **Allocation inputs with sub-minor fractions.** Return an error (or apply an explicit rounding argument) instead of
  flooring, as rusty-money does.

### 6.3 Gaps no Rust library fills

ducat's feature set would fill each of these.

| gap | nearest Rust option today |
|---|---|
| Typed and dynamic money with `Result` arithmetic, at production quality | doubloon (3.5k downloads, panics on overflow) |
| Integer minor units in `i128` with explicit scale and currency | rusty-money `FastMoney` (`i64`, no fractional minor units); primitive_fixed_point_decimal (no currency) |
| Nine Intl rounding modes plus `Unnecessary` on a money type | none. rusty-money has 3, rust_decimal 7, and none has `Unnecessary`. |
| Allocation with selectable remainder strategies, instalments, schedules and chunking | rusty-money `allocate` (input-order remainder only, [#103](https://github.com/varunsrin/rusty_money/issues/103)) |
| Cash rounding by jurisdiction | none. ICU4X has the CLDR data but no formatting ([PR #8175](https://github.com/unicode-org/icu4x/pull/8175) closed). |
| ISO 4217 with historic codes, territories and CLDR cash data, generated from primary sources | iso_currency (hand-maintained TSV, no CLDR digits or cash data) |
| Exact rationals from decimal strings and floats, with overflow errors | num-rational (panics, no decimal parsing, [#131](https://github.com/rust-num/num-rational/issues/131)) |
| Conversion with rate metadata, inverse and chained providers, dated snapshots and residuals; ECB, BoC and other parsers | rusty-money `Exchange` (one map, no inverse [#51](https://github.com/varunsrin/rusty_money/issues/51), no rounding) |
| Tax helpers (net + tax = gross exactly), pricing, finance and Excel functions | none |
| Payment processor amount rules (Stripe, Adyen and others) | none |
| Locale-aware money parsing | none. ICU4X has no parsing; rusty-money's is tied to the currency. |
| Money in words (RBNF) | none. ICU4X [#595](https://github.com/unicode-org/icu4x/issues/595) is open and [#7803](https://github.com/unicode-org/icu4x/issues/7803) not planned. |
| Money ÷ money ratio | requested in rusty-money [#154](https://github.com/varunsrin/rusty_money/issues/154) and doubloon [#6](https://github.com/davestearns/penny-for-your-thoughts/issues/6) |
| sqlx and diesel support for money (amount + currency, composite type) | none for money. iso_currency decodes the code only. |
| A shared conformance suite | none. Each crate tests only itself. |

---

## Appendix A: reproductions

The reproductions were run in a throwaway crate (not kept), built with `CARGO_BUILD_JOBS=1`. The dependencies:
- `rusty-money = "=0.5.1"` (features `iso`, `serde`);
- `rust_decimal = "=1.43.0"` (default features, plus `serde-with-float`, `serde-with-str`, `serde-with-arbitrary-precision`);
- `serde_json = "1"` with **`arbitrary_precision`**.

These feature choices affect the serde output shown.

### A.1 rusty-money 0.5.1

| input | output *(our run)* | relevant to |
|---|---|---|
| `Money::from_str("1.005", USD).allocate(vec![1, 1])` | `["0.50", "0.50"]`, sum `1.00`: **0.005 is lost** | T1 |
| `from_major(613, USD).allocate([98,92,98,123,102,92])` | `["99.30","93.22","99.30","124.63","103.34","93.21"]` | [#103](https://github.com/varunsrin/rusty_money/issues/103), T3 |
| same, weights `[123,102,98,98,92,92]` | `["124.63","103.35","99.30","99.30","93.21","93.21"]`: the 102-weight share is 103.34 in one order and 103.35 in the other | [#103](https://github.com/varunsrin/rusty_money/issues/103), T3 |
| `from_major(100_000_000_000_000_000, USD).to_minor_units()` | `0` (and `try_to_minor_units()` gives `Err(Overflow)`) | §2.1 idioms |
| `Display` of `from_str("-0.005", USD)` | `-$0.00` | [#79](https://github.com/varunsrin/rusty_money/issues/79), T7 |
| `Display` of `0.125` and `0.135` USD | `$0.12`, `$0.14` (half-even at display) | §2.1 |
| `Money::from_str("2.000", EUR)` / `("2.00", EUR)` | `Ok(2000.00)` / `Err(InvalidAmount)` | [#61](https://github.com/varunsrin/rusty_money/issues/61), T24 |
| exponents of `iso::HUF`, `MGA`, `MRU` | `0`, `1`, `1` | [PR #153](https://github.com/varunsrin/rusty_money/pull/153), T5 |
| `from_major(100, EUR).div(3)`, then `.mul(3)` | displays `€33,33` (amount `33.333333333333333333333333333`), then `€100,00` (amount `100.00000000000000000000000000`) | [#71](https://github.com/varunsrin/rusty_money/issues/71) |
| `from_str("1.005", USD).round(2, Round::HalfEven)` | `1.00` | |
| `from_str("1.0", USD) == from_str("1.00", USD)`; their serde | `true`; but `{"amount":"1.0","currency":"USD"}` vs `{"amount":"1.00","currency":"USD"}`. They are equal (and hash equal, since `Money` derives `Hash` and Decimal's `Hash` normalizes first, [decimal.rs L2786-L2794](https://github.com/paupino/rust-decimal/blob/1.43.0/src/decimal.rs#L2786-L2794)), yet serialize differently. | T18, §6.2 |

### A.2 rust_decimal 1.43.0

| input | output *(our run)* | relevant to |
|---|---|---|
| `Decimal::from_f64(0.1)` / `from_f64_retain(0.1)` | `0.1` / `0.1000000000000000055511151231` | T14 |
| `round_dp(0)` of `2.5` / `3.5` | `2` / `4` (banker's by default) | [#777](https://github.com/paupino/rust-decimal/issues/777) |
| `from_str("0.12345678901234567890123456789")` (29 fraction digits) | `Ok(0.1234567890123456789012345679)`: **silently rounded** | [#411](https://github.com/paupino/rust-decimal/issues/411), T12 |
| `from_str("1234567890.123456789012345678901")` (31 significant digits) | `Ok(1234567890.1234567890123456789)`: **silently rounded** | T12 |
| `1/3`, then `* 3` | `0.3333333333333333333333333333`, then `0.9999999999999999999999999999` | [#789](https://github.com/paupino/rust-decimal/issues/789) |
| scale of `0.1 * 0.1` | `2` (scales add) | [#632](https://github.com/paupino/rust-decimal/issues/632) |
| `Decimal::MAX.checked_add(1)` | `None` | |
| `Decimal::MAX + 1`; `1 / 0` | panic "Addition overflowed" (arithmetic_impls.rs:161); panic "Division by zero" (arithmetic_impls.rs:219) | §3.1 |
| `0.0000000000001 * 0.0000000000000001` | `0.0000000000000000000000000000`, `is_zero() == true`: **underflow to zero with no error** | [#515](https://github.com/paupino/rust-decimal/issues/515), T12 |
| `12345678901234567.89` through `serde::float` / `serde::str` | `{"v":1.2345678901234568e+16}` (**the cents are lost**) / `{"v":"12345678901234567.89"}` | T16 |
| default serde of `1.10` | `"1.10"` (keeps scale) | |
