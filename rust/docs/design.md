# ducat-rs: design

A Rust port of [@ducatjs/money](https://github.com/public/ducat). It's idiomatic Rust with ducat's feature set,
verified against ducat's language-neutral conformance suite (`@ducatjs/money-spec`, in ducat's `spec/`).

Status: milestones 1 to 7 are done: milestones 1 to 3 (the core, allocation and cash, tax, `Fixed`, `ExactMoney` and
`Rate`), milestone 4 (`finance`, and `excel` for the functions named after Excel's, as in ducat), and milestones 5 to 7
below. Milestone 8 (fuzzing) hasn't started.

### Milestone 5a: policies, pricing, tiers and math

Milestone 5a added rounding policies (`RoundingPolicy`, accepted wherever a mode is, as `impl Into<RoundingInput>`),
pricing, tiers and math, with their vectors in `spec/`.

### Milestone 5b: currency data

Milestone 5b added the currency data (numeric codes, historic codes, territories, crypto units, CLDR's cash
rules and `cash_policy`), generated from `data/` by `tests/it/currency_data.rs` with a drift check, as for ISO. The
ISO exponent, CLDR's display digits and the cash rules stay separate figures.

### Milestone 5c: payment processors

Milestone 5c added the payment processors, one feature and module each under `ducat::processors`, with their
tables generated from `data/` by `tests/it/processor_tables.rs` with a drift check. Integer amounts are `i64`, refused
beyond 2^53 − 1 on the way to the processor as in ducat, and read back whatever their size (ducat refuses only
unsafe JavaScript numbers there, and reads any `bigint`); the `from_*` constructors take a `CurrencyCode`, so only the `&str` lookups are
case-insensitive (Adyen's excepted).

### Milestone 5d1: rates, providers and bags

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

### Milestone 5d2: rate sources

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
  offsets are read), and `src/fetch.ts` (milestone 7b's `ducat-fetch`).

### Milestone 5e: wire formats

Milestone 5e added `ducat::wire` (the default `wire` feature): `GoogleMoney`, `Iso20022Amount`, `MinorUnitAmount`
and `DineroObject`, plain structs with conversions to and from `Money` and `AnyMoney`, and with `serde` each in its
format's JSON shape. Malformed input is an error, never a rounding (`Error::InvalidWire`, `Error::Syntax` for ISO
20022 text). The readers take what the specs allow, as ducat does since #356: ProtoJSON's numbers or strings for
`units` and `nanos`, exponent form included, and `xs:decimal`'s leading sign and `-0`. ducat's rule that a `units`
*number* past 2^53 − 1 is refused is JavaScript's: serde reads JSON integers without loss, so the port has no such
rule. ISO 20022 has no XML in ducat (an amount is its attribute and text), so none here either.

### Milestone 6a: words

Milestone 6a added amounts and numbers in words, in their own crate, `ducat-words`, so a program that wants only words
never pulls in format and parse data (milestone 6c's `ducat-format`). It is ducat's own RBNF interpreter
over CLDR's rule text (`data/rbnf/*.txt`, CLDR 49, embedded by `tests/it/rules.rs` with a drift check, without its comment
lines as ducat's generator drops them), one feature per language: `en` (4,081 bytes of rules), `de` (8,506), `fr`
(4,312), `es` (5,829), `it` (11,871), `nl` (2,284), `pt` (4,676), about 41 KB in all, so every language is a default. Values are `i128` within ±(2^63 − 1), ICU's range;
recursion is bounded, so adversarial rule text is an error, not a stack overflow. Plural rules (cardinal and ordinal),
the digit grouping of numbers the rules write as digits (separator and minimum grouping digits), and the word for "and"
come from the CLDR 48 snapshot (`data/cldr/`), generated into `src/cldr.rs` by `tests/it/cldr.rs` with a drift check, as the
rule text is; ducat reads them from `Intl`, CLDR 48 on Node 24. The rule text is CLDR 49 and these values
CLDR 48, the release ducat's `Intl` carries. `amount_in_words` takes the currency's names from the caller, as both take the minor unit's.

#### Currency names in words

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

### Milestone 6c: format and parse

Milestone 6c added locale formatting and parsing, in their own crate, `ducat-format`, from CLDR 48's data and ducat's own
code, with no ICU. ICU4X was the plan; ducat chose otherwise because no ICU4X release carries CLDR 48.0 throughout
(`icu_decimal_data` 2.1.1 has 48.0, but `icu_experimental_data` only 48.1, 48.2.x and 49), and its currency formatter
is pre-1.0 experimental and re-rounds to CLDR's digits. ducat's TypeScript formats through the runtime's `Intl`, whose
ICU 78.3 carries CLDR 48, so the crate follows that release and ICU's shipped differences from it:

- **Data:** `tests/it/data.rs` generates `src/data.rs` (numbers, currency symbols, names and formats, unit patterns,
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
  the symbol form uses for that currency in that locale, so `parse` reads it back, the decimal pattern's grouping (lakhs
  in ml, mr and or, as `Intl` writes them), and no symbol, in the
  unit pattern with the plural name (`1,234.50 euros` in en-150, `1,234.567 Kuwaiti dinars` and `1,234.50 euros` in
  en-NL, `1.234,50 euros` in en-AT); never the currency's own pattern or symbol, which ICU's code puts there and
  garbles at other scales (`KWD 1,234.56 Kuwaiti dinars7` on Node 24); ducat's TypeScript is to match (ducat#363).
- **Conformance:** the core runner delegates `format.money`, `parse.money` and `parse.detect` to `ducat-format`'s own
  spec test (2,538, 1,629 and 1,757 rows, all passing, the icu-overrides files included). Its proptests round-trip
  format and parse in every built locale and feed arbitrary tags, options, amounts and text to the public API.

#### Coverage

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
locale. What Node 24 (ICU 78.3) and `ducat-format` resolve, checked in `tests/it/locale.rs` and `tests/it/runtime.rs`:

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
ht) and nb-SJ have CLDR's data here, where `Intl` falls back; sr-Cyrl-ME's currency names are CLDR's Cyrillic ones,
not ICU's Latin; and pt-CV's names are written as TR35 has them (`1 234 567$88 dólares dos Estados Unidos`), where ICU
puts the region currency's own pattern and a symbol inside them (`1 234 567$88 US$ dólares dos Estados Unidos`), as it
did in the euro-country English locales before ducat#363. As in ducat since ducat#364, `parse` takes the expected currency's own code, symbol, narrow
symbol and long names (from the CLDR tables) as a whole beside the number, whatever their characters, and they add no
sign: PEN's `S/` in es-PE and CLF's `Chilean units of account (UF)` read back exactly, and anything else around the number
is still refused. It also takes a long name's number grouped in the decimal pattern, as `Intl` writes it (lakhs in ml, mr
and or).

### Milestone 7b: fetching rates

Milestone 7b added ducat's `./convert/fetch` entry (`src/fetch.ts`: `fetchEcb`, `fetchEcbRange`, `fetchBankOfCanada`,
`ECB_URLS`, `ECB_DATA_API`, `BANK_OF_CANADA_URL`, `FetchRatesError`) as its own crate, `ducat-fetch`, the only code
of the port that touches the network. It reuses `ducat::convert`'s `ecb` and `boc` parsers.

- **Layout:** `crates/ducat-fetch/src/` has `transport.rs` (`Request`, `Response`, the `Transport` trait,
  `TransportError`), `ecb.rs` and `boc.rs` (the sans-IO core and the blocking fetchers), `error.rs` (`FetchError`,
  `Feed`) and `ureq.rs` (`UreqTransport`, behind the `ureq` feature). The README is the crate's front page
  (`#![doc = include_str!]`), with the blocking, own-transport and async examples compiled as doctests.
- **Sans-IO core:** `ecb_request`, `ecb_range_requests` and `bank_of_canada_request` build the GETs (URL and query,
  `accept` header) exactly as `fetch.ts` does, checking the options first; `ecb_tables`, `ecb_range_tables` and
  `bank_of_canada_tables` turn a status and body into `RateTable`s with `fetch.ts`'s rules: the eurofxref file for
  `history`, `available_at` passed to the ECB parsers (Valet's parser keeps its default, `Stated`, as ducat passes
  none), the range's two requests (`detail=nodata` for DECIMALS, `detail=dataonly` for the observations, merged by
  `parse_ecb_sdmx_csv`'s `decimals`), a 404 for the range's data as no tables, and Valet's `recent=1`,
  `start_date` and `end_date`. `fetch_ecb`, `fetch_ecb_range` and `fetch_bank_of_canada` drive the core through a
  `&mut impl Transport`; any `FnMut(&str, &[(&str, &str)]) -> Result<Response, TransportError>` is one. There is no
  async API and no runtime: an async user calls the core around their own client (the README's example).
- **Errors:** `FetchError` is `#[non_exhaustive]`, `Display` (ducat's messages) and `std::error::Error` (with
  `source`): `Status { url, status }` is `FetchRatesError`; `Parse { url, source: ducat::Error }` is the
  `SyntaxError` with ` (from url)`; `Transport { url, source }` is the platform fetch's rejection;
  `InvalidCurrency`, `StartTooEarly`, `EndBeforeStart` and `EndWithoutStart` are the `RangeError`s ducat throws
  before any request. `TransportError` has a kind (`Timeout`, `Cancelled`, `Other`) and a boxed source.
- **Dependencies:** `ducat` (`default-features = false`, features `std`, `ecb`, `boc`); `ureq` 3, optional, the
  default `ureq` feature, with `default-features = false, features = ["rustls"]`. ureq's `rustls` feature is
  `rustls-no-provider` (rustls, rustls-pki-types), `_ring` (`rustls/ring`) and `rustls-webpki-roots` (the Mozilla
  roots compiled in), so rustls's provider is ring, not aws-lc-rs: no cmake, NASM or Go, only `cc` for ring's C and
  assembly. Not enabled: `gzip` (ureq's default), `brotli`, `charset`, `json`, `cookies`, `native-tls`,
  `platform-verifier`, `socks-proxy`. No tokio, reqwest or hyper. `cargo tree -p ducat-fetch -e normal` lists 25
  crates besides the two ducat crates (num-bigint, num-integer and num-traits through ducat; the rest through ureq:
  base64, http, bytes, itoa, httparse, log, percent-encoding, rustls, rustls-pki-types, rustls-webpki, ring,
  untrusted, getrandom, libc, cfg-if, once_cell, subtle, zeroize, ureq-proto, utf8-zero, webpki-roots); without
  `ureq`, only ducat's. ureq 3.5, ureq-proto and zeroize declare Rust 1.85 and the rest less, so the crate keeps the
  workspace's MSRV, 1.85.
- **Divergences from ducat:**
  - `signal`, `timeout` and `fetch` aren't options: cancellation and timeouts are the transport's, and the transport
    replaces `fetch`. `UreqTransport::new()` has ducat's 30-second default, as ureq's `timeout_global` (connection
    to last byte); `with_timeout(None)` is `timeout: 0`; `from_agent` takes the caller's `ureq::Agent`. ducat's
    `RangeError` for a negative or non-finite timeout can't arise (`Duration`).
  - `fetchEcbRange` starts both requests at once and aborts the other when one fails; `fetch_ecb_range` makes them
    one after the other, the series first, and doesn't make the second when the first fails. When both fail, ducat
    reports whichever failed first in time; the port reports the series' error.
  - Days are `ducat::convert::Date`, so ducat's `start must be a date` and `end must be a date` are the caller's
    `Date` parse error, and a JavaScript `Date`'s UTC day has no counterpart. `history` is the `EcbHistory` enum
    (`Daily`, `NinetyDays`, `All`) and `ECB_URLS` a struct (`daily`, `ninety_days`, `all`; `'90d'` isn't a Rust
    name). `availableAt`'s type check (`checkAvailableAt`) is the type system's.
  - Currencies are `&[&str]` checked as ducat checks them (three ASCII capitals), so a code ducat accepts the port
    accepts, whether or not ISO 4217 lists it.
  - The body is read as UTF-8 with replacement characters, as `Response.text()` does. `UreqTransport` limits it to
    64 MiB by default (`body_limit`; the full SDMX history is about 15 MB): ureq's own default is 10 MB.
  - No global fetch, so ducat's `No fetch available` error has no counterpart.
- **Tests:** `tests/it/fetch.rs` reads the fixtures ducat's fetch tests read (`spec/fixtures/ecb/eurofxref-daily.xml`,
  `ecb/eurofxref-hist-2d.xml`, `ecb-sdmx/exr-d-nodata.csv`, `ecb-sdmx/exr-d-dataonly.csv`,
  `boc/fx-rates-daily.json`) in place, through a fake transport that records each request; the URLs and headers are
  asserted as literals, byte for byte, and were checked against `fetch.ts` run under vitest with a recording fetch.
  `spec/vectors/` has no fetch area, so there is no spec test; a test fails if one appears. `tests/it/live.rs` calls the
  real endpoints through `UreqTransport` and is `#[ignore]`d: CI makes no requests.

### Milestone 7c, part 1: sqlx

Milestone 7c, part 1, added `ducat-sqlx`, money columns for sqlx 0.8: the counterpart of ducat's `./pg` and of the
column shapes `./drizzle/mysql` and `./drizzle/sqlite` (through `src/sql.ts`) store.

- **Layout:** `crates/ducat-sqlx`, with a feature per database, `postgres` (the default, as ducat's `./pg` is its own
  entry), `mysql` and `sqlite`, each enabling only the matching sqlx feature. The crate picks no runtime, TLS backend
  or macros; the application's sqlx does. Without a database feature it still has the database-neutral types and
  checks. Modules: `pg` (`postgres`), `mysql`, `sqlite`; the types are at the root.
- **Types** (no impls on `Money`/`AnyMoney` themselves: the orphan rule forbids them, and a column's shape is a choice):
  - `Decimal`: an exact NUMERIC/DECIMAL value, ducat's `Int` and a scale (at most `MAX_SCALE`, 1000), with no
    currency. Postgres NUMERIC, MySQL DECIMAL and SQLite TEXT decode to it; `to_money` keeps the scale (never below the
    exponent, as `parseMoneyComposite`), `to_money_at_exponent` reads as `decimalFromDriver` (trailing zeros only).
    Text is `-?[0-9]+(\.[0-9]+)?`, as `parseNumeric`.
  - `DecimalColumn<C>` and `MinorColumn<C>`: ducat's `moneyDecimal` and `moneyMinor`, a fixed currency in the type.
    Writes refuse money at another scale than the exponent (`checkIsoScale`) and minor units beyond ±(2^63 − 1).
  - `minor_units` (`minorToDriver`) and `DecimalColumnSize::fit` (`toNumeric`, with `checkDecimalSize` and
    `checkIntegerDigits`) for money whose currency is in another column, or a sized NUMERIC(p, s).
  - `pg::PgMoney<M>` (`M` is `AnyMoney` or `Money<C>`, through the sealed `MoneyValue`) and `pg::MoneyRecord` (the
    fields, currency unresolved, for custom currencies): the composite type `ducat_money (amount numeric, currency
    text)`, in Postgres's binary record format and its text (`toMoneyComposite` and `parseMoneyComposite`, ported
    with their quoting). `pg::money_type_sql` is `moneyTypeSql`. Array types (NUMERIC[], BIGINT[], `ducat_money[]`)
    come with each.
  - `Error`, `#[non_exhaustive]`: `NotANumber`, `Infinite`, `Malformed`, `UnexpectedType`, `OutOfRange`,
    `ScaleMismatch`, `CurrencyMismatch`, `UnknownCurrency`, `NullField`, the column-size errors and `Ducat`.
- **NUMERIC's binary format** is read and written in `pg::decode_numeric` and `pg::encode_numeric`, from the
  base-10000 digits, weight, sign and display scale straight to the decimal digits of `Int` and back: no float, no
  `rust_decimal` or `bigdecimal`, and not sqlx's own `PgNumeric` (crate-private, and its decoder panics on a
  truncated buffer). `NaN` and `±Infinity` (Postgres 14's signs) are refused; so are digits beyond 9999, a
  length that doesn't match the digit count, and non-zero digits the display scale would hide, which Postgres's
  `numeric_recv` truncates silently. Encoding writes Postgres's canonical form (no leading or trailing zero digits,
  zero as no digits). The text format is read too: the simple protocol (`sqlx::raw_sql`) returns text.
- **Strict readers, per database:** MySQL sends DECIMAL as text in both protocols; a FLOAT/DOUBLE or BIGINT
  UNSIGNED value is refused even through `try_get_unchecked`, because sqlx's integer decoding reads any eight bytes.
  SQLite types values, not columns, so each value's storage class is checked: sqlx would otherwise convert a REAL to
  text or truncate it to an integer.
- **Differences from ducat's TypeScript:** `AnyMoney` reads only ISO 4217 codes from the composite (custom codes
  aren't registered anywhere in the port; read a `MoneyRecord` and give its `CurrencyCode`, or use a
  `define_currency!` type); parameters are sent as the type named `ducat_money` (a composite of another name or
  schema still decodes, by its `(numeric, text)` fields); record text with a backslash before its closing
  parenthesis is refused, where `parseRecord` reads the `)` into the field (Postgres refuses it too); a NUMERIC
  display scale beyond 1000 is refused (ducat's limit; Postgres allows 16383).
- **Not in part 1:** the JSON column shapes (`moneyJson`, `jsonToDriver`), which need sqlx's `json` feature and
  serde; `exactTypes`, `parseArray` and `moneyTypeOids`, which configure node-postgres's text parsers and have no
  counterpart in sqlx (it decodes by type, and resolves type names itself).
- **sqlx quirk handled:** in the simple protocol sqlx leaves custom types unresolved and `PgTypeInfo::kind()` panics
  on them; `PgMoney`'s compatibility check never calls it on an unresolved type.
- **Tests** (`tests/it/`, one binary): the NUMERIC codec against hand-built wire bytes (0, −0, 2^63 ± 1, i128's limits,
  10^±1000, every scale 0 to 1000, trailing zeros, negative weights, malformed and special values), proptests with
  `ducat::testing` (round trips, an independent model of the digits, arbitrary bytes and text never panicking, the
  `toNumeric` property), the composite's text against `test/pg.test.ts`'s cases, SQLite in memory, and Postgres and
  MySQL against `DUCAT_PG_URL` and `DUCAT_MYSQL_URL` (skipped without them, failing without them when
  `DUCAT_REQUIRE_DB=1`), run in CI against the same digest-pinned postgres:18 and mysql:8.4 services as ducat's
  TypeScript database tests.
- **Dependencies (normal):** `ducat` (without default features, with `std`), and `sqlx` 0.8 with
  `default-features = false` and only `postgres`, `mysql` or `sqlite` as chosen. sqlx's `sqlite` feature builds
  SQLite from source (`libsqlite3-sys/bundled`, with a C compiler); sqlx's `sqlite-unbundled` isn't offered yet.
  Dev-dependencies: `ducat` with `iso` and `proptest`, `proptest`, `sqlx` with `runtime-tokio`, and `tokio` (`rt`,
  `macros`). sqlx 0.8.6 and every dependency it resolves to need Rust 1.85 at most, so the crate keeps the
  workspace's MSRV (CI checks it); sqlx 0.9 needs 1.94 and isn't used.

### Milestone 7c, part 2: the shared SQL core

Milestone 7c, part 2, first moved the database-library independent half of `ducat-sqlx` into an internal crate,
`crates/ducat-sql-core` (`publish = false`, depending on `ducat` alone, no sqlx or diesel), so that `ducat-diesel` shares
it instead of copying it:

- **What moved:** the exact decimal (units and scale) with its text grammar and `Display`, `to_money` and
  `to_money_at_exponent`; NUMERIC(p, s) sizes with `check_currency` and `fit` (`toNumeric`); `check_exponent_scale`
  (`checkIsoScale`); Postgres NUMERIC's base-10000 digits (`numeric::Numeric`, with `to_decimal` and `from_decimal`) and
  its binary format; the composite's binary record and text forms and `money_type_sql`. Those are the parts that have
  to be exactly right, and now have one implementation, tested through both crates' suites.
- **What can't move:** the public types. sqlx's `Type`/`Encode`/`Decode` and diesel's `ToSql`/`FromSql`/`AsExpression`
  can only be implemented for a crate's own types (the orphan rule), so `Decimal`, `DecimalColumnSize`,
  `DecimalColumn<C>`, `MinorColumn<C>`, `MoneyValue`, `MoneyRecord`, `PgMoney<M>` and `Error` stay in each crate.
  `Decimal` and `DecimalColumnSize` are newtypes over the core's (private fields, `Debug` unchanged), each crate's
  `Error` converts from the core's `Error`, and their docs and examples stay where users read them. `ducat-sqlx`'s
  public API is unchanged.
- **Why not duplicate:** the shells left in each crate are mostly documentation; the copied logic would have been the
  NUMERIC conversion, the decimal grammar, the size checks and the record parser, where a fix in one crate and not the
  other would make the two disagree on what a column holds.

### Milestone 7c, part 2: diesel

Milestone 7c, part 2, then added `ducat-diesel`, money columns for diesel 2: the diesel counterpart of `ducat-sqlx`,
with the same types, errors, checks, docs and test cases, on `ducat-sql-core`.

- **Layout:** `crates/ducat-diesel`, with `postgres` (the default), `mysql` and `sqlite`, each enabling the matching
  diesel backend. Modules `pg` (with `pg::sql_types::DucatMoney`), `mysql`, `sqlite`; the types are at the root and
  carry diesel's `AsExpression` and `FromSqlRow` derives: `Decimal` and `DecimalColumn<C>` as `Numeric` (and `Text`
  with `sqlite`), `MinorColumn<C>` as `BigInt`, `PgMoney<M>` and `MoneyRecord` as `DucatMoney`.
- **Backends without client libraries:** `postgres` is diesel's `postgres_backend` and `mysql` its `mysql_backend`,
  both pure Rust: the types and their `ToSql`/`FromSql`, no connection. diesel's `postgres` and `mysql` features would
  add `PgConnection` and `MysqlConnection`, which link libpq and libmysqlclient (or build them from source through
  pq-sys's and mysqlclient-sys's `bundled` options, not tried here); the application chooses those, or diesel-async's pure-Rust
  connections, and the crate works with either. `sqlite` is diesel's `sqlite` with `libsqlite3-sys/bundled`: SQLite
  built from source with a C compiler and no system library, as ducat-sqlx's `sqlite` (sqlx bundles too). The box
  this was built in has no libpq, no libmysqlclient and no SQLite development files, and every feature builds and
  tests there, so CI enables them all.
- **Postgres NUMERIC** goes through diesel's own `PgNumeric` (`diesel::pg::data_types`, public), converted exactly
  by `TryFrom` both ways through the core's base-10000 digits: never diesel's `numeric` feature (bigdecimal) nor
  `rust_decimal`. diesel 2.2's `PgNumeric` has no infinities (its reader refuses their signs with an error of its own)
  and ignores bytes after the digits, so `FromSql` checks the header first: `NaN`, `±Infinity`, a wrong length and a
  negative digit count are the crate's errors. `PgNumeric`'s digits are `i16`; a negative one is malformed. diesel
  reads Postgres in the binary format only, so there is no text path.
- **The composite:** `pg::sql_types::DucatMoney` is `#[diesel(postgres_type(name = "ducat_money"))]`, looked up by
  name on the `search_path`; `diesel print-schema` is pointed at it with `import_types` and
  `generate_missing_sql_type_definitions = false`. Writes use diesel's record support (`WriteTuple<(Numeric, Text)>`)
  cleanly. Reads don't: diesel 2.2's `FromSql` for `Record<...>` slices by the length a field claims and panics on a
  truncated record (a test shows it), and reports a NULL field as its generic unexpected-null error, so reads use the
  core's binary record reader, the one ducat-sqlx uses. Composites of another name read as `Record<(Numeric, Text)>`
  (where sqlx decodes them by their fields); arrays are diesel's.
- **Strict readers:** MySQL values are checked by their own type, whatever the schema claims: DECIMAL or a string for
  decimals; TINYINT to BIGINT, signed, for minor units, read in native order as diesel does, refusing FLOAT, DOUBLE,
  DECIMAL and the unsigned types (diesel's own integer reading truncates floats and indexes short buffers out of
  bounds). SQLite checks each value's storage class, as ducat-sqlx.
- **Errors:** `Error` has ducat-sqlx's variants. A read error reaches the caller as diesel's `DeserializationError`,
  whose box holds a `DeserializeFieldError` naming the field, whose `error` downcasts to `Error`; a write error as
  `SerializationError`, whose box downcasts to it.
- **Tests** (`tests/it/`, one binary): ducat-sqlx's cases, ported. NUMERIC against hand-built wire bytes through
  diesel's `FromSql` (`PgValue::new`) and its `RawBytesBindCollector`, so the bytes are the ones a connection sends,
  plus `PgNumeric` both ways; the composite's text, binary record, `ToSql` through `WriteTuple` with a stub metadata
  lookup, arrays, and diesel's own reader panicking; MySQL values built by hand (`MysqlValue::new`); proptests;
  SQLite in memory through diesel's `SqliteConnection`; Postgres and MySQL through diesel-async's
  `AsyncPgConnection` and `AsyncMysqlConnection` behind `DUCAT_PG_URL` and `DUCAT_MYSQL_URL`, run in CI's
  `sql-databases` job (formerly `sqlx-databases`) against the same services.
- **Dependencies (normal):** `ducat` (without default features, with `std`), `ducat-sql-core`, `diesel` 2.2
  (`default-features = false`; `postgres_backend`, `mysql_backend` or `sqlite` as chosen) and, with `sqlite`,
  `libsqlite3-sys` with `bundled` (`>=0.30, <0.41`: a `links` crate exists once in a build, so the range spans what
  diesel 2.2 to 2.4 accept and unifies with theirs). Dev-dependencies: `ducat` with `iso` and `proptest`, `proptest`,
  `diesel` with `i-implement-a-third-party-backend-and-opt-into-breaking-changes` (only for `PgValue::new`,
  `MysqlValue::new` and the bind collector's fields in the tests; diesel-async enables it anyway), `diesel-async`
  0.5 with `postgres` and `mysql` (tokio-postgres and mysql_async, pure Rust), and `tokio` (`rt`, `macros`).
- **MSRV:** diesel 2.2.12 and its dependencies need Rust 1.78 at most, so the crate keeps the workspace's 1.85 and the
  lockfile stays on diesel 2.2 (2.3 needs 1.86, 2.4 1.88). The requirement `2.2` admits them; the library was checked
  against diesel 2.4.0 outside the workspace and compiles unchanged.

### Known gaps

Known gaps, to close later:
- `snapshots` and `snapshotsFrom` (asynchronous loaders), and Adyen's IANA time zones.
- The JSON column shapes (`moneyJson`, `jsonToDriver`) in `ducat-sqlx` and `ducat-diesel`.
- CLDR's currency names as defaults for `ducat-words`' `amount_in_words` (the caller passes them).
- Fuzzing (milestone 8).

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
6. **MSRV and edition:** Rust 1.85, edition 2024 (`ducat`'s `proptest` feature needs 1.88).
   - The core is `no_std + alloc` (formatting and I/O behind `std`).
   - The default features are all of `ducat`'s but `proptest`.
7. **Layout:** a cargo workspace.
   - `ducat` holds core, allocate, tax, math, convert (rates and providers, without fetchers), cash, policy, pricing,
     exact, fixed, finance, excel, the currency data, the processors, wire and testing, each behind a feature.
   - Separate crates hold heavy or optional data and dependencies: `ducat-words` (amounts in words), `ducat-format`
     (format and parse, on CLDR's data), `ducat-sqlx`, `ducat-diesel` (on the internal `ducat-sql-core`) and
     `ducat-fetch` (rate fetchers: sans-IO, with a blocking ureq transport; reqwest was the plan, M7b chose otherwise
     to need no async runtime).
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
7. **Boundaries are strict and never panic.** Parsing, serde and the database decoders return errors for
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
9. **The ISO table is committed generated code.** `tests/it/iso_table.rs` is the generator (it reads the repository's
   `data/iso4217-list-one.xml`) and fails when `src/iso_table.rs` is stale; `DUCAT_REGENERATE=1` rewrites it.
10. **Features:** `std`, `iso` (the marker types; the ISO table itself is always present, since `CurrencyCode`
    parsing needs it) and `serde`, all default.
11. **Dependencies:** num-bigint, num-integer and num-traits (without default features, so the core stays
    `no_std + alloc`), for amounts beyond `i128`; serde, optional; proptest (without default features, with `std`),
    optional, for the `proptest` feature (`ducat::testing`, which re-exports it). For tests, `serde_json` (reading the
    vectors) and `proptest`. The runner checks the vector files' structure by hand rather than with a JSON Schema
    crate. proptest needs Rust 1.88, so the 1.85 MSRV applies to the library without the `proptest` feature, not to
    the feature or the tests. The feature implies `std`; `no_std` builds without it are unaffected.

## Mapping ducat's entries
| ducat entry | ducat-rs | notes |
|---|---|---|
| `.` (core), `/fn` | `ducat` core: `Money`, `AnyMoney`, methods plus free functions where natural | Rust doesn't need ducat's /fn split: unused methods cost nothing |
| `/iso`, `/iso/*`, `/currencies`, `/territories`, `/historic`, `/crypto` | `ducat::iso` (markers plus the table), `currencies`, `territories`, `historic`, `crypto` features | static tables, no registration step |
| `/allocate` | `allocate` (allocate, split, instalments, schedule, chunk) | the Lean vectors apply |
| `/tax`, `/math`, `/exact`, `/policy`, `/pricing`, `/cash` | features of the same names | `cash::cldr_cash` is Rust-only (no ducat equivalent; the spec checks it against `data/` only) |
| `/fixed`, `/fixed/money` | `ducat::fixed::Fixed` | |
| `/finance`, `/excel` | `finance`, `excel` | the Excel rule applies to `excel` |
| `/convert`, `/convert/{ecb,boc,fed,boe,hmrc,history}`, `/stripe-fx`, `/adyen-fx` | `convert` plus parsers | rates with metadata, providers and `MoneyBag` in `convert` (5d1); the parsers, a feature each, take text and never fetch (5d2) |
| `/convert/fetch` | `ducat-fetch` (M7b): `fetch_ecb`, `fetch_ecb_range`, `fetch_bank_of_canada` over a `Transport`, the sans-IO request and table functions, `ECB_URLS`, `ECB_DATA_API`, `BANK_OF_CANADA_URL`, `FetchError`; `UreqTransport` behind the default `ureq` feature | network code only here; timeouts and cancellation are the transport's |
| `/stripe`, `/adyen`, `/checkout`, `/paypal`, `/braintree`, `/klarna` | `processors::{stripe,…}`, a feature each | conversions are methods on `Money` and `AnyMoney`; the FX files are `stripe-fx` and `adyen-fx` (5d2) |
| `/wire` | `wire` (google.type.Money, ISO 20022, minor units, dinero objects) | ported in 5e |
| `/words`, `/words/*` | `ducat-words` (6a) | its own interpreter, no ICU |
| `/format`, `/parse` | `ducat-format` (6c) | CLDR 48's data with ICU 78.3's overrides, no ICU; a feature per language |
| `currencyName`, `currencySymbol` | `ducat-format` (6c) | from CLDR, as `currency_name` and `currency_symbol` |
| `/context` | not ported | `Money<Eur>` already binds a currency; a locale goes to the formatter |
| `/zod`, `/valibot` | not ported | TypeScript schema libraries; `serde` covers validation |
| `/pg` | `ducat-sqlx` (`pg`, M7c part 1) and `ducat-diesel` (`pg`, M7c part 2) | exact NUMERIC and BIGINT, the composite type and its DDL (diesel: NUMERIC through `PgNumeric`, the composite as `pg::sql_types::DucatMoney`); `exactTypes`, `parseArray` and `moneyTypeOids` configure node-postgres's parsers and have no sqlx or diesel counterpart |
| `/drizzle/pg`, `/drizzle/mysql`, `/drizzle/sqlite` (and `src/sql.ts` under them) | `ducat-sqlx` and `ducat-diesel` (M7c): `DecimalColumn<C>`, `MinorColumn<C>`, `Decimal`, `minor_units`, `DecimalColumnSize::fit`, in each | the column shapes, not Drizzle (a TypeScript ORM); the JSON shapes (`moneyJson`) aren't ported yet |
| `/prisma`, `/kysely`, `/typeorm` | not ported | adapters for TypeScript ORMs and query builders (Prisma's `Decimal`, Kysely's dialects, TypeORM's transformers) with no Rust counterpart; the storage layouts they support (minor units or a decimal beside a currency column) are `minor_units` and `Decimal` with plain sqlx or diesel (`ducat-diesel`) |
| `/testing`, `/testing/arbitraries` | `ducat::testing`, behind the `proptest` feature (M7a): strategies and `Arbitrary` impls for `Int`, `Money<C>`, `AnyMoney`, `CurrencyCode`, `Rounding`, `RoundingPolicy` and `Ratio`, with `CurrencyOptions` and `MoneyOptions` for ducat's arbitrary options; `assert_money_eq!` and `assert_identical!` | `==` is already by value, so `moneyEquality` needs no counterpart; `Display` and `Debug` already print `12.34 EUR` |
| `/testing/vitest`, `/testing/jest` | not ported | they install matchers, an equality tester and a snapshot serializer on a JavaScript runner's `expect`; Rust's test harness has no `expect` to extend, and the macros, `==`, `Debug` and `Display` cover what they add |
| `/all`, plugins, `extendMoney` | not ported | Rust uses extension traits; there's no prototype to install on |

## Where it lives, and the conformance runner
- **In ducat's repository,** as `rust/` (a cargo workspace), beside `proofs/` and `compare/`. The runner reads `spec/`
  and `data/` from the same checkout, so the Rust port always runs the spec at its own commit: a spec change and the
  Rust change it needs land in one pull request, and there is no vendored copy to drift. `rust/` is not part of the
  npm package.
- **The runner:** `rust/crates/ducat/tests/it/spec.rs` maps each neutral operation to the Rust API. It runs every vector
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
5. **Currency data:** ISO, historic, territories, cash rules and processors, with vectors added to ducat's spec first,
   from an independent source.
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
