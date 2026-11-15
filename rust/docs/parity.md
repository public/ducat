# ducat-rs: API parity with ducat's TypeScript

Every public item of ducat's TypeScript API, entry by entry as `package.json`'s `exports` maps them, against the Rust
port. The spec vectors (`spec/`) check behaviour; this table is about surface: functions, members, options fields and
error kinds. [`design.md`](design.md) has the reasons; this page links them.

`scripts/check-rust-parity.mjs` keeps the table complete: it reads the built declarations (`dist/**/*.d.ts`) with
TypeScript's compiler API and fails, listing them, when an export, member or options field has no row here, when a row
names one that no longer exists, when a status isn't one of those below, when a `design.md` link doesn't resolve, or
when a `missing` row isn't in [Missing, in proposed order](#missing-in-proposed-order). Run it with
`pnpm parity:check` (build and check), or `node scripts/check-rust-parity.mjs` after `pnpm build`; CI runs it in the
`check` job. `--list` prints the tracked rows.

What has a row:
- every export of an entry, by its exported name;
- the public members of exported classes, and of exported interfaces that declare a method: `Money#add` (instance),
  `Rate.lookup` (static);
- the fields of every exported options type (a name ending in `Options`), including those it extends from the
  platform (`FormatOptions` extends `Intl.NumberFormatOptions`);
- `(import)` for an entry that exports nothing (it is imported for its side effects).

An item several entries export has its row once, under the first entry that exports it (the aggregators `./fn` and
`./all` last); a method a plugin adds to `Money` (`declare module`) is under that plugin's entry.

Status:
- `same`: the capability is there. Rust conventions aren't divergences: snake_case, methods for free functions,
  `Result` for throws, arguments or builders for an options object, `Money<C>` and `AnyMoney` for `Money<string>`.
- `divergent: <link>`: there, but deliberately different, as the linked section of `design.md` says.
- `not ported: by design (<reason>)`: left out on purpose, for the reason `design.md` gives.
- `missing`: not there yet. A TS option with no Rust counterpart is `missing` even when the function exists.

Paths are the shortest a user writes (`ducat::Money`, re-exported at the crate root); links go to the source, from
`rust/docs/`.

## Entries

### `.`

The core: [`ducat`](../crates/ducat/src/lib.rs)'s [`Money<C>`](../crates/ducat/src/money.rs) (a typed currency) and [`AnyMoney`](../crates/ducat/src/any.rs) (a runtime `CurrencyCode`), `Int`, `Ratio`, `Rounding` and `Error`. Methods the TS plugins install on `Money` are rows of the plugin's entry.

| TS | Rust | status | note |
|---|---|---|---|
| `CurrencyCode` | [`ducat::CurrencyCode`](../crates/ducat/src/currency.rs) | same | holds the code and its exponent |
| `CurrencyInput` | `ducat::CurrencyCode`, `impl Currency` markers | same | a TS type for "a code or a currency" |
| `CurrencyMismatchError` | `ducat::Error::CurrencyMismatch` | same | typed `Money<C>` makes the mismatch a compile error |
| `CurrencyMismatchError#actual` | `Error::CurrencyMismatch { actual }` | same | |
| `CurrencyMismatchError#expected` | `Error::CurrencyMismatch { expected }` | same | |
| `CurrencyMismatchError#name` | `ducat::Error::kind` | same | |
| `CustomCurrencies` | `ducat::define_currency!` | not ported: by design (no registry: currencies carry their exponent, `CurrencyCode::custom`) | a TS declaration-merging registry |
| `DEFAULT_ROUNDING` | — | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | every rounding operation takes a `Rounding` |
| `ExtendMoneyOptions` | — | not ported: by design (Rust uses extension traits; there's no prototype to install on) | |
| `ExtendMoneyOptions#owner` | — | not ported: by design (as `extendMoney`) | |
| `Factor` | [`ducat::Factor`](../crates/ducat/src/ratio.rs) | same | integers, decimal strings, `Ratio`, `f64` by `TryFrom` |
| `ISO_4217_PUBLISHED` | `ducat::ISO_4217_PUBLISHED` | same | |
| `ISO_EXPONENTS` | `ducat::CurrencyCode::iso_codes`, `CurrencyCode::exponent` | same | an iterator, not a record |
| `ISO_NON_MONETARY` | `ducat::CurrencyCode::iso_non_monetary` | same | |
| `IsoCurrencyCode` | `ducat::iso` markers (`ducat::iso::Eur`) | same | |
| `Money` | `ducat::Money<C>`, `ducat::AnyMoney` | same | |
| `Money#abs` | `Money::abs`, `AnyMoney::abs` | same | |
| `Money#add` | `Add` for `Money<C>`; `AnyMoney::checked_add` | same | |
| `Money#clamp` | — | missing | `Ord::clamp` panics for `lo > hi` where TS throws `RangeError`; `AnyMoney` has none. The fix adds `clamp(&self, lo, hi) -> Result` on `Money<C>` and `AnyMoney` (an `Err` for `lo > hi`, `CurrencyMismatch` across currencies) |
| `Money#compare` | `Ord::cmp` for `Money<C>`; `AnyMoney::compare` | same | |
| `Money#currency` | `Money::currency`, `AnyMoney::currency` | same | |
| `Money#divide` | `Money::divide`, `AnyMoney::divide` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the `Rounding` is required |
| `Money#equals` | `==` (`PartialEq` by value), `eq_value` | same | |
| `Money#greaterThan` | `>` (`PartialOrd`) for `Money<C>`; `AnyMoney::compare` | same | |
| `Money#greaterThanOrEqual` | `>=` for `Money<C>`; `AnyMoney::compare` | same | |
| `Money#hasFraction` | — | missing | whether the amount has a sub-unit part; `units() % 10^scale` by hand |
| `Money#identical` | `Money::identical`, `AnyMoney::identical` | same | |
| `Money#isNegative` | `Money::is_negative`, `AnyMoney::is_negative` | same | |
| `Money#isPositive` | `Money::is_positive`, `AnyMoney::is_positive` | same | |
| `Money#isZero` | `Money::is_zero`, `AnyMoney::is_zero` | same | |
| `Money#lessThan` | `<` for `Money<C>`; `AnyMoney::compare` | same | |
| `Money#lessThanOrEqual` | `<=` for `Money<C>`; `AnyMoney::compare` | same | |
| `Money#majorPart` | — | missing | the whole units; with `minorPart`, for receipts and cheque printing |
| `Money#max` | `Ord::max` for `Money<C>` | same | `AnyMoney` has none |
| `Money#min` | `Ord::min` for `Money<C>` | same | `AnyMoney` has none |
| `Money#minor` | `Money::units`, `AnyMoney::units` | same | the integer at the value's scale |
| `Money#minorPart` | — | missing | the sub-unit digits |
| `Money#multiply` | `Money::multiply`, `AnyMoney::multiply` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#negate` | `Neg` for `Money<C>` and `AnyMoney` | same | |
| `Money#round` | `Money::round`, `AnyMoney::round` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#scale` | `Money::scale`, `AnyMoney::scale` | same | |
| `Money#sign` | `Money::signum`, `AnyMoney::signum` | same | |
| `Money#subtract` | `Sub` for `Money<C>`; `AnyMoney::checked_sub` | same | |
| `Money#toDecimal` | `Money::to_decimal`, `AnyMoney::to_decimal` | same | |
| `Money#toJSON` | `serde::Serialize` (feature `serde`) | divergent: [serde writes the value's scale, reads at the exponent](design.md#decisions-made-while-building-milestone-1) | |
| `Money#toMinor` | `Money::to_minor`, `AnyMoney::to_minor` | same | |
| `Money#toMinorNumber` | — | missing | decided ([floats only go out](design.md#parity-decisions)): an explicitly lossy, output-only `to_minor_f64`; for display or interop only, never round-trip; never called inside ducat |
| `Money#toNumber` | — | missing | decided ([floats only go out](design.md#parity-decisions)): an explicitly lossy, output-only `to_f64`; for display or interop only, never round-trip; never called inside ducat |
| `Money#toScale` | `Money::to_scale`, `AnyMoney::to_scale` | same | the `Rounding` is required |
| `Money#toScaledUnits` | `Money::units`, `AnyMoney::units` | same | |
| `Money#toString` | `Display` (`12.34 EUR`) | divergent: [display is exact](design.md#decisions-made-while-building-milestone-1) | |
| `Money#with` | — | not ported: by design (idiomatic Rust, not transliterated TypeScript: a closure or a plain call does it) | a pipeline helper |
| `MoneyJSON` | the `serde` shape `{"amount":"12.34","currency":"EUR"}` | same | no named Rust type |
| `MoneyOperand` | — | not ported: by design (TS typing device; `Money<C>` operators take values and references) | |
| `MoneyOptions` | arguments of `Money::parse_at` / `AnyMoney::parse_at` | same | |
| `MoneyOptions#rounding` | the `Rounding` argument of `parse_at` | same | |
| `MoneyOptions#scale` | the `scale` argument of `parse_at`, `from_units` | same | |
| `Ratio` | [`ducat::Ratio`](../crates/ducat/src/ratio.rs) | same | |
| `Rounding` | [`ducat::Rounding`](../crates/ducat/src/rounding.rs) | same | plus `Unnecessary` |
| `RoundingError` | `ducat::Error::Rounding` | same | |
| `RoundingError#name` | `ducat::Error::kind` | same | |
| `RoundingInput` | `ducat::RoundingInput` | same | `Mode` or `Policy` |
| `RoundingMode` | `ducat::Rounding` | same | |
| `RoundingPolicy` | [`ducat::policy::RoundingPolicy`](../crates/ducat/src/policy.rs) | same | |
| `ToMinorNumberOptions` | — | missing | decided ([floats only go out](design.md#parity-decisions)): an explicitly lossy, output-only `to_minor_f64`; for display or interop only, never round-trip; never called inside ducat |
| `ToMinorNumberOptions#lossy` | — | missing | decided ([floats only go out](design.md#parity-decisions)): an explicitly lossy, output-only `to_minor_f64`; for display or interop only, never round-trip; never called inside ducat |
| `assertCurrency` | `TryFrom<AnyMoney> for Money<C>` | same | |
| `currencyExponent` | `ducat::CurrencyCode::exponent` | same | |
| `defineCurrency` | `ducat::CurrencyCode::custom`, `ducat::define_currency!` | divergent: [no registry](design.md#decisions-made-while-building-milestone-1) | |
| `extendMoney` | — | not ported: by design (Rust uses extension traits; there's no prototype to install on) | |
| `fromJSON` | `serde::Deserialize` | divergent: [reads at the currency's exponent](design.md#decisions-made-while-building-milestone-1) | |
| `fromMinor` | `Money::from_minor`, `AnyMoney::from_minor` | same | |
| `isCurrency` | `str::parse::<CurrencyCode>().is_ok()` | same | |
| `isMoney` | — | not ported: by design (the type system: a value is a `Money<C>` or not) | |
| `isMoneyIn` | `TryFrom<AnyMoney> for Money<C>` | not ported: by design (the type system) | |
| `money` | `Money::parse_at`, `FromStr`, `from_f64`, `from_f64_at` (and `AnyMoney`'s) | same | |
| `ratio` | `ducat::Ratio::new` | same | |
| `sum` | `Sum` for `Money<C>`; `AnyMoney::try_sum` | same | |
| `zero` | `Money::zero`, `AnyMoney::zero` | same | |

### `./fn`

No split in Rust: unused methods cost nothing ([mapping](design.md#mapping-ducats-entries)). `./fn` re-exports the core's factories, types and errors and every plugin's free functions; their rows are in those entries. Its own rows are the free-function forms of the core methods and its method-less `Money`.

| TS | Rust | status | note |
|---|---|---|---|
| `Money` | `ducat::Money<C>`, `ducat::AnyMoney` | same | |
| `Money#currency` | `Money::currency` | same | |
| `Money#minor` | `Money::units` | same | |
| `Money#scale` | `Money::scale` | same | |
| `Money#toJSON` | `serde::Serialize` | divergent: [serde writes the value's scale](design.md#decisions-made-while-building-milestone-1) | |
| `Money#toString` | `Display` | divergent: [display is exact](design.md#decisions-made-while-building-milestone-1) | |
| `abs` | `Money::abs` | same | methods, not free functions |
| `add` | `Add`; `AnyMoney::checked_add` | same | |
| `clamp` | — | missing | as `Money#clamp` |
| `compare` | `Ord::cmp`; `AnyMoney::compare` | same | |
| `divide` | `Money::divide` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `equals` | `==` | same | |
| `greaterThan` | `>` | same | |
| `greaterThanOrEqual` | `>=` | same | |
| `hasFraction` | — | missing | as `Money#hasFraction` |
| `identical` | `Money::identical` | same | |
| `isNegative` | `Money::is_negative` | same | |
| `isPositive` | `Money::is_positive` | same | |
| `isZero` | `Money::is_zero` | same | |
| `lessThan` | `<` | same | |
| `lessThanOrEqual` | `<=` | same | |
| `majorPart` | — | missing | as `Money#majorPart` |
| `max` | `Ord::max` | same | |
| `min` | `Ord::min` | same | |
| `minorPart` | — | missing | as `Money#minorPart` |
| `multiply` | `Money::multiply` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `negate` | `Neg` | same | |
| `round` | `Money::round` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `sign` | `Money::signum` | same | |
| `subtract` | `Sub`; `AnyMoney::checked_sub` | same | |
| `toDecimal` | `Money::to_decimal` | same | |
| `toMinor` | `Money::to_minor` | same | |
| `toMinorNumber` | — | missing | decided ([floats only go out](design.md#parity-decisions)): an explicitly lossy, output-only `to_minor_f64`; for display or interop only, never round-trip; never called inside ducat |
| `toNumber` | — | missing | decided ([floats only go out](design.md#parity-decisions)): an explicitly lossy, output-only `to_f64`; for display or interop only, never round-trip; never called inside ducat |
| `toScale` | `Money::to_scale` | same | |
| `toScaledUnits` | `Money::units` | same | |

### `./iso`

| TS | Rust | status | note |
|---|---|---|---|
| `(import)` | the ISO table, always present; markers behind the `iso` feature | same | nothing to register: `CurrencyCode` parsing knows every ISO code |

### `./iso/*`

| TS | Rust | status | note |
|---|---|---|---|
| `(import)` | `ducat::iso::Eur` and the other markers (feature `iso`) | same | one module per code in TS; one zero-sized type per code in Rust |

### `./allocate`

[`ducat::allocate`](../crates/ducat/src/allocate.rs) (feature `allocate`); the operations are methods on `Money<C>` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `AllocateOptions` | the `Remainder` argument | same | |
| `AllocateOptions#remainder` | `ducat::allocate::Remainder` argument of `allocate`/`split` | same | |
| `InstalmentOptions` | the arguments of `Money::instalments` | same | |
| `InstalmentOptions#remainder` | `ducat::allocate::InstalmentRemainder` argument | same | |
| `InstalmentOptions#unit` | the `unit` argument of `Money::instalments` | same | |
| `Money#allocate` | `Money::allocate`, `AnyMoney::allocate` | same | |
| `Money#chunk` | `Money::chunk`, `AnyMoney::chunk` | same | |
| `Money#instalments` | `Money::instalments`, `AnyMoney::instalments` | same | |
| `Money#schedule` | `Money::schedule`, `AnyMoney::schedule` | same | |
| `Money#split` | `Money::split`, `AnyMoney::split` | same | |
| `Remainder` | `ducat::allocate::Remainder` | same | `Largest`, `First`, `Last`, `ToFirst`, `ToLast` |
| `Tranche` | `ducat::allocate::Tranche` | same | `amount`, `percent`, `percent_capped`, `rest` |
| `Weight` | `ducat::allocate::Weight`, `IntoWeight` | same | |
| `allocate` | `Money::allocate` | same | |
| `chunk` | `Money::chunk` | same | |
| `instalments` | `Money::instalments` | same | |
| `schedule` | `Money::schedule` | same | |
| `split` | `Money::split` | same | |

### `./tax`

[`ducat::tax`](../crates/ducat/src/tax.rs) (feature `tax`).

| TS | Rust | status | note |
|---|---|---|---|
| `Money#addTax` | `Money::add_tax`, `AnyMoney::add_tax` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#discount` | `Money::discount`, `AnyMoney::discount` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#extractTax` | `Money::extract_tax`, `AnyMoney::extract_tax` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#percentage` | `Money::percentage`, `AnyMoney::percentage` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `TaxBreakdown` | `ducat::tax::TaxBreakdown` | same | `net`, `tax`, `gross` |
| `addTax` | `Money::add_tax` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `discount` | `Money::discount` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `extractTax` | `Money::extract_tax` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `percentage` | `Money::percentage` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |

### `./math`

[`ducat::math`](../crates/ducat/src/math.rs) (feature `math`); the ratio arithmetic is `Ratio`'s own.

| TS | Rust | status | note |
|---|---|---|---|
| `Money#divideToIntegral` | `Money::divide_to_integral`, `AnyMoney::divide_to_integral` | same | |
| `Money#ratioOf` | `Money::ratio_of`, `AnyMoney::ratio_of` | same | |
| `Money#remainder` | `Money::remainder`, `AnyMoney::remainder` | same | |
| `Money#trimScale` | `Money::trim_scale`, `AnyMoney::trim_scale` | same | |
| `average` | `Money::average`, `AnyMoney::average` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `divideToIntegral` | `Money::divide_to_integral` | same | |
| `ratioAdd` | `Ratio::add`, `+` | same | |
| `ratioCompare` | `Ord` for `Ratio` | same | |
| `ratioComplement` | `Ratio::complement` | same | |
| `ratioDivide` | `Ratio::div`, `/` | same | |
| `ratioMultiply` | `Ratio::mul`, `*` | same | |
| `ratioNegate` | `Ratio::neg`, unary `-` | same | |
| `ratioOf` | `Money::ratio_of` | same | |
| `ratioSubtract` | `Ratio::sub`, `-` | same | |
| `remainder` | `Money::remainder` | same | |
| `trimScale` | `Money::trim_scale` | same | |

### `./convert`

[`ducat::convert`](../crates/ducat/src/convert/mod.rs) (feature `convert`): rates with metadata, providers and `MoneyBag`.

| TS | Rust | status | note |
|---|---|---|---|
| `ComparatorOptions` | arguments of `ducat::convert::comparator` | same |  |
| `ComparatorOptions#asOf` | the `RateQuery` argument of `comparator` | same |  |
| `ComparatorOptions#base` | the base `CurrencyCode` argument of `comparator` | same |  |
| `ConvertOptions` | `ducat::convert::ConvertOptions` | same |  |
| `ConvertOptions#scale` | `ConvertOptions::scale` | same |  |
| `ConvertOptions#strictValidity` | `ConvertOptions::valid_at` | divergent: [no clock: times are arguments](design.md#milestone-5d1-rates-providers-and-bags) | the time to check against is given, not read from a clock |
| `DetailedConversion` | the result of `Rate::convert_detailed` | same |  |
| `Money#convert` | `Money::convert`, `AnyMoney::convert`, `convert_through` | same |  |
| `MoneyBag` | [`ducat::convert::MoneyBag`](../crates/ducat/src/convert/bag.rs) | same |  |
| `MoneyBag#add` | `MoneyBag::with` | same |  |
| `MoneyBag#currencies` | `MoneyBag::currencies` | same |  |
| `MoneyBag#exactTotal` | `MoneyBag::exact_total` | same |  |
| `MoneyBag#get` | `MoneyBag::get` | same |  |
| `MoneyBag#toJSON` | `serde::Serialize` for `MoneyBag` | same |  |
| `MoneyBag#total` | `MoneyBag::total` | same | rounded once |
| `MoneyBag#values` | `MoneyBag::values` | same |  |
| `ProviderConvertOptions` | `ducat::convert::ProviderConvertOptions` | same |  |
| `ProviderConvertOptions#asOf` | `ProviderConvertOptions::as_of` | same |  |
| `ProviderConvertOptions#scale` | `ProviderConvertOptions::scale` | same |  |
| `ProviderConvertOptions#strictValidity` | `ProviderConvertOptions::valid_at` | divergent: [no clock: times are arguments](design.md#milestone-5d1-rates-providers-and-bags) |  |
| `Rate` | `ducat::convert::Rate<F, T>`, `AnyRate` | same |  |
| `Rate#andThen` | `Rate::and_then`, `AnyRate::and_then` | same |  |
| `Rate#asOf` | `RateInfo::as_of` (`Rate::info`) | same |  |
| `Rate#availableAt` | `RateInfo::available_at` | same |  |
| `Rate#checkValidity` | `Rate::is_expired`; `ConvertOptions::valid_at` in `convert_with` | missing | TS has a public throwing check; Rust's is private, inside `convert_with` (`Rate::is_expired` only answers yes/no). The fix adds `Rate::check_validity(&self, at) -> Result<(), Error>` |
| `Rate#convert` | `Rate::convert`, `convert_with`, `AnyRate::convert` | same |  |
| `Rate#derivedFrom` | `Rate::derived_from` | same |  |
| `Rate#from` | `Rate::from` | same |  |
| `Rate#inverse` | `Rate::inverse` | same | infallible: a quote describes its rate exactly |
| `Rate#isAvailable` | `Rate::is_available` | divergent: [no clock: times are arguments](design.md#milestone-5d1-rates-providers-and-bags) | takes the time |
| `Rate#isExpired` | `Rate::is_expired` | divergent: [no clock: times are arguments](design.md#milestone-5d1-rates-providers-and-bags) | takes `now` |
| `Rate#quote` | `RateInfo::quote` | same |  |
| `Rate#ratio` | `Rate::ratio` | same |  |
| `Rate#round` | `Rate::round` | same |  |
| `Rate#source` | `RateInfo::source` | same |  |
| `Rate#to` | `Rate::to` | same |  |
| `Rate#toDecimal` | `Rate::to_decimal` | same |  |
| `Rate#toJSON` | `serde::Serialize` for `Rate`/`AnyRate` (`RateJSON` shape) | same |  |
| `Rate#toString` | `Display` for `Rate` | same |  |
| `Rate#type` | `RateInfo::rate_type` | same |  |
| `Rate#validUntil` | `RateInfo::valid_until` | same |  |
| `Rate#withMargin` | `Rate::with_margin` | same |  |
| `RateExpiredError` | `ducat::Error::RateExpired` | same |  |
| `RateExpiredError#validUntil` | `Error::RateExpired { valid_until }` | same |  |
| `RateInfo` | `ducat::convert::RateInfo` | same |  |
| `RateJSON` | the `serde` shape of `Rate` | same | no named Rust type |
| `RateProvider` | `ducat::convert::RateProvider`, `BoxedProvider` | same |  |
| `RateProvider#rate` | `RateProvider::rate` | same | returns `Option<AnyRate>` |
| `RateQuery` | `ducat::convert::RateQuery` | same |  |
| `RateQuote` | `ducat::convert::RateQuote` | same |  |
| `RateTable` | [`ducat::convert::RateTable`](../crates/ducat/src/convert/provider.rs) | same |  |
| `RateTable#asOf` | `RateTable::as_of` | same |  |
| `RateTable#availableAt` | `RateTable::available_at` | same |  |
| `RateTable#base` | `RateTable::base` | same |  |
| `RateTable#missing` | `RateTable::missing` | same | plus `unknown()` for codes the port skips |
| `RateTable#rate` | `RateProvider::rate` for `RateTable` | same |  |
| `RateTable#rates` | `RateTable::rates` | same |  |
| `RateTable#validUntil` | `RateTable::valid_until` | same |  |
| `RateTableSpec` | `ducat::convert::RateTableBuilder`, `RateTable::from_rates` | same |  |
| `RateType` | `ducat::convert::RateType` | same |  |
| `RateUnavailableError` | `ducat::Error::RateUnavailable` | same |  |
| `RateUnavailableError#asOf` | `Error::RateUnavailable { as_of }` | same |  |
| `RateUnavailableError#from` | `Error::RateUnavailable { from }` | same |  |
| `RateUnavailableError#to` | `Error::RateUnavailable { to }` | same |  |
| `SnapshotOptions` | — | missing | with `snapshots` |
| `SnapshotOptions#lookback` | — | missing | with `snapshots` |
| `SnapshotOptions#max` | — | missing | with `snapshots` |
| `Snapshots` | — | missing | with `snapshots` |
| `Snapshots#at` | — | missing | with `snapshots` |
| `TotalOptions` | `ducat::convert::TotalOptions` | same |  |
| `TotalOptions#asOf` | `TotalOptions::query` | same |  |
| `TotalOptions#scale` | `TotalOptions::scale` | same |  |
| `bag` | `MoneyBag::new`, `MoneyBag::of` | same |  |
| `chain` | `ducat::convert::chain` | same |  |
| `comparator` | `ducat::convert::comparator` | same |  |
| `convert` | `Rate::convert`, `Money::convert` | same |  |
| `convertDetailed` | `Rate::convert_detailed`, `convert_detailed_with` | same |  |
| `exchangeRate` | `Rate::new`, `Rate::parse`, `AnyRate::new` | same |  |
| `identity` | `ducat::convert::identity` | same |  |
| `impliedRate` | `Rate::implied` | same |  |
| `isRate` | — | not ported: by design (the type system) |  |
| `multiplyByRatioAtScale` | `Money::multiply`, `AnyMoney::multiply` with a scaled `RoundingPolicy` | divergent: [single rounding into another scale](design.md#parity-decisions) | `Money::multiply`/`AnyMoney::multiply` with a `RoundingPolicy::new(mode).with_scale(s)?` rounds the product once at scale `s`; the minor-unit kernel on `Int` isn't public. Failures differ: the TS kernel checks no argument (any integer `scaleShift`, negative or past 1000, works; a fractional or infinite one is a native `RangeError` from `BigInt`, a huge one `RangeError: Maximum BigInt size exceeded`; `NaN` acts as 0), where Rust's target scale is a `u16` and `with_scale` returns `Err(InvalidScale)` past `MAX_SCALE` (1000), so no shift to a negative or a >1000 scale; nothing panics |
| `rateFromJSON` | `serde::Deserialize` for `Rate`/`AnyRate` | same |  |
| `rateOf` | `ducat::convert::rate_of`, `Rate::lookup` | same | `Error::RateUnavailable` |
| `rateTable` | `RateTable::with_base`, `RateTable::from_rates` | same |  |
| `reversed` | `ducat::convert::reversed` | same |  |
| `snapshots` | — | missing | tables loaded on demand by date; decided: a sync loader closure/trait in `ducat`, async in `ducat-fetch` |
| `snapshotsFrom` | — | missing | as `snapshots`, from a list of loaders |
| `sortByValue` | `ducat::convert::sort_by_value` | same |  |
| `sumByCurrency` | `ducat::convert::sum_by_currency` | same |  |
| `via` | `ducat::convert::via` | same |  |

### `./convert/ecb`

[`ducat::convert::ecb`](../crates/ducat/src/convert/ecb.rs) (feature `ecb`); parsers take `&str` and return `Error::MalformedRates` for a file they can't read.

| TS | Rust | status | note |
|---|---|---|---|
| `EcbAvailableAt` | `ducat::convert::Publication` | divergent: [publication times without time-zone data](design.md#milestone-5d2-rate-sources) | `Unknown`, `Stated`, `Given(&dyn Fn)` |
| `EcbOptions` | `ducat::convert::ecb::EcbOptions` | same |  |
| `EcbOptions#availableAt` | `EcbOptions::available_at` | same |  |
| `EcbSdmxOptions` | `ducat::convert::ecb::EcbSdmxOptions` | same |  |
| `EcbSdmxOptions#availableAt` | `EcbSdmxOptions::available_at` | same |  |
| `EcbSdmxOptions#decimals` | `EcbSdmxOptions::decimals` | same |  |
| `parseEcbCsv` | `ducat::convert::ecb::parse_ecb_csv` | same |  |
| `parseEcbSdmxCsv` | `ducat::convert::ecb::parse_ecb_sdmx_csv` | same |  |
| `parseEcbSdmxDecimals` | `ducat::convert::ecb::parse_ecb_sdmx_decimals` | same |  |
| `parseEcbXml` | `ducat::convert::ecb::parse_ecb_xml` | same |  |

### `./convert/history`

[`ducat::convert::history`](../crates/ducat/src/convert/history.rs) (feature `history`).

| TS | Rust | status | note |
|---|---|---|---|
| `Fallback` | `ducat::convert::history::Fallback` | same |  |
| `FallbackReason` | `ducat::convert::history::FallbackReason` | same |  |
| `QuotedRate` | `ducat::convert::history::QuotedRate` | same |  |
| `QuotedTableSpec` | `ducat::convert::history::QuotedTableSpec` | same |  |
| `RateHistory` | `ducat::convert::history::RateHistory` | same |  |
| `RateHistory#lookup` | `RateHistory::lookup` | same |  |
| `RateHistory#rate` | `RateProvider::rate` for `RateHistory` | same |  |
| `RateHistory#tables` | `RateHistory::tables` | same |  |
| `RateHistoryOptions` | the arguments of `rate_history` | same |  |
| `RateHistoryOptions#lookback` | the `lookback` argument of `rate_history` | same |  |
| `RateLookup` | `ducat::convert::history::RateLookup` | same |  |
| `quotedTable` | `ducat::convert::history::quoted_table` | same |  |
| `rateFromQuote` | `ducat::convert::history::rate_from_quote` | same |  |
| `rateHistory` | `ducat::convert::history::rate_history` | same |  |

### `./convert/boc`

[`ducat::convert::boc`](../crates/ducat/src/convert/boc.rs) (feature `boc`).

| TS | Rust | status | note |
|---|---|---|---|
| `BankOfCanadaOptions` | `ducat::convert::boc::BankOfCanadaOptions` | same |  |
| `BankOfCanadaOptions#availableAt` | `BankOfCanadaOptions::available_at` | divergent: [publication times without time-zone data](design.md#milestone-5d2-rate-sources) | Toronto 16:30 by the written-out DST rule |
| `parseBankOfCanadaJson` | `ducat::convert::boc::parse_bank_of_canada_json` | same |  |

### `./convert/fed`

[`ducat::convert::fed`](../crates/ducat/src/convert/fed.rs) (feature `fed`).

| TS | Rust | status | note |
|---|---|---|---|
| `parseFedH10Csv` | `ducat::convert::fed::parse_fed_h10_csv` | same |  |

### `./words`

The crate [`ducat-words`](../crates/ducat-words/src/lib.rs): ducat's own RBNF interpreter over CLDR's rule text, a feature per language.

| TS | Rust | status | note |
|---|---|---|---|
| `AmountInWordsOptions` | `ducat_words::AmountInWordsOptions` | same |  |
| `AmountInWordsOptions#gender` | `AmountInWordsOptions::gender` (`Gender`) | same |  |
| `AmountInWordsOptions#minor` | `AmountInWordsOptions::minor` | same |  |
| `AmountInWordsOptions#ruleSet` | `AmountInWordsOptions::rule_set` | same |  |
| `SpelloutRules` | `ducat_words::SpelloutRules`, `CompiledRules` | same |  |
| `UnitNames` | `ducat_words::UnitNames` | same | `other`, with `one` and `many` |
| `amountInWords` | `ducat_words::amount_in_words` | divergent: [currency names are the caller's](design.md#currency-names-in-words) | `AmountInWordsOptions::currency` is required: no CLDR names as defaults yet (decided: feature `cldr-names`) |
| `ruleSets` | `CompiledRules::rule_sets` | same |  |
| `spellOut` | `ducat_words::spell_out`, `spell_out_int` | same | values within ±(2^63 − 1), ICU's range |

### `./words/de`

`ducat_words::GERMAN` (feature `de`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `german` | `ducat_words::GERMAN` | same |  |

### `./words/en`

`ducat_words::ENGLISH` (feature `en`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `english` | `ducat_words::ENGLISH` | same |  |

### `./words/es`

`ducat_words::SPANISH` (feature `es`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `spanish` | `ducat_words::SPANISH` | same |  |

### `./words/fr`

`ducat_words::FRENCH` (feature `fr`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `french` | `ducat_words::FRENCH` | same |  |

### `./words/it`

`ducat_words::ITALIAN` (feature `it`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `italian` | `ducat_words::ITALIAN` | same |  |

### `./words/nl`

`ducat_words::DUTCH` (feature `nl`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `dutch` | `ducat_words::DUTCH` | same |  |

### `./words/pt`

`ducat_words::PORTUGUESE` (feature `pt`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `portuguese` | `ducat_words::PORTUGUESE` | same |  |

### `./wire`

[`ducat::wire`](../crates/ducat/src/wire.rs) (feature `wire`): plain structs with conversions on `Money` and `AnyMoney`, each in its format's JSON shape under `serde`.

| TS | Rust | status | note |
|---|---|---|---|
| `DineroObject` | `ducat::wire::DineroObject` | same |  |
| `GoogleMoney` | `ducat::wire::GoogleMoney` | same |  |
| `GoogleMoneyInput` | `ducat::wire::GoogleMoney` (serde reads numbers or strings) | divergent: [no 2^53 rule for `units`](design.md#milestone-5e-wire-formats) |  |
| `Iso20022Amount` | `ducat::wire::Iso20022Amount` | same |  |
| `Iso20022WriteOptions` | the arguments of `Money::to_iso20022_amount` | same |  |
| `Iso20022WriteOptions#scale` | the `scale` argument of `to_iso20022_amount` | same |  |
| `MinorUnitAmount` | `ducat::wire::MinorUnitAmount` | same |  |
| `WireReadOptions` | `ducat::wire::WireReadOptions` | same |  |
| `WireReadOptions#rounding` | `WireReadOptions::rounding` | same |  |
| `WireReadOptions#scale` | `WireReadOptions::scale` | same |  |
| `fromDineroObject` | `Money::from_dinero_object`, `AnyMoney::from_dinero_object` | same |  |
| `fromGoogleMoney` | `Money::from_google_money`, `AnyMoney::from_google_money` | same |  |
| `fromIso20022Amount` | `Money::from_iso20022_amount`, `AnyMoney::from_iso20022_amount` | same |  |
| `fromMinorUnits` | `Money::from_minor_units`, `AnyMoney::from_minor_units` | same |  |
| `toDineroObject` | `Money::to_dinero_object` | same |  |
| `toGoogleMoney` | `Money::to_google_money` | same |  |
| `toIso20022Amount` | `Money::to_iso20022_amount` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |
| `toMinorUnits` | `Money::to_minor_units` | same |  |

### `./context`

Not ported ([mapping](design.md#mapping-ducats-entries)): `Money<Eur>` already binds a currency, and a locale goes to `ducat-format`'s functions.

| TS | Rust | status | note |
|---|---|---|---|
| `CurrencyContext` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContext#currency` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContext#format` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContext#fromMinor` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContext#is` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContext#locale` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContext#money` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContext#zero` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContextOptions` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContextOptions#locale` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `CurrencyContextOptions#parse` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `MoneyOf` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParseFunction` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext#currency` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext#format` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext#fromMinor` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext#is` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext#locale` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext#money` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext#parse` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `ParsingCurrencyContext#zero` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |
| `currencyContext` | — | not ported: by design (`Money<Eur>` already binds a currency; a locale goes to the formatter) |  |

### `./crypto`

`ducat::crypto` (feature `crypto`).

| TS | Rust | status | note |
|---|---|---|---|
| `CryptoCurrencies` | — | not ported: by design (no registry: currencies carry their exponent) | a TS declaration-merging registry |
| `CryptoCurrencyCode` | `ducat::CurrencyCode::crypto` | same |  |
| `CryptoUnit` | `ducat::crypto::CryptoUnit` | same |  |
| `cryptoUnit` | `ducat::crypto::unit` | same |  |
| `cryptoUnits` | `ducat::crypto::units` | same |  |
| `defineCryptoCurrencies` | `ducat::CurrencyCode::crypto` | divergent: [no registry](design.md#decisions-made-while-building-milestone-1) | a code from the table, nothing registered |
| `fromBaseUnits` | `Money::from_base_units`, `AnyMoney::from_base_units` | same |  |
| `toBaseUnits` | `Money::to_base_units`, `AnyMoney::to_base_units` | same |  |

### `./currencies`

`ducat::currencies` (feature `currencies`); names and symbols are CLDR's, in [`ducat-format`](../crates/ducat-format/src/format.rs).

| TS | Rust | status | note |
|---|---|---|---|
| `CurrencySymbolOptions` | the `narrow` argument of `ducat_format::currency_symbol` | same |  |
| `CurrencySymbolOptions#display` | the `narrow: bool` argument of `currency_symbol` | same |  |
| `currencyFromNumeric` | `ducat::currencies::currency_from_numeric`, `currency_from_number` | same |  |
| `currencyName` | `ducat_format::currency_name` | divergent: [CLDR 48 data, a fixed set of locales](design.md#coverage) | TS reads the runtime's `Intl` |
| `currencySymbol` | `ducat_format::currency_symbol` | divergent: [CLDR 48 data, a fixed set of locales](design.md#coverage) |  |
| `minorUnit` | `ducat::currencies::minor_unit` | same |  |
| `numericCode` | `ducat::currencies::numeric_code`, `CurrencyCode::numeric_code` | same |  |

### `./territories`

`ducat::territories` (feature `territories`).

| TS | Rust | status | note |
|---|---|---|---|
| `TerritoryCurrency` | `ducat::territories::TerritoryCurrency` | same |  |
| `TerritoryOptions` | `ducat::territories::TerritoryOptions` | same |  |
| `TerritoryOptions#includeNonTender` | `TerritoryOptions::include_non_tender` | same |  |
| `TerritoryOptions#on` | `TerritoryOptions::on` | same | a `Date` |
| `currencyTerritories` | `ducat::territories::currency_territories` | same |  |
| `territoryCurrencies` | `ducat::territories::territory_currencies` | same |  |

### `./historic`

`ducat::historic` (feature `historic`).

| TS | Rust | status | note |
|---|---|---|---|
| `HistoricCurrencies` | — | not ported: by design (no registry: currencies carry their exponent) | a TS declaration-merging registry |
| `HistoricCurrency` | `ducat::historic::HistoricCurrency` | same |  |
| `HistoricCurrencyCode` | `ducat::CurrencyCode::historic` | same |  |
| `ISO_4217_LIST_THREE_PUBLISHED` | `ducat::historic::LIST_THREE_PUBLISHED` | same |  |
| `defineHistoricCurrencies` | `ducat::CurrencyCode::historic` | divergent: [no registry](design.md#decisions-made-while-building-milestone-1) |  |
| `historicCurrencies` | `ducat::historic::currencies` | same |  |
| `historicCurrency` | `ducat::historic::currency` | same |  |

### `./finance`

`ducat::finance` in the `ducat` crate, behind the `finance` Cargo feature (a default; it enables `allocate`). Interest, compounding, amortisation and proration are methods on `Money<C>` and `AnyMoney`, and `discounted_sum_exact` also needs `exact`. Excel's NPV and IRR live only in `ducat::excel`.

| TS | Rust | status | note |
|---|---|---|---|
| `Amortisation` | [`ducat::finance::Amortisation`](../crates/ducat/src/finance/loan.rs) | same | struct generic over the money type: `payment`, `rows`, `total_interest` |
| `AmortisationMethod` | [`ducat::finance::AmortisationMethod`](../crates/ducat/src/finance/loan.rs) | same | enum `Annuity`, `Linear`, `InterestOnly`; `name`/`FromStr` use ducat's strings |
| `AmortisationResidual` | [`ducat::finance::AmortisationResidual`](../crates/ducat/src/finance/loan.rs) | same | enum `LastPayment`, `LastInterest` |
| `AmortisationRow` | [`ducat::finance::AmortisationRow`](../crates/ducat/src/finance/loan.rs) | same | struct: `period`, `date` (`Option<Date>`), `payment`, `interest`, `principal`, `balance`. TS's reserved `days` and `yearFraction` fields (never set) aren't there |
| `AmortiseOptions` | [`ducat::finance::AmortiseOptions`](../crates/ducat/src/finance/loan.rs) | same | struct with public fields, `AmortiseOptions::new` and `with_*` builders |
| `AmortiseOptions#balloon` | `AmortiseOptions::balloon`, `AmortiseOptions::with_balloon` | same | |
| `AmortiseOptions#firstPayment` | `AmortiseOptions::first_payment`, `AmortiseOptions::with_first_payment` | same | a `ducat::finance::Date`; the dates come from `ducat::finance::payment_dates` |
| `AmortiseOptions#method` | `AmortiseOptions::method`, `AmortiseOptions::with_method` | same | defaults to `Annuity` in `new` |
| `AmortiseOptions#perYear` | `AmortiseOptions::per_year` (argument of `AmortiseOptions::new`) | same | |
| `AmortiseOptions#periods` | `AmortiseOptions::periods` (argument of `AmortiseOptions::new`) | same | |
| `AmortiseOptions#rate` | `AmortiseOptions::rate` (a `Ratio`; `new` takes any `impl Factor`) | same | |
| `AmortiseOptions#residual` | `AmortiseOptions::residual`, `AmortiseOptions::with_residual` | same | |
| `AmortiseOptions#rounding` | `AmortiseOptions::rounding`, a required argument of `AmortiseOptions::new` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | TS defaults to `'halfExpand'` |
| `AnnualRateOptions` | the `per_year` argument of `ducat::finance::annual_rate` | same | an argument, not an options bag |
| `AnnualRateOptions#perYear` | the `per_year: u32` argument of `ducat::finance::annual_rate` | same | |
| `CalendarDate` | [`ducat::finance::Date`](../crates/ducat/src/date.rs) | same | `FromStr` reads exactly `YYYY-MM-DD`, `Date::new(year, month, day)` stands in for the `{ year, month, day }` object; years 0 to 9999 in both. Also `ducat::convert::Date` |
| `CompoundOptions` | the `periods` and `per_year` arguments of `Money::compound` / `AnyMoney::compound` | same | arguments, not an options bag |
| `CompoundOptions#perYear` | the `per_year: u32` argument of `Money::compound` | same | |
| `CompoundOptions#periods` | the `periods: u32` argument of `Money::compound` | same | |
| `ContributionTiming` | [`ducat::finance::ContributionTiming`](../crates/ducat/src/finance/savings.rs) | same | enum `End` (default), `Start` |
| `DayCount` | [`ducat::finance::DayCount`](../crates/ducat/src/finance/day_count.rs) | same | enum `Act360`, `Act365Fixed`, `ActActIsda`, `Thirty360`, `ThirtyE360`, `ThirtyE360Isda`; `name`/`FromStr` use ducat's strings |
| `InterestPeriod` | [`ducat::finance::InterestPeriod`](../crates/ducat/src/finance/day_count.rs) | same | struct `from`, `to`, `day_count`, `maturity: Option<bool>` (TS gets `maturity` from `YearFractionOptions`); `new`, `with_maturity` |
| `IrrOptions` | the `digits` and `bracket` arguments of [`ducat::excel::irr`](../crates/ducat/src/finance/rates.rs) | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: a deprecated TS alias of `./excel`'s `IrrOptions`; Rust has no `ducat::finance` alias for it |
| `IrrOptions#bracket` | the `bracket: Option<(&Ratio, &Ratio)>` argument of `ducat::excel::irr` | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: deprecated TS alias, see `./excel` |
| `IrrOptions#digits` | the `digits: u16` argument of `ducat::excel::irr` | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: deprecated TS alias, see `./excel` |
| `IrrResult` | `ducat::finance::GridValue` | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: deprecated TS alias of `./excel`'s `IrrResult`. The Rust type does live in `ducat::finance` |
| `PeriodicRateOptions` | the `per_year` and `digits` arguments of [`ducat::finance::periodic_rate`](../crates/ducat/src/finance/rates.rs) | same | arguments, not an options bag |
| `PeriodicRateOptions#digits` | the `digits: u16` argument of `ducat::finance::periodic_rate` | same | required; TS defaults to 10. At most 100 in both |
| `PeriodicRateOptions#perYear` | the `per_year: u32` argument of `ducat::finance::periodic_rate` | same | |
| `PeriodicRateResult` | [`ducat::finance::PeriodicRate`](../crates/ducat/src/finance/rates.rs) | same | `rate: GridValue` (`Display` is TS's `rate`/`lower` string, `upper_decimal()` is `upper`, `lower()`/`upper()` are exact `Ratio`s) and `exact: Option<Ratio>` |
| `ProrateOptions` | the `period`, `used` and `unit` arguments of `Money::prorate` / `AnyMoney::prorate` | same | arguments, not an options bag |
| `ProrateOptions#period` | the `period: &ProrationPeriod` argument of `Money::prorate` | same | |
| `ProrateOptions#unit` | the `unit: ProrationUnit` argument of `Money::prorate` | same | required; `ProrationUnit::default()` is `Day`, TS's default |
| `ProrateOptions#used` | the `used: &ProrationPeriod` argument of `Money::prorate` | same | |
| `ProrationInstant` | [`ducat::finance::ProrationInstant`](../crates/ducat/src/finance/proration.rs) | same | enum `Date(Date)`, `Unix(i64)`; `FromStr` reads `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`, the same forms as TS |
| `ProrationPeriod` | [`ducat::finance::ProrationPeriod`](../crates/ducat/src/finance/proration.rs) | same | struct `start`, `end`; `new` |
| `ProrationUnit` | [`ducat::finance::ProrationUnit`](../crates/ducat/src/finance/proration.rs) | same | enum `Day` (default), `Second` |
| `SavingsPlan` | [`ducat::finance::SavingsPlan`](../crates/ducat/src/finance/savings.rs) | same | struct: `contribution`, `rows`, `total_contributions`, `total_interest`, `balance` |
| `SavingsPlanOptions` | [`ducat::finance::SavingsPlanOptions`](../crates/ducat/src/finance/savings.rs) | same | struct with public fields. The `with_contribution` and `with_target` constructors pick one of the two, and `initial`, `timing`, `first_contribution` are builders |
| `SavingsPlanOptions#contribution` | `SavingsPlanOptions::contribution`, `SavingsPlanOptions::with_contribution` | same | |
| `SavingsPlanOptions#firstContribution` | `SavingsPlanOptions::first_contribution` (field and builder) | same | |
| `SavingsPlanOptions#initial` | `SavingsPlanOptions::initial` (field and builder) | same | |
| `SavingsPlanOptions#perYear` | `SavingsPlanOptions::per_year` | same | |
| `SavingsPlanOptions#periods` | `SavingsPlanOptions::periods` | same | |
| `SavingsPlanOptions#rate` | `SavingsPlanOptions::rate` (a `Ratio`; the constructors take `impl Factor`) | same | |
| `SavingsPlanOptions#rounding` | `SavingsPlanOptions::rounding`, a required argument of `with_contribution` / `with_target` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | TS defaults to `'halfExpand'` |
| `SavingsPlanOptions#target` | `SavingsPlanOptions::target`, `SavingsPlanOptions::with_target` | same | |
| `SavingsPlanOptions#timing` | `SavingsPlanOptions::timing` (field and builder) | same | |
| `SavingsPlanRow` | [`ducat::finance::SavingsPlanRow`](../crates/ducat/src/finance/savings.rs) | same | struct: `period`, `date`, `contribution`, `interest`, `adjustment: Option<M>`, `balance` |
| `SplitPeriodOptions` | the `period`, `at`, `unit` and `remainder` arguments of `Money::split_period` / `AnyMoney::split_period` | same | arguments, not an options bag |
| `SplitPeriodOptions#at` | the `at: &[ProrationInstant]` argument of `Money::split_period` | same | |
| `SplitPeriodOptions#period` | the `period: &ProrationPeriod` argument of `Money::split_period` | same | |
| `SplitPeriodOptions#remainder` | the `remainder: ducat::allocate::Remainder` argument of `Money::split_period` | same | required; TS defaults to `'largest'` (`Remainder::Largest`) |
| `SplitPeriodOptions#unit` | the `unit: ProrationUnit` argument of `Money::split_period` | same | required; TS defaults to `'day'` |
| `YearFractionOptions` | the `maturity` argument of `ducat::finance::year_fraction` | same | an argument, not an options bag |
| `YearFractionOptions#maturity` | the `maturity: Option<bool>` argument of [`ducat::finance::year_fraction`](../crates/ducat/src/finance/day_count.rs), `InterestPeriod::maturity` | same | `Error::MaturityRequired` where TS throws |
| `amortise` | [`Money::amortise`, `AnyMoney::amortise`](../crates/ducat/src/finance/loan.rs) | same | errors: `InvalidPeriods`, `InvalidPerYear`, `InvalidLoan`, `InvalidBalloon`, `NotAMultiple`, `NegativeRate`, `InvalidResidual`, `DateOutOfRange`, `Rounding`, `CurrencyMismatch` (TS: `RangeError`s) |
| `annualRate` | [`ducat::finance::annual_rate`](../crates/ducat/src/finance/rates.rs) | same | |
| `compound` | [`Money::compound`, `AnyMoney::compound`](../crates/ducat/src/finance/day_count.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `discountedSum` | [`ducat::finance::discounted_sum`](../crates/ducat/src/finance/rates.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `discountedSumExact` | [`ducat::finance::discounted_sum_exact`](../crates/ducat/src/finance/rates.rs) | same | also needs the `exact` feature |
| `interest` | [`Money::interest`, `AnyMoney::interest`](../crates/ducat/src/finance/day_count.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `interestExact` | [`Money::interest_exact`, `AnyMoney::interest_exact`](../crates/ducat/src/finance/day_count.rs) | same | `exact` feature |
| `irr` | [`ducat::excel::irr`](../crates/ducat/src/finance/rates.rs) | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: a deprecated TS re-export of `./excel`'s `irr`; there's no `ducat::finance::irr` |
| `npv` | [`ducat::excel::npv`](../crates/ducat/src/finance/rates.rs) | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: a deprecated TS re-export of `./excel`'s `npv`; there's no `ducat::finance::npv` (and rounding is required) |
| `npvExact` | [`ducat::excel::npv_exact`](../crates/ducat/src/finance/rates.rs) | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: a deprecated TS re-export of `./excel`'s `npvExact`; there's no `ducat::finance::npv_exact` |
| `periodicRate` | [`ducat::finance::periodic_rate`](../crates/ducat/src/finance/rates.rs) | same | |
| `prorate` | [`Money::prorate`, `AnyMoney::prorate`](../crates/ducat/src/finance/proration.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'`. Errors: `InvalidPeriod`, `OutsidePeriod`, `InvalidInstant`, `Rounding` |
| `savingsPlan` | [`ducat::finance::savings_plan`](../crates/ducat/src/finance/savings.rs) | same | |
| `splitPeriod` | [`Money::split_period`, `AnyMoney::split_period`](../crates/ducat/src/finance/proration.rs) | same | |
| `yearFraction` | [`ducat::finance::year_fraction`](../crates/ducat/src/finance/day_count.rs) | same | errors: `EndBeforeStart`, `MaturityRequired` |

### `./excel`

`ducat::excel` in the `ducat` crate, behind the `excel` Cargo feature (a default; it enables `finance` and `exact`). Excel's optional arguments are positional `Option` arguments with a `PaymentTiming`, `digits` and `bracket`, plus an `XnpvOptions` struct for the dated functions.

| TS | Rust | status | note |
|---|---|---|---|
| `FvOptions` | the `pv` and `timing` arguments of [`ducat::excel::fv`](../crates/ducat/src/excel/annuity.rs) / `fv_exact` | same | arguments, not an options bag |
| `FvOptions#pv` | the `pv: Option<&M>` argument of `ducat::excel::fv` | same | |
| `FvOptions#type` | the `timing: ducat::excel::PaymentTiming` argument of `ducat::excel::fv` | same | required; `PaymentTiming::default()` is `End` |
| `IrrOptions` | the `digits` and `bracket` arguments of [`ducat::excel::irr`](../crates/ducat/src/finance/rates.rs) | same | arguments, not an options bag |
| `IrrOptions#bracket` | the `bracket: Option<(&Ratio, &Ratio)>` argument of `ducat::excel::irr` | same | exact `Ratio`s, not `Factor`s; `Error::InvalidBracket` |
| `IrrOptions#digits` | the `digits: u16` argument of `ducat::excel::irr` | same | required; TS defaults to 10. At most 100 in both (`Error::InvalidDigits`) |
| `IrrResult` | [`ducat::finance::GridValue`](../crates/ducat/src/finance/rates.rs) | same | `Display` gives the `rate`/`lower` string, `upper_decimal()` the `upper` string, and `lower()`/`upper()` exact `Ratio`s |
| `NperOptions` | the `fv`, `timing` and `digits` arguments of [`ducat::excel::nper`](../crates/ducat/src/excel/annuity.rs) | same | arguments, not an options bag |
| `NperOptions#digits` | the `digits: u16` argument of `ducat::excel::nper` | same | required; TS defaults to 10 |
| `NperOptions#fv` | the `fv: Option<&M>` argument of `ducat::excel::nper` | same | |
| `NperOptions#type` | the `timing: PaymentTiming` argument of `ducat::excel::nper` | same | |
| `NperResult` | [`ducat::excel::Nper`](../crates/ducat/src/excel/annuity.rs) | same | `periods: GridValue` (TS's `nper`/`lower`/`upper`) and `exact: Option<Ratio>` |
| `PaymentTiming` | [`ducat::excel::PaymentTiming`](../crates/ducat/src/excel/annuity.rs) | same | enum `End` (0, default), `Start` (1); `excel_type()` gives Excel's number |
| `PvOptions` | the `fv` and `timing` arguments of [`ducat::excel::pv`](../crates/ducat/src/excel/annuity.rs), `pv_exact`, `pmt`, `pmt_exact` | same | arguments, not an options bag |
| `PvOptions#fv` | the `fv: Option<&M>` argument of `ducat::excel::pv` / `pmt` | same | |
| `PvOptions#type` | the `timing: PaymentTiming` argument of `ducat::excel::pv` / `pmt` | same | |
| `RateOptions` | the `fv`, `timing`, `digits` and `bracket` arguments of [`ducat::excel::rate`](../crates/ducat/src/excel/annuity.rs) | same | arguments, not an options bag |
| `RateOptions#bracket` | the `bracket: Option<(&Ratio, &Ratio)>` argument of `ducat::excel::rate` | same | |
| `RateOptions#digits` | the `digits: u16` argument of `ducat::excel::rate` | same | required; TS defaults to 10 |
| `RateOptions#fv` | the `fv: Option<&M>` argument of `ducat::excel::rate` | same | |
| `RateOptions#type` | the `timing: PaymentTiming` argument of `ducat::excel::rate` | same | |
| `XirrOptions` | `ducat::excel::XnpvOptions` plus the `digits` and `bracket` arguments of [`ducat::excel::xirr`](../crates/ducat/src/excel/dated.rs) | same | no `XirrOptions` struct |
| `XirrOptions#bracket` | the `bracket: Option<(&Ratio, &Ratio)>` argument of `ducat::excel::xirr` | same | |
| `XirrOptions#dayCount` | `XnpvOptions::day_count` | same | `Default` is `Act365Fixed`, as in TS |
| `XirrOptions#digits` | the `digits: u16` argument of `ducat::excel::xirr` | same | required; TS defaults to 10 |
| `XirrOptions#maturity` | `XnpvOptions::maturity` | same | |
| `XnpvBounds` | [`ducat::excel::XnpvBounds`](../crates/ducat/src/excel/dated.rs) | same | struct `lower`, `upper` (`Ratio`s), `exact: bool` |
| `XnpvBoundsOptions` | `ducat::excel::XnpvOptions` plus the `digits` argument of [`ducat::excel::xnpv_bounds`](../crates/ducat/src/excel/dated.rs) | same | no `XnpvBoundsOptions` struct |
| `XnpvBoundsOptions#dayCount` | `XnpvOptions::day_count` | same | |
| `XnpvBoundsOptions#digits` | the `digits: u16` argument of `ducat::excel::xnpv_bounds` | same | required; TS defaults to 10 |
| `XnpvBoundsOptions#maturity` | `XnpvOptions::maturity` | same | |
| `XnpvOptions` | [`ducat::excel::XnpvOptions`](../crates/ducat/src/excel/dated.rs) | same | struct `day_count`, `maturity: Option<bool>`; `Default` |
| `XnpvOptions#dayCount` | `XnpvOptions::day_count` | same | |
| `XnpvOptions#maturity` | `XnpvOptions::maturity` | same | |
| `fv` | [`ducat::excel::fv`](../crates/ducat/src/excel/annuity.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `fvExact` | [`ducat::excel::fv_exact`](../crates/ducat/src/excel/annuity.rs) | same | |
| `irr` | [`ducat::excel::irr`](../crates/ducat/src/finance/rates.rs) | same | errors: `InvalidDigits`, `NoFlows`, `CurrencyMismatch`, `NoSignChange`, `SeveralSignChanges`, `InvalidBracket`, `RateNearMinusOne`, `RateTooHigh` (TS: `RangeError`s) |
| `nper` | [`ducat::excel::nper`](../crates/ducat/src/excel/annuity.rs) | same | |
| `npv` | [`ducat::excel::npv`](../crates/ducat/src/finance/rates.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `npvExact` | [`ducat::excel::npv_exact`](../crates/ducat/src/finance/rates.rs) | same | |
| `pmt` | [`ducat::excel::pmt`](../crates/ducat/src/excel/annuity.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `pmtExact` | [`ducat::excel::pmt_exact`](../crates/ducat/src/excel/annuity.rs) | same | |
| `pv` | [`ducat::excel::pv`](../crates/ducat/src/excel/annuity.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `pvExact` | [`ducat::excel::pv_exact`](../crates/ducat/src/excel/annuity.rs) | same | |
| `rate` | [`ducat::excel::rate`](../crates/ducat/src/excel/annuity.rs) | same | returns a `GridValue` (TS's `IrrResult`) |
| `xirr` | [`ducat::excel::xirr`](../crates/ducat/src/excel/dated.rs) | same | dates are `&[ducat::finance::Date]` |
| `xnpv` | [`ducat::excel::xnpv`](../crates/ducat/src/excel/dated.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `xnpvBounds` | [`ducat::excel::xnpv_bounds`](../crates/ducat/src/excel/dated.rs) | same | errors: `InvalidDigits`, `LengthMismatch`, `OneSignOnly`, `DateBeforeFirst`, `NoFlows`, `CurrencyMismatch`, `RateTooLow`, `RootTooLarge`, `PrecisionExhausted` |

### `./pricing`

[`ducat::pricing`](../crates/ducat/src/pricing.rs) (feature `pricing`).

| TS | Rust | status | note |
|---|---|---|---|
| `PriceEnding` | `ducat::pricing::PriceEnding` | same | |
| `PriceEndingOptions` | `PriceEnding::new` | same | |
| `PriceEndingOptions#ending` | `PriceEnding::ending` | same | the `ending` argument of `PriceEnding::new` (`&str`; write an integer as `"0"`); `PriceEnding::ending` reads it back as a `Ratio` |
| `PriceEndingOptions#rounding` | `PriceEnding::mode` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the `mode` argument of `PriceEnding::new` (required; TS defaults to `'ceil'`), read back with `PriceEnding::mode` |
| `PriceEndingOptions#step` | `PriceEnding::step` | same | the `step` argument of `PriceEnding::new` (required: TS defaults to 1); `PriceEnding::step` reads it back |
| `PriceTier` | `ducat::pricing::PriceTier` | same | |
| `Quantity` | `ducat::Int` / `Ratio` quantity argument of `TieredPricing::price` | same | |
| `TierLine` | `ducat::pricing::TierLine` | same | `ducat::pricing::TierLine`; `quantity` is a `Ratio`, not TS's decimal string |
| `TieredPrice` | `ducat::pricing::TieredPrice` | same | |
| `TieredPriceOptions` | `ducat::pricing::TieredPricing` | same | |
| `TieredPriceOptions#beyondLastTier` | `TieredPricing::with_beyond_last_tier`, `BeyondLastTier` | same | |
| `TieredPriceOptions#chargeQuantity` | `TieredPricing::with_charge_quantity` | same | |
| `TieredPriceOptions#mode` | `TieredPricing::mode`, `TiersMode` | same | |
| `TieredPriceOptions#rounding` | `TieredPricing::rounding` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the `rounding` argument of `TieredPricing::new` (required; TS defaults to halfExpand) |
| `TieredPriceOptions#tiers` | `TieredPricing::tiers` | same | |
| `TiersMode` | `ducat::pricing::TiersMode` | same | |
| `priceEnding` | `Money::with_price_ending`, `AnyMoney::with_price_ending` | same | `PriceEnding::new` builds the rule; `Money::with_price_ending` / `AnyMoney::with_price_ending` apply it |
| `tieredPrice` | `TieredPricing::price` | same | |

### `./convert/boe`

[`ducat::convert::boe`](../crates/ducat/src/convert/boe.rs) (feature `boe`).

| TS | Rust | status | note |
|---|---|---|---|
| `BankOfEnglandOptions` | `ducat::convert::boe::BankOfEnglandOptions` | same |  |
| `BankOfEnglandOptions#decimals` | `BankOfEnglandOptions::decimals` | same | 0 to 30 (`Error::InvalidDecimals`) |
| `parseBankOfEnglandCsv` | `ducat::convert::boe::parse_bank_of_england_csv` | same |  |

### `./convert/hmrc`

[`ducat::convert::hmrc`](../crates/ducat/src/convert/hmrc.rs) (feature `hmrc`).

| TS | Rust | status | note |
|---|---|---|---|
| `HmrcOptions` | `ducat::convert::hmrc::HmrcOptions` | same |  |
| `HmrcOptions#availableAt` | `HmrcOptions::available_at` | same |  |
| `parseHmrcMonthlyCsv` | `ducat::convert::hmrc::parse_hmrc_monthly_csv` | same |  |

### `./convert/fetch`

The crate [`ducat-fetch`](../crates/ducat-fetch/src/lib.rs): a sans-IO core and blocking fetchers over a `Transport` (`UreqTransport` behind the default `ureq` feature). `FetchError` carries every error kind ducat throws here (`Status` for `FetchRatesError`, `Parse`, `Transport`, and the `RangeError`s as `InvalidCurrency`, `StartTooEarly`, `EndBeforeStart`, `EndWithoutStart`).

| TS | Rust | status | note |
|---|---|---|---|
| `AbortSignalLike` | — | not ported: by design (cancellation and timeouts are the transport's) |  |
| `AbortSignalLike#aborted` | — | not ported: by design (as `AbortSignalLike`) |  |
| `AbortSignalLike#addEventListener` | — | not ported: by design (as `AbortSignalLike`) |  |
| `AbortSignalLike#reason` | — | not ported: by design (as `AbortSignalLike`) |  |
| `AbortSignalLike#removeEventListener` | — | not ported: by design (as `AbortSignalLike`) |  |
| `BANK_OF_CANADA_URL` | `ducat_fetch::BANK_OF_CANADA_URL` | same |  |
| `ECB_DATA_API` | `ducat_fetch::ECB_DATA_API` | same |  |
| `ECB_URLS` | `ducat_fetch::ECB_URLS` (`EcbUrls`) | divergent: [a struct, `ninety_days` for `90d`](design.md#milestone-7b-fetching-rates) |  |
| `Fetch` | `ducat_fetch::Transport` | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchBankOfCanadaOptions` | `ducat_fetch::FetchBankOfCanadaOptions` | same |  |
| `FetchBankOfCanadaOptions#end` | `FetchBankOfCanadaOptions::end` | same | a `ducat::convert::Date` |
| `FetchBankOfCanadaOptions#fetch` | the `&mut impl Transport` argument | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchBankOfCanadaOptions#signal` | — | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) | the transport cancels |
| `FetchBankOfCanadaOptions#start` | `FetchBankOfCanadaOptions::start` | same |  |
| `FetchBankOfCanadaOptions#timeout` | `UreqTransport::with_timeout` | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbOptions` | `ducat_fetch::FetchEcbOptions` | same |  |
| `FetchEcbOptions#availableAt` | `FetchEcbOptions::available_at` | same |  |
| `FetchEcbOptions#fetch` | the `&mut impl Transport` argument | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbOptions#history` | `FetchEcbOptions::history` (`EcbHistory`) | divergent: [an enum](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbOptions#signal` | — | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbOptions#timeout` | `UreqTransport::with_timeout` | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbRangeOptions` | `ducat_fetch::FetchEcbRangeOptions` | same |  |
| `FetchEcbRangeOptions#availableAt` | `FetchEcbRangeOptions::available_at` | same |  |
| `FetchEcbRangeOptions#currencies` | `FetchEcbRangeOptions::currencies` | same | `&[&str]` |
| `FetchEcbRangeOptions#end` | `FetchEcbRangeOptions::end` | same |  |
| `FetchEcbRangeOptions#fetch` | the `&mut impl Transport` argument | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbRangeOptions#signal` | — | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbRangeOptions#start` | `FetchEcbRangeOptions::start` | same |  |
| `FetchEcbRangeOptions#timeout` | `UreqTransport::with_timeout` | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchRatesError` | `ducat_fetch::FetchError::Status` | same |  |
| `FetchRatesError#status` | `FetchError::status` | same |  |
| `FetchRatesError#url` | `FetchError::url` | same |  |
| `fetchBankOfCanada` | `ducat_fetch::fetch_bank_of_canada`, `bank_of_canada_request`/`bank_of_canada_tables` | same |  |
| `fetchEcb` | `ducat_fetch::fetch_ecb`, `ecb_request`/`ecb_tables` | same |  |
| `fetchEcbRange` | `ducat_fetch::fetch_ecb_range`, `ecb_range_requests`/`ecb_range_tables` | divergent: [the two requests run one after the other](design.md#milestone-7b-fetching-rates) |  |

### `./exact`

[`ducat::exact`](../crates/ducat/src/exact.rs) (feature `exact`): `ExactMoney<C>` and `AnyExactMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `ExactMoney` | `ducat::exact::ExactMoney<C>`, `AnyExactMoney` | same | |
| `ExactMoney#abs` | `ExactMoney::abs` | missing | add `AnyExactMoney::abs` |
| `ExactMoney#add` | `Add` for `ExactMoney<C>`; `AnyExactMoney::checked_add` | same | `AnyExactMoney::checked_add` takes only `&AnyExactMoney`: call `.exact()` on an `AnyMoney` first |
| `ExactMoney#clamp` | — | missing | `Ord::clamp` panics for `lo > hi` where TS throws `RangeError`, and TS also takes `Money` bounds; the fix adds a `Result`-returning `clamp` taking exact or `Money` bounds |
| `ExactMoney#compare` | `Ord`; `AnyExactMoney::compare` | same | |
| `ExactMoney#convert` | `ducat::convert::Rate::convert_exact`, `AnyRate::convert_exact` | same | on the rate, not the money |
| `ExactMoney#currency` | `ExactMoney::currency` | same | |
| `ExactMoney#den` | `ExactMoney::value` → `Ratio::denom` | same | |
| `ExactMoney#denominator` | `ExactMoney::value` → `Ratio::denom` | same | |
| `ExactMoney#divide` | `ExactMoney::divide` | same | |
| `ExactMoney#equals` | `==` | same | `==` within one type only; call `.exact()` on a `Money` first; `AnyExactMoney` in different currencies is `!=` |
| `ExactMoney#greaterThan` | `>` | same | `>`; `compare(..)?.is_gt()`; call `.exact()` on a `Money` first |
| `ExactMoney#greaterThanOrEqual` | `>=` | same | `>=`; `compare(..)?.is_ge()`; call `.exact()` on a `Money` first |
| `ExactMoney#isExact` | `ExactMoney::is_exact` | missing | return `Result` with Err(InvalidScale) for scale > MAX_SCALE; add `AnyExactMoney::is_exact` |
| `ExactMoney#isNegative` | — | missing | `signum() < 0` is the workaround |
| `ExactMoney#isPositive` | — | missing | `signum() > 0` |
| `ExactMoney#isZero` | — | missing | `signum() == 0` |
| `ExactMoney#lessThan` | `<` | same | `<` (typed); `AnyExactMoney::compare(..)?.is_lt()`; call `.exact()` on a `Money` first |
| `ExactMoney#lessThanOrEqual` | `<=` | same | `<=`; `compare(..)?.is_le()`; call `.exact()` on a `Money` first |
| `ExactMoney#max` | `Ord::max` | missing | add `AnyExactMoney::max` (Err CurrencyMismatch) |
| `ExactMoney#min` | `Ord::min` | missing | add `AnyExactMoney::min` (Err CurrencyMismatch), variadic via iterator |
| `ExactMoney#multiply` | `ExactMoney::multiply` | same | |
| `ExactMoney#negate` | `Neg` | missing | add `Neg` for `AnyExactMoney` |
| `ExactMoney#num` | `ExactMoney::value` → `Ratio::numer` | same | |
| `ExactMoney#numerator` | `ExactMoney::value` → `Ratio::numer` | same | |
| `ExactMoney#percentage` | `ExactMoney::percentage` | missing | add `AnyExactMoney::percentage` |
| `ExactMoney#ratioOf` | `ExactMoney::ratio_of` | missing | add `AnyExactMoney::ratio_of` (Err CurrencyMismatch/DivisionByZero); accept a `Money` total |
| `ExactMoney#round` | `ExactMoney::round`, `AnyExactMoney::round` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `ExactMoney#roundWithResidual` | `ExactMoney::round_with_residual` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the mode is required |
| `ExactMoney#sign` | `ExactMoney::signum` | missing | add `AnyExactMoney::signum` |
| `ExactMoney#subtract` | `Sub`; `AnyExactMoney::checked_sub` | same | as add: `checked_sub` takes only `&AnyExactMoney` |
| `ExactMoney#toJSON` | — | missing | no `serde` impls for `ExactMoney` |
| `ExactMoney#toMoney` | `ExactMoney::to_money`, `AnyExactMoney::to_money` | missing | Err(InvalidScale) for minimum_scale > MAX_SCALE and for a value needing > MAX_SCALE places |
| `ExactMoney#toNumber` | — | missing | decided ([floats only go out](design.md#parity-decisions)): an explicitly lossy, output-only `to_f64`; for display or interop only, never round-trip; never called inside ducat |
| `ExactMoney#toString` | `Display` | same | |
| `ExactTaxBreakdown` | `ducat::exact::ExactTaxBreakdown` | same | |
| `Money#addTaxExact` | `ExactMoney::add_tax` (via `Money::exact`) | same | |
| `Money#exact` | `Money::exact`, `AnyMoney::exact` | same | |
| `Money#extractTaxExact` | `ExactMoney::extract_tax` | same | |
| `Money#multiplyExact` | `Money::multiply_exact`, `AnyMoney::multiply_exact` | missing | Err(InvalidScale) (not Rounding) when the product needs > MAX_SCALE places |
| `Rounded` | `ducat::exact::Rounded` | same | `value`, `residual` |
| `addTaxExact` | `ExactMoney::add_tax` | same | |
| `exact` | `Money::exact` | same | |
| `extractTaxExact` | `ExactMoney::extract_tax` | same | |
| `isExactMoney` | — | not ported: by design (the type system) | |
| `multiplyExact` | `Money::multiply_exact` | missing | as Money#multiplyExact |
| `sumExact` | `Sum` for `ExactMoney<C>` | same | `AnyExactMoney` folds with `checked_add` |

### `./policy`

`ducat::policy` (feature `policy`); a policy is accepted wherever a mode is, as `impl Into<RoundingInput>`.

| TS | Rust | status | note |
|---|---|---|---|
| `RoundingPolicyOptions` | the builder of [`RoundingPolicy`](../crates/ducat/src/policy.rs) | same | |
| `RoundingPolicyOptions#currency` | `RoundingPolicy::for_currency` | same | |
| `RoundingPolicyOptions#increment` | `RoundingPolicy::with_increment` | same | |
| `RoundingPolicyOptions#rounding` | `RoundingPolicy::with_mode` | same | |
| `RoundingPolicyOptions#scale` | `RoundingPolicy::with_scale` | same | |
| `assertScale` | `Money::check_policy`, `AnyMoney::check_policy` | same | `Error::OffPolicy` |
| `isoPolicy` | `RoundingPolicy::new` (the currency's exponent, no increment) | same | `RoundingPolicy::ISO` (= `new(Rounding::HalfExpand)`, also `Default`) |
| `roundingPolicy` | `RoundingPolicy::new` and its builder | same | |

### `./cash`

[`ducat::cash`](../crates/ducat/src/cash.rs) (feature `cash`); one options struct, [`CashOptions`](../crates/ducat/src/cash.rs), serves the three TS options types.

| TS | Rust | status | note |
|---|---|---|---|
| `CASH_RULES` | `ducat::cash::cash_rules` | same | an iterator of `CashRule` |
| `CashRoundOptions` | `ducat::cash::CashOptions` | same | |
| `CashRoundOptions#country` | `CashOptions::country` | same | |
| `CashRoundOptions#includeUnverified` | `CashOptions::verified_only` | same | the inverse flag |
| `CashRoundOptions#rounding` | `CashOptions::rounding` | same | |
| `CashRule` | `ducat::cash::CashRule` | same | |
| `CashUnitOptions` | `ducat::cash::CashOptions` | same | |
| `CashUnitOptions#country` | `CashOptions::country` | same | |
| `CashUnitOptions#includeUnverified` | `CashOptions::verified_only` | same | |
| `CurrencyDigitsOptions` | `ducat::cash::CashOptions` | same | |
| `CurrencyDigitsOptions#country` | `CashOptions::country` | same | |
| `CurrencyDigitsOptions#includeUnverified` | `CashOptions::verified_only` | same | |
| `CurrencyDigitsOptions#usage` | `ducat::cash_digits`, `CurrencyCode::exponent` | divergent: [two functions, not a `usage` field](design.md#parity-decisions) | `'cash'`: `cash_digits`; `'standard'`: `CurrencyCode::exponent` |
| `Money#cashRound` | `Money::cash_round`, `AnyMoney::cash_round` | same | |
| `Money#roundToIncrement` | `Money::round_to_increment`, `AnyMoney::round_to_increment` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `cashPolicy` | `ducat::cash::cash_policy` (with `policy`) | same | |
| `cashRound` | `Money::cash_round` | same | |
| `cashRule` | `ducat::cash::cash_rule` | same | |
| `cashUnit` | `ducat::cash::cash_unit` | same | returns an `AnyMoney` at the exponent; `.to_decimal()` gives TS's string |
| `currencyDigits` | `ducat::cash::cash_digits`, `ducat::cash::cldr_cash` | same | `'cash'`: `cash_digits`; `'standard'` (the default): `CurrencyCode::exponent()`; `cldr_cash` is Rust-only and a different figure (HUF) |
| `roundToIncrement` | `Money::round_to_increment` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |

### `./format`

The crate [`ducat-format`](../crates/ducat-format/src/format.rs): CLDR 48's data with ICU 78.3's overrides, no ICU; a feature per language. ducat's `FormatOptions` extends `Intl.NumberFormatOptions` and passes the rest to `Intl`; `ducat_format::FormatOptions` has the currency-relevant subset.

| TS | Rust | status | note |
|---|---|---|---|
| `FormatOptions` | `ducat_format::FormatOptions` | same |  |
| `FormatOptions#compactDisplay` | — | missing | Intl's `compactDisplay`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#currency` | — | not ported: by design ([money is always formatted as its own currency](design.md#parity-decisions)) | ducat sets it from the money; overriding it formats another code |
| `FormatOptions#currencyDisplay` | `FormatOptions::currency_display`, `display` (`CurrencyDisplay`) | same |  |
| `FormatOptions#currencySign` | `FormatOptions::currency_sign`, `sign` (`CurrencySign`) | same |  |
| `FormatOptions#digits` | `FormatOptions::digits` | same |  |
| `FormatOptions#localeMatcher` | — | missing | Intl's `localeMatcher`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#maximumFractionDigits` | `FormatOptions::maximum_fraction_digits` | same |  |
| `FormatOptions#maximumSignificantDigits` | `FormatOptions::maximum_significant_digits` | same |  |
| `FormatOptions#minimumFractionDigits` | `FormatOptions::minimum_fraction_digits` | same |  |
| `FormatOptions#minimumIntegerDigits` | — | missing | Intl's `minimumIntegerDigits`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#minimumSignificantDigits` | — | missing | Intl's `minimumSignificantDigits`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#notation` | — | missing | Intl's `notation`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#numberingSystem` | — | missing | Intl's `numberingSystem`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#rounding` | `FormatOptions::rounding` | same |  |
| `FormatOptions#roundingIncrement` | `FormatOptions::rounding_increment` | same |  |
| `FormatOptions#roundingMode` | — | missing | Intl's `roundingMode`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#roundingPriority` | — | missing | Intl's `roundingPriority`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#signDisplay` | — | missing | Intl's `signDisplay`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#style` | — | not ported: by design ([money is always formatted as its own currency](design.md#parity-decisions)) | ducat sets `currency`; another style drops the currency |
| `FormatOptions#trailingZeroDisplay` | — | missing | Intl's `trailingZeroDisplay`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#unit` | — | not ported: by design ([money is always formatted as its own currency](design.md#parity-decisions); only with `style: 'unit'`) |  |
| `FormatOptions#unitDisplay` | — | not ported: by design ([money is always formatted as its own currency](design.md#parity-decisions); only with `style: 'unit'`) |  |
| `FormatOptions#useGrouping` | — | missing | Intl's `useGrouping`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `Money#format` | `ducat_format::format` | divergent: [CLDR 48 data, a fixed set of locales](design.md#coverage) | a free function over `AnyMoney` and a `Locale` |
| `Money#formatToParts` | `ducat_format::format_to_parts` | divergent: [CLDR 48 data, a fixed set of locales](design.md#coverage) | `Part`, `PartKind` |
| `format` | `ducat_format::format` | divergent: [CLDR 48 data, a fixed set of locales](design.md#coverage) |  |
| `formatToParts` | `ducat_format::format_to_parts` | divergent: [CLDR 48 data, a fixed set of locales](design.md#coverage) |  |

### `./fixed`

[`ducat::fixed::Fixed`](../crates/ducat/src/fixed.rs) (feature `fixed`).

| TS | Rust | status | note |
|---|---|---|---|
| `ArithmeticOptions` | `Fixed::multiply_at`, `Fixed::divide_at` | same | |
| `ArithmeticOptions#scale` | the `scale` argument of `multiply_at`/`divide_at` | same | |
| `Fixed` | `ducat::fixed::Fixed` | same | |
| `Fixed#abs` | `Fixed::abs` | same | |
| `Fixed#add` | `Add` for `Fixed` | same | |
| `Fixed#compare` | `Fixed::compare`, `Ord` | same | |
| `Fixed#divide` | `Fixed::divide`, `Fixed::divide_at` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Fixed#equals` | `==` | same | |
| `Fixed#greaterThan` | `>` | same | |
| `Fixed#greaterThanOrEqual` | `>=` | same | |
| `Fixed#isNegative` | `Fixed::is_negative` | same | |
| `Fixed#isPositive` | `Fixed::is_positive` | same | |
| `Fixed#isZero` | `Fixed::is_zero` | same | |
| `Fixed#lessThan` | `<` | same | |
| `Fixed#lessThanOrEqual` | `<=` | same | |
| `Fixed#multiply` | `Fixed::multiply`, `Fixed::multiply_at` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Fixed#negate` | `Neg` | same | |
| `Fixed#round` | `Fixed::to_scale` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | no separate `round`: `to_scale(0, mode)` |
| `Fixed#scale` | `Fixed::scale` | same | |
| `Fixed#sign` | `Fixed::signum` | same | |
| `Fixed#subtract` | `Sub` | same | |
| `Fixed#toJSON` | `serde::Serialize` for `Fixed` | same | |
| `Fixed#toNumber` | — | missing | decided ([floats only go out](design.md#parity-decisions)): an explicitly lossy, output-only `to_f64`; for display or interop only, never round-trip; never called inside ducat |
| `Fixed#toRatio` | `Fixed::to_ratio` | same | |
| `Fixed#toScale` | `Fixed::to_scale` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the mode is required |
| `Fixed#toScaled` | `Fixed::units`, `Fixed::scale` | same | |
| `Fixed#toString` | `Display` | same | |
| `Fixed#trimScale` | `Fixed::trim_scale` | missing | Err(InvalidScale) for minimum > MAX_SCALE (return `Result`) |
| `Fixed#value` | `Fixed::units` | same | |
| `FixedInput` | `Fixed::new`, `FromStr`, `parse_at`, `from_f64`, `From<Int>` | same | |
| `FixedOptions` | arguments of `Fixed::parse_at` | same | |
| `FixedOptions#rounding` | the `Rounding` argument of `parse_at` | missing | add `Fixed::from_f64_at(value, scale, rounding)` (as `Money::from_f64_at`) |
| `FixedOptions#scale` | the `scale` argument of `parse_at` | same | |
| `ScaledInteger` | `Fixed::units`, `Fixed::scale` | same | no named type |
| `fixed` | `FromStr`, `Fixed::parse_at`, `Fixed::from_f64` | same | |
| `fromScaled` | `Fixed::new` | same | |
| `isFixed` | — | not ported: by design (the type system) | |

### `./fixed/money`

The conversions are in `ducat::fixed` (feature `fixed`). It re-exports `./fixed`.

| TS | Rust | status | note |
|---|---|---|---|
| `Fixed#toMoney` | `Fixed::to_money`, `Fixed::to_any_money` | same | the `Rounding` is required |
| `Money#toFixedPoint` | `Money::to_fixed`, `AnyMoney::to_fixed` | same | |
| `fixedToMoney` | `Fixed::to_money`, `Fixed::to_any_money` | same | |
| `moneyToFixed` | `Money::to_fixed` | same | |

### `./parse`

The crate [`ducat-format`](../crates/ducat-format/src/parse.rs): `parse` and `parse_money` as ducat's; input is bounded (`MAX_INPUT`). `ducat_format::Error` and `SyntaxError` carry the kinds of ducat's `SyntaxError`/`RangeError`s here.

| TS | Rust | status | note |
|---|---|---|---|
| `ParseMoneyOptions` | `ducat_format::ParseMoneyOptions` | same |  |
| `ParseMoneyOptions#currencies` | `ParseMoneyOptions::currencies` | same |  |
| `ParseMoneyOptions#hint` | `ParseMoneyOptions::hint` | same |  |
| `ParseMoneyOptions#lenient` | `ParseMoneyOptions::lenient` | same |  |
| `ParseMoneyOptions#rounding` | `ParseMoneyOptions::rounding` | same |  |
| `ParseMoneyOptions#scale` | `ParseMoneyOptions::scale` | same |  |
| `ParseMoneyOptions#symbols` | `ParseMoneyOptions::symbols` | same |  |
| `ParseOptions` | `ducat_format::ParseOptions` | same |  |
| `ParseOptions#lenient` | `ParseOptions::lenient` | same |  |
| `ParseOptions#rounding` | `ParseOptions::rounding` | same |  |
| `ParseOptions#scale` | `ParseOptions::scale` | same |  |
| `parse` | `ducat_format::parse` | divergent: [refuses a locale the build lacks](design.md#coverage) | `Locale::has_data` |
| `parseMoney` | `ducat_format::parse_money` | divergent: [refuses a locale the build lacks](design.md#coverage) |  |

### `./stripe`

[`ducat::processors::stripe`](../crates/ducat/src/processors/stripe.rs) (feature `stripe`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `Money#toStripe` | `Money::to_stripe`, `AnyMoney::to_stripe` | same |  |
| `Money#toStripeAmount` | `Money::to_stripe_amount` | same |  |
| `STRIPE_RULES` | `ducat::processors::stripe::rule` | missing | per-currency `rule` only; the table can't be listed. Fix: a public `currencies()` iterator (or `pub` table) |
| `StripeAmountOptions` | `ducat::processors::stripe::StripeOptions` | same |  |
| `StripeAmountOptions#payout` | `StripeOptions::payout` | same |  |
| `StripeAmountOptions#rounding` | `StripeOptions::rounding` | same |  |
| `fromStripe` | `Money::from_stripe`, `AnyMoney::from_stripe` | divergent: [integer amounts are `i64`, read back whatever their size](design.md#milestone-5c-payment-processors) |  |
| `isStripeCurrency` | `ducat::processors::stripe::is_currency` | same |  |
| `stripeExponent` | `ducat::processors::stripe::exponent` | same |  |
| `toStripe` | `Money::to_stripe` | same |  |
| `toStripeAmount` | `Money::to_stripe_amount`, `AnyMoney::to_stripe_amount` | same | an `i64`; the same failures in ducat's order: `UnsupportedCurrency` (TS `RangeError`), `Rounding` (`RoundingError`), `AmountTooLarge` beyond 2^53 − 1 (`RangeError`). The `i64` divergence is the read-back path (`fromStripe`) only |

### `./adyen`

[`ducat::processors::adyen`](../crates/ducat/src/processors/adyen.rs) (feature `adyen`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `ADYEN_EXPONENTS` | `ducat::processors::adyen::exponent`, `rule` | missing | `exponent`/`rule` lookups only; the table can't be listed. Fix: a public `currencies()` iterator |
| `Money#toAdyen` | `Money::to_adyen`, `AnyMoney::to_adyen` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |
| `adyenExponent` | `ducat::processors::adyen::exponent` | same |  |
| `fromAdyen` | `Money::from_adyen`, `AnyMoney::from_adyen` | divergent: [integer amounts are `i64`, read back whatever their size](design.md#milestone-5c-payment-processors) |  |
| `isAdyenCurrency` | `ducat::processors::adyen::is_currency` | same |  |
| `toAdyen` | `Money::to_adyen` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |

### `./checkout`

[`ducat::processors::checkout`](../crates/ducat/src/processors/checkout.rs) (feature `checkout`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `CHECKOUT_RULES` | `ducat::processors::checkout::rule` (`CheckoutRule`) | missing | `rule` lookup only; the table can't be listed. Fix: a public `currencies()` iterator |
| `CheckoutAmountOptions` | `ducat::processors::checkout::CheckoutOptions` | same |  |
| `CheckoutAmountOptions#rounding` | `CheckoutOptions::rounding` | same |  |
| `CheckoutAmountOptions#standalone` | `CheckoutOptions::standalone` | same |  |
| `Money#toCheckout` | `Money::to_checkout`, `AnyMoney::to_checkout` | missing | the `currency` field isn't uppercased. Fix: `to_ascii_uppercase()` the code, as TS does |
| `Money#toCheckoutAmount` | `Money::to_checkout_amount` | same |  |
| `checkoutExponent` | `ducat::processors::checkout::exponent` | same |  |
| `fromCheckout` | `Money::from_checkout`, `AnyMoney::from_checkout` | divergent: [integer amounts are `i64`, read back whatever their size](design.md#milestone-5c-payment-processors) |  |
| `isCheckoutCurrency` | `ducat::processors::checkout::is_currency` | same |  |
| `toCheckout` | `Money::to_checkout` | missing | as `Money#toCheckout` |
| `toCheckoutAmount` | `Money::to_checkout_amount`, `AnyMoney::to_checkout_amount` | same | an `i64`; the same failures in ducat's order: `UnsupportedCurrency` (TS `RangeError`), `Rounding` (`RoundingError`), `AmountTooLarge` beyond 2^53 − 1, `NegativeAmount` (`RangeError`). The `i64` divergence is the read-back path (`fromCheckout`) only |

### `./paypal`

[`ducat::processors::paypal`](../crates/ducat/src/processors/paypal.rs) (feature `paypal`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `Money#toPayPal` | `Money::to_paypal`, `AnyMoney::to_paypal` | missing | `currency_code` isn't uppercased. Fix: `to_ascii_uppercase()` the code |
| `Money#toPayPalValue` | `Money::to_paypal_value` | same |  |
| `PAYPAL_EXPONENTS` | `ducat::processors::paypal::exponent`, `rule` | missing | `exponent`/`rule` lookups only. Fix: a public `currencies()` iterator |
| `PayPalAmountOptions` | the `Rounding` argument | same |  |
| `PayPalAmountOptions#rounding` | the `Rounding` argument of `to_paypal` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |
| `fromPayPal` | `Money::from_paypal`, `AnyMoney::from_paypal` | same |  |
| `isPayPalCurrency` | `ducat::processors::paypal::is_currency` | same |  |
| `paypalExponent` | `ducat::processors::paypal::exponent` | same |  |
| `toPayPal` | `Money::to_paypal` | missing | as `Money#toPayPal` |
| `toPayPalValue` | `Money::to_paypal_value` | same |  |

### `./braintree`

[`ducat::processors::braintree`](../crates/ducat/src/processors/braintree.rs) (feature `braintree`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `BRAINTREE_EXPONENTS` | `ducat::processors::braintree::exponent`, `rule` | missing | `exponent`/`rule` lookups only. Fix: a public `currencies()` iterator |
| `BraintreeAmountOptions` | the `Rounding` argument | same |  |
| `BraintreeAmountOptions#rounding` | the `Rounding` argument of `to_braintree` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |
| `Money#toBraintree` | `Money::to_braintree`, `AnyMoney::to_braintree` | same |  |
| `braintreeExponent` | `ducat::processors::braintree::exponent` | same |  |
| `fromBraintree` | `Money::from_braintree`, `AnyMoney::from_braintree` | same |  |
| `isBraintreeCurrency` | `ducat::processors::braintree::is_currency` | same |  |
| `toBraintree` | `Money::to_braintree` | same |  |

### `./klarna`

[`ducat::processors::klarna`](../crates/ducat/src/processors/klarna.rs) (feature `klarna`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `KLARNA_EXPONENTS` | `ducat::processors::klarna::exponent`, `rule` | missing | `exponent`/`rule` lookups only. Fix: a public `currencies()` iterator |
| `KlarnaAmountOptions` | the `Rounding` argument | same |  |
| `KlarnaAmountOptions#rounding` | the `Rounding` argument of `to_klarna` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |
| `Money#toKlarna` | `Money::to_klarna`, `AnyMoney::to_klarna` | same |  |
| `fromKlarna` | `Money::from_klarna`, `AnyMoney::from_klarna` | divergent: [integer amounts are `i64`, read back whatever their size](design.md#milestone-5c-payment-processors) |  |
| `isKlarnaCurrency` | `ducat::processors::klarna::is_currency` | same |  |
| `klarnaExponent` | `ducat::processors::klarna::exponent` | same |  |
| `toKlarna` | `Money::to_klarna`, `AnyMoney::to_klarna` | same | an `i64`; the rounding is an argument (`Rounding::Unnecessary` is TS's default); the same failures in ducat's order: `UnsupportedCurrency` (TS `RangeError`), `Rounding` (`RoundingError`), `AmountTooLarge` beyond 2^53 − 1 (`RangeError`). The `i64` divergence is the read-back path (`fromKlarna`) only |

### `./stripe-fx`

[`ducat::convert::stripe_fx`](../crates/ducat/src/convert/stripe_fx.rs) (feature `stripe-fx`).

| TS | Rust | status | note |
|---|---|---|---|
| `StripeBalanceTransaction` | `ducat::convert::stripe_fx::StripeBalanceTransaction` | same | `exchange_rate` is the JSON number's text |
| `stripeImpliedRate` | `ducat::convert::stripe_fx::stripe_implied_rate` | same | takes `&AnyMoney`; the balance currency must be a Stripe currency (`UnsupportedCurrency`); a zero or negative quotient is `NonPositiveRate`; `amount` is an `i64`, as `fromStripe` |
| `stripeRate` | `ducat::convert::stripe_fx::stripe_rate` | same | `exchange_rate` is the number's text, read as ducat reads the number (`TooManyDigits` past 15 significant digits unless a safe integer); codes must be ISO 4217 or `historic` (`UnknownCurrency`) |

### `./adyen-fx`

[`ducat::convert::adyen_fx`](../crates/ducat/src/convert/adyen_fx.rs) (feature `adyen-fx`).

| TS | Rust | status | note |
|---|---|---|---|
| `AdyenRateOptions` | — | missing | its one field is `timeZone` |
| `AdyenRateOptions#timeZone` | — | missing | an IANA zone for the TimeZone column all year; decided: optional `tz` feature on `ducat` (jiff, bundled tzdb, off by default, not `no_std`) |
| `AdyenSettlementRow` | the row argument of `adyen_rate` (column name to value) | same |  |
| `adyenRate` | `ducat::convert::adyen_fx::adyen_rate` | divergent: [Adyen's Creation Date](design.md#parity-decisions) | abbreviations and offsets only; a Creation Date `Date.parse` refuses gives the local day, not ducat's `RangeError`; codes ISO or historic, as given |

### `./prisma`

Not ported: Prisma result-extension fields and `Decimal` helpers are an adapter for a TypeScript ORM (design.md, "Mapping ducat's entries"). The storage layouts they serve are `minor_units`/`MinorColumn<C>` and `Decimal` in `ducat-sqlx` and `ducat-diesel`.

| TS | Rust | status | note |
|---|---|---|---|
| `DecimalLike` | — | not ported: by design (adapter for a TypeScript ORM) | structural type of `Prisma.Decimal`/decimal.js; the exact column value is `ducat_sqlx::Decimal` / `ducat_diesel::Decimal` |
| `DecimalLike#toFixed` | — | not ported: by design (adapter for a TypeScript ORM) | `Decimal`'s `Display` gives the exact text |
| `Money#toDecimalValue` | — | not ported: by design (adapter for a TypeScript ORM) | prototype method; `ducat_sqlx::Decimal::from_money` covers the need |
| `ScaleColumnOption` | — | missing | also the `{ scale }` option of the Drizzle entries' `moneyMinor` and Kysely's `setMoney`/`selectMoney` (ducat#380); a scale column beside minor units has no counterpart in `ducat-sqlx` or `ducat-diesel` |
| `ScaleColumnOption#scale` | — | missing | the scale column's name; for Prisma alone a stored scale is `Decimal::new(units, scale)`, but the Drizzle column shape needs a Rust scale column |
| `decimalMoneyField` | — | not ported: by design (adapter for a TypeScript ORM) | `Decimal::to_money_at_exponent`, or `DecimalColumn<C>` for a fixed currency |
| `fromDecimal` | — | not ported: by design (adapter for a TypeScript ORM) | `Decimal::to_money_at_exponent` (or `"…".parse::<Money<C>>()`) |
| `minorMoneyField` | — | not ported: by design (adapter for a TypeScript ORM) | `MinorColumn<C>`, or `AnyMoney::from_minor` with the currency column |
| `toDecimalValue` | — | not ported: by design (adapter for a TypeScript ORM) | `Decimal::from_money` |
| `toMinorColumns` | — | not ported: by design (adapter for a TypeScript ORM) | `minor_units` plus `currency()`; with a scale column, `Decimal::from_money`'s `units` and `scale` |

### `./drizzle/pg`

The column shapes (not Drizzle, a TypeScript ORM) are in `ducat-sqlx` and `ducat-diesel` (feature `postgres`, the default): `DecimalColumn<C>`, `MinorColumn<C>`, `Decimal`, `DecimalColumnSize` at each crate's root, shared through the internal `ducat-sql-core`. The JSON shape is a known gap.

| TS | Rust | status | note |
|---|---|---|---|
| `DEFAULT_DECIMAL_SIZE` | [`ducat_sqlx::DEFAULT_DECIMAL_SIZE`](../crates/ducat-sqlx/src/decimal.rs), [`ducat_diesel::DEFAULT_DECIMAL_SIZE`](../crates/ducat-diesel/src/decimal.rs) | same | NUMERIC(19,4) |
| `DecimalColumnSize` | [`ducat_sqlx::DecimalColumnSize`](../crates/ducat-sqlx/src/decimal.rs), [`ducat_diesel::DecimalColumnSize`](../crates/ducat-diesel/src/decimal.rs) | same | a validated struct (`new(precision, scale)`: precision at least 1, scale at most precision, else `Error::InvalidColumnSize`) with `precision()`/`scale()`, `check_currency` and `fit` |
| `moneyDecimal` | [`ducat_sqlx::DecimalColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::DecimalColumn`](../crates/ducat-diesel/src/money.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | `DecimalColumn<C>` has no size: check it with `DecimalColumnSize::check_currency`, and bind `fit`'s `Decimal` after `to_decimal`'s scale check |
| `moneyJson` | — | missing | design.md Known gaps: the JSON column shapes (`moneyJson`, `jsonToDriver`) in both crates; workaround: a JSON/TEXT column with `ducat`'s `serde` impls |
| `moneyMinor` | [`ducat_sqlx::MinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::MinorColumn`](../crates/ducat-diesel/src/money.rs) | missing | BIGINT; `ScaleMismatch`, `OutOfRange` beyond the i64 range; the `{ scale }` option (a scale column) has no Rust counterpart (ducat#380) |
| `scaledMoney` | — | missing | reads a minor-units column with its scale column (ducat#380); Rust needs a scale column for `MinorColumn<C>` in `ducat-sqlx` and `ducat-diesel` |

### `./drizzle/mysql`

The MySQL column shapes are `ducat-sqlx`'s and `ducat-diesel`'s root types with the `mysql` feature (impls in each crate's `mysql` module). `DEFAULT_DECIMAL_SIZE` and `DecimalColumnSize` are homed in `./drizzle/pg`.

| TS | Rust | status | note |
|---|---|---|---|
| `moneyDecimal` | [`ducat_sqlx::DecimalColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::DecimalColumn`](../crates/ducat-diesel/src/money.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | DECIMAL; size via `DecimalColumnSize::check_currency`/`fit`, not the column; FLOAT/DOUBLE is `Error::UnexpectedType`; text read as `-?[0-9]+(\.[0-9]+)?` |
| `moneyJson` | — | missing | design.md Known gaps (JSON column shapes); workaround: a JSON column with `ducat`'s `serde` impls |
| `moneyMinor` | [`ducat_sqlx::MinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::MinorColumn`](../crates/ducat-diesel/src/money.rs) | missing | BIGINT; signed integer types only (`UnexpectedType`); the `{ scale }` option has no Rust counterpart |
| `scaledMoney` | — | missing | reads a minor-units column with its scale column (ducat#380); Rust needs a scale column for `MinorColumn<C>` in `ducat-sqlx` and `ducat-diesel` |

### `./drizzle/sqlite`

The SQLite column shapes are `ducat-sqlx`'s and `ducat-diesel`'s root types with the `sqlite` feature (impls in each crate's `sqlite` module; SQLite bundled).

| TS | Rust | status | note |
|---|---|---|---|
| `moneyDecimal` | [`ducat_sqlx::DecimalColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::DecimalColumn`](../crates/ducat-diesel/src/money.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | TEXT read as `-?[0-9]+(\.[0-9]+)?` only (ducat's `money()` also takes `+` and exponents); a REAL value is `Error::UnexpectedType` |
| `moneyJson` | — | missing | design.md Known gaps (JSON column shapes); workaround: a TEXT column with `ducat`'s `serde` impls |
| `moneyMinor` | [`ducat_sqlx::MinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::MinorColumn`](../crates/ducat-diesel/src/money.rs) | missing | INTEGER; storage class checked per value; the `{ scale }` option has no Rust counterpart |
| `scaledMoney` | — | missing | reads a minor-units column with its scale column (ducat#380); Rust needs a scale column for `MinorColumn<C>` in `ducat-sqlx` and `ducat-diesel` |

### `./zod`

Not ported: zod is a TypeScript schema library, and `ducat`'s `serde` feature (`{"amount":"12.34","currency":"EUR"}`, read at the currency's exponent without rounding) covers validation (design.md, "Mapping ducat's entries").

| TS | Rust | status | note |
|---|---|---|---|
| `MoneyCodec` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | |
| `MoneyFor` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | a type-level helper; `Money<C>` / `AnyMoney` already type the result |
| `MoneySchemaOptions` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | |
| `MoneySchemaOptions#currency` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | deserialize into `Money<C>` to fix the currency |
| `MoneySchemaOptions#maxDigits` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | callers bound untrusted input's length (design.md, choice 1) |
| `MoneySchemaOptions#rounding` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | `serde` never rounds; `parse_at` with a mode does |
| `MoneySchemaOptions#scale` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | `parse_at` |
| `moneyJSONSchema` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | |
| `moneySchema` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | `ducat`'s `Deserialize` for `Money<C>` / `AnyMoney` |

### `./valibot`

Not ported: valibot is a TypeScript schema library; `ducat`'s `serde` feature covers validation (design.md, "Mapping ducat's entries"). `MoneyFor` and `MoneySchemaOptions` are homed in `./zod`.

| TS | Rust | status | note |
|---|---|---|---|
| `MoneySchema` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | |
| `moneyJSONSchema` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | |
| `moneySchema` | — | not ported: by design (TypeScript schema library; `serde` covers validation) | `ducat`'s `Deserialize` for `Money<C>` / `AnyMoney` |

### `./pg`

`ducat-sqlx`'s and `ducat-diesel`'s `pg` modules (feature `postgres`, the default): exact NUMERIC and BIGINT, the composite type `ducat_money` (`PgMoney<M>`, `MoneyRecord`; diesel's `pg::sql_types::DucatMoney`) and its DDL. The node-postgres parser configuration has no counterpart. `DEFAULT_DECIMAL_SIZE` and `DecimalColumnSize` are homed in `./drizzle/pg`.

| TS | Rust | status | note |
|---|---|---|---|
| `ExactTypesOptions` | — | not ported: by design (configures node-postgres's text parsers; sqlx and diesel decode by type) | |
| `ExactTypesOptions#int8` | — | not ported: by design (configures node-postgres's text parsers; sqlx and diesel decode by type) | BIGINT decodes as `i64` / `MinorColumn<C>` |
| `ExactTypesOptions#money` | — | not ported: by design (configures node-postgres's text parsers; sqlx and diesel decode by type) | decode `PgMoney<M>` |
| `MONEY_TYPE_NAME` | [`ducat_sqlx::pg::MONEY_TYPE_NAME`](../crates/ducat-sqlx/src/pg/composite.rs), [`ducat_diesel::pg::MONEY_TYPE_NAME`](../crates/ducat-diesel/src/pg/composite.rs) | same | `"ducat_money"` |
| `MoneyTypeOids` | — | not ported: by design (node-postgres OID lookup; sqlx and diesel resolve type names themselves) | |
| `Queryable` | — | not ported: by design (node-postgres OID lookup; sqlx and diesel resolve type names themselves) | |
| `Queryable#query` | — | not ported: by design (node-postgres OID lookup; sqlx and diesel resolve type names themselves) | |
| `TypeParser` | — | not ported: by design (configures node-postgres's text parsers; sqlx and diesel decode by type) | |
| `TypeParserSource` | — | not ported: by design (configures node-postgres's text parsers; sqlx and diesel decode by type) | |
| `TypeParserSource#getTypeParser` | — | not ported: by design (configures node-postgres's text parsers; sqlx and diesel decode by type) | |
| `exactTypes` | — | not ported: by design (configures node-postgres's text parsers; sqlx and diesel decode by type) | `Decimal`, `MinorColumn<C>`, `PgMoney<M>` and their arrays decode exactly |
| `moneyTypeOids` | — | not ported: by design (node-postgres OID lookup; sqlx and diesel resolve type names themselves) | |
| `moneyTypeSql` | [`ducat_sqlx::pg::money_type_sql`](../crates/ducat-sqlx/src/pg/composite.rs), [`ducat_diesel::pg::money_type_sql`](../crates/ducat-diesel/src/pg/composite.rs) | same | `name` is required (pass `MONEY_TYPE_NAME`); returns `[String; 3]`; a bad name is `Error::Malformed` (TS `RangeError`) |
| `parseArray` | — | not ported: by design (configures node-postgres's text parsers; sqlx and diesel decode by type) | arrays (NUMERIC[], BIGINT[], `ducat_money[]`) decode as `Vec<_>` |
| `parseBigInt` | `ducat::Int`'s `FromStr` | divergent: [column and test-strategy shapes](design.md#parity-decisions) | `ducat::Int`'s `FromStr`, which also takes a leading `+`; sqlx and diesel decode BIGINT as `i64` |
| `parseMoneyComposite` | `FromStr` for [`ducat_sqlx::pg::MoneyRecord`](../crates/ducat-sqlx/src/pg/composite.rs) / [`ducat_diesel::pg::MoneyRecord`](../crates/ducat-diesel/src/pg/composite.rs), then `MoneyRecord::to_money` or `to_any_money` | divergent: [AnyMoney reads ISO codes only](design.md#milestone-7c-part-1-sqlx) | a custom code is `Error::UnknownCurrency` (give its `CurrencyCode` to `to_any_money`); a backslash before the closing `)` is refused; errors `Malformed`, `NullField` (TS `TypeError`), `NotANumber`, `Infinite`: every TS kind has a variant |
| `parseNumeric` | `FromStr` for [`ducat_sqlx::Decimal`](../crates/ducat-sqlx/src/decimal.rs) / [`ducat_diesel::Decimal`](../crates/ducat-diesel/src/decimal.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | returns a `Decimal`, not the text; more than 1000 decimals is `Ducat(InvalidScale)`; `NotANumber`, `Infinite`, `Malformed` (TS one `SyntaxError`) |
| `toMoneyComposite` | `Display` for [`ducat_sqlx::pg::MoneyRecord`](../crates/ducat-sqlx/src/pg/composite.rs) / [`ducat_diesel::pg::MoneyRecord`](../crates/ducat-diesel/src/pg/composite.rs) (`MoneyRecord::from_money`) | same | `PgMoney<M>` binds the composite directly in binary |
| `toNumeric` | [`ducat_sqlx::DecimalColumnSize::fit`](../crates/ducat-sqlx/src/decimal.rs), [`ducat_diesel::DecimalColumnSize::fit`](../crates/ducat-diesel/src/decimal.rs) | same | returns a `Decimal`; `ColumnScaleBelowExponent`, `WouldRound`, `TooManyIntegerDigits` |

### `./testing`

`ducat::testing` (feature `proptest`, not a default) with the crate-root macros `ducat::assert_money_eq!` and `ducat::assert_identical!`. Runner integration (matchers, equality tester, serializer) has no counterpart: Rust's test harness has no `expect` to extend, and `==` (by value), `Debug` and `Display` already do what the tester and serializer add.

| TS | Rust | status | note |
|---|---|---|---|
| `ExpectWithExtensions` | — | not ported: by design (Rust's test harness has no `expect` to extend) | |
| `ExpectWithExtensions#addEqualityTesters` | — | not ported: by design (Rust's test harness has no `expect` to extend) | |
| `ExpectWithExtensions#addSnapshotSerializer` | — | not ported: by design (Rust's test harness has no `expect` to extend) | |
| `ExpectWithExtensions#extend` | — | not ported: by design (Rust's test harness has no `expect` to extend) | |
| `MoneyEqualityTester` | — | not ported: by design (`==` is already by value) | |
| `MoneyMatcherContext` | — | not ported: by design (Rust's test harness has no `expect` to extend) | |
| `MoneyMatcherResult` | — | not ported: by design (Rust's test harness has no `expect` to extend) | |
| `MoneyMatchers` | — | not ported: by design (Rust's test harness has no `expect` to extend) | an augmentation interface; the macros and `assert!` stand in |
| `MoneyMatchers#toBeGreaterThanMoney` | — | not ported: by design (Rust's test harness has no `expect` to extend) | `assert!(a > b)` (`Money<C>`'s `Ord`; `AnyMoney::compare`) |
| `MoneyMatchers#toBeGreaterThanOrEqualMoney` | — | not ported: by design (Rust's test harness has no `expect` to extend) | `assert!(a >= b)` |
| `MoneyMatchers#toBeLessThanMoney` | — | not ported: by design (Rust's test harness has no `expect` to extend) | `assert!(a < b)` |
| `MoneyMatchers#toBeLessThanOrEqualMoney` | — | not ported: by design (Rust's test harness has no `expect` to extend) | `assert!(a <= b)` |
| `MoneyMatchers#toBeMoney` | [`ducat::assert_money_eq!`](../crates/ducat/src/testing.rs) | same | compares two money values by value, at any scale, rather than an amount and a code |
| `MoneyMatchers#toHaveCurrency` | — | not ported: by design (Rust's test harness has no `expect` to extend) | `assert_eq!(price.currency(), …)` |
| `MoneyMatchers#toSumTo` | — | not ported: by design (Rust's test harness has no `expect` to extend) | `assert_money_eq!(parts.iter().sum::<Money<Eur>>(), total)` |
| `installMoneyMatchers` | — | not ported: by design (Rust's test harness has no `expect` to extend) | the inspect hook is `Debug` (`Money(12.34 EUR)`) |
| `moneyEquality` | — | not ported: by design (`==` is already by value) | `PartialEq` on `Money<C>` and `AnyMoney` |
| `moneyMatchers` | — | not ported: by design (Rust's test harness has no `expect` to extend) | |
| `moneySerializer` | — | not ported: by design (`Display` and `Debug` already print `12.34 EUR`) | |

### `./testing/vitest`

No rows of its own: it re-exports `./testing` (`src/testing/vitest.ts`, which also installs `installMoneyMatchers` on Vitest's `expect` as a side effect and augments Vitest's `Matchers` interface with `MoneyMatchers`). Not ported by design: Rust's test harness has no `expect` to extend; `ducat::assert_money_eq!`, `ducat::assert_identical!`, `==`, `Debug` and `Display` cover what it adds (design.md, "Mapping ducat's entries").

### `./testing/jest`

No rows of its own: it re-exports `./testing` (`src/testing/jest.ts`, which also installs `installMoneyMatchers` on Jest's global `expect` as a side effect; it throws if there is no global `expect`). Not ported by design, for the same reason as `./testing/vitest`.

### `./testing/arbitraries`

`ducat::testing` (feature `proptest`): proptest strategies `currency_code` and `money`/`any_money`, configured by the `CurrencyOptions` and `MoneyOptions` builders, plus `Arbitrary` impls (`any::<Money<Eur>>()`, `any::<AnyMoney>()`, `any::<CurrencyCode>()`).

| TS | Rust | status | note |
|---|---|---|---|
| `ArbCurrencyOptions` | [`ducat::testing::CurrencyOptions`](../crates/ducat/src/testing.rs) | same | a builder; also `only`, `everything`, `historic`, `crypto`, `custom` |
| `ArbCurrencyOptions#all` | `ducat::testing::CurrencyOptions::all_iso` | same | |
| `ArbCurrencyOptions#exponents` | `ducat::testing::CurrencyOptions::exponents` | same | |
| `ArbCurrencyOptions#extra` | `ducat::testing::CurrencyOptions::extra` | same | takes `CurrencyCode`s (custom ones from `CurrencyCode::custom`) |
| `ArbMoneyOptions` | [`ducat::testing::MoneyOptions`](../crates/ducat/src/testing.rs) | same | a builder; also `magnitude` |
| `ArbMoneyOptions#currency` | `ducat::testing::MoneyOptions::currency`, `MoneyOptions::currencies` | same | an arbitrary of currencies is a `CurrencyOptions` pool; `money::<C>` fixes it in the type |
| `ArbMoneyOptions#max` | `ducat::testing::MoneyOptions::max` | same | a `Ratio` in major units |
| `ArbMoneyOptions#min` | `ducat::testing::MoneyOptions::min` | same | a `Ratio` in major units |
| `ArbMoneyOptions#scale` | `ducat::testing::MoneyOptions::scale`, `MoneyOptions::scales` | same | an arbitrary of scales is a range |
| `arbCurrency` | [`ducat::testing::currency_code`](../crates/ducat/src/testing.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | returns `BoxedStrategy<CurrencyCode>`; an empty pool panics (ducat: `RangeError`) |
| `arbMoney` | [`ducat::testing::money`](../crates/ducat/src/testing.rs), [`ducat::testing::any_money`](../crates/ducat/src/testing.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | `BoxedStrategy<Money<C>>` / `BoxedStrategy<AnyMoney>`; a bad scale or empty range panics (ducat: `RangeError`) |

### `./kysely`

Not ported: Kysely helpers are an adapter for a TypeScript query builder (design.md, "Mapping ducat's entries"). The layouts they read and write (minor units or a decimal beside a currency column) are `minor_units`, `MinorColumn<C>`, `Decimal` and `DecimalColumn<C>` with plain sqlx (`ducat-sqlx`) or diesel (`ducat-diesel`).

| TS | Rust | status | note |
|---|---|---|---|
| `DecimalAmountColumn` | — | not ported: by design (adapter for a TypeScript query builder) | `Decimal` |
| `FixedCurrency` | — | not ported: by design (adapter for a TypeScript query builder) | a fixed currency is `C` in `DecimalColumn<C>` / `MinorColumn<C>` |
| `MinorUnitsColumn` | — | not ported: by design (adapter for a TypeScript query builder) | `i64` / `MinorColumn<C>` |
| `MoneyComparison` | — | not ported: by design (adapter for a TypeScript query builder) | |
| `MoneyDialect` | — | not ported: by design (adapter for a TypeScript query builder) | the crate features `postgres`, `mysql`, `sqlite` |
| `MoneyHelpers` | — | not ported: by design (adapter for a TypeScript query builder) | |
| `MoneyHelpers#compareDecimalMoney` | — | not ported: by design (adapter for a TypeScript query builder) | bind `DecimalColumnSize::fit`'s `Decimal` in SQL |
| `MoneyHelpers#compareMoney` | — | not ported: by design (adapter for a TypeScript query builder) | bind `minor_units` in SQL |
| `MoneyHelpers#selectDecimalMoney` | — | not ported: by design (adapter for a TypeScript query builder) | `Decimal::to_money_at_exponent` |
| `MoneyHelpers#selectMoney` | — | not ported: by design (adapter for a TypeScript query builder) | `AnyMoney::from_minor` |
| `MoneyHelpers#sumDecimalMoney` | — | not ported: by design (adapter for a TypeScript query builder) | Postgres: the `sum` aggregate from `pg::money_type_sql` |
| `MoneyHelpers#sumMoney` | — | not ported: by design (adapter for a TypeScript query builder) | |
| `MoneyResultPlugin` | — | not ported: by design (adapter for a TypeScript query builder) | |
| `MoneyResultPlugin#transformQuery` | — | not ported: by design (adapter for a TypeScript query builder) | |
| `MoneyResultPlugin#transformResult` | — | not ported: by design (adapter for a TypeScript query builder) | |
| `fixed` | — | not ported: by design (adapter for a TypeScript query builder) | |
| `moneyHelpers` | — | not ported: by design (adapter for a TypeScript query builder) | |
| `setDecimalMoney` | — | not ported: by design (adapter for a TypeScript query builder) | `Decimal::from_money` or `DecimalColumnSize::fit`, plus `currency()` |
| `setMoney` | — | not ported: by design (adapter for a TypeScript query builder) | `minor_units` plus `currency()` |

### `./typeorm`

Not ported: TypeORM transformers are an adapter for a TypeScript ORM (design.md, "Mapping ducat's entries"). The column shapes they convert are `ducat-sqlx`'s and `ducat-diesel`'s types.

| TS | Rust | status | note |
|---|---|---|---|
| `MinorTransformerOptions` | — | not ported: by design (adapter for a TypeScript ORM) | |
| `MinorTransformerOptions#scale` | — | not ported: by design (adapter for a TypeScript ORM) | units at another scale: `Decimal::new(units, scale)` |
| `MoneyTransformer` | — | not ported: by design (adapter for a TypeScript ORM) | sqlx's `Encode`/`Decode` and diesel's `ToSql`/`FromSql` on the column types |
| `MoneyTransformer#from` | — | not ported: by design (adapter for a TypeScript ORM) | |
| `MoneyTransformer#to` | — | not ported: by design (adapter for a TypeScript ORM) | |
| `decimalTransformer` | — | not ported: by design (adapter for a TypeScript ORM) | `DecimalColumn<C>` |
| `fromRawDecimal` | — | not ported: by design (adapter for a TypeScript ORM) | `DecimalColumn::from_decimal` |
| `fromRawMinor` | — | not ported: by design (adapter for a TypeScript ORM) | `MinorColumn::from_minor_units` |
| `jsonTransformer` | — | not ported: by design (adapter for a TypeScript ORM) | the JSON column shape is a Known gap in both crates |
| `minorTransformer` | — | not ported: by design (adapter for a TypeScript ORM) | `MinorColumn<C>` |

### `./all`

Re-exports every plugin entry and `./fn`'s functions, and installs every plugin's methods on `Money`; its rows are in those entries. Rust has no prototype to install on: every method is there once its feature is on ([mapping](design.md#mapping-ducats-entries)).

## Missing, in proposed order
Every `missing` row, grouped into pull requests in the order users would hit them. Five pieces are decided (marked
**decided**); the rest are proposals.

1. **Checked clamp and rate validity** (`ducat`, one small PR): `.` `Money#clamp`, `./fn` `clamp`,
   `./exact` `ExactMoney#clamp`, `./convert` `Rate#checkValidity`. `clamp(&self, lo, hi) -> Result` on `Money`,
   `AnyMoney` and `ExactMoney` (an `Err` for `lo > hi` and across currencies, where `Ord::clamp` panics; `Money`
   bounds for `ExactMoney`), and a public `Rate::check_validity(&self, at) -> Result<(), Error>`. `multiply_at` is
   not needed: `multiply` with a scaled `RoundingPolicy` already rounds once into another scale.
2. **Money's parts and numbers** (`ducat`): `.` `Money#hasFraction`, `.` `Money#majorPart`, `.` `Money#minorPart`,
   `./fn` `hasFraction`, `./fn` `majorPart`, `./fn` `minorPart`. Receipts, cheques and display code ask for the whole
   and fractional parts first; small, exact, no design question.
3. **Floats out** (**decided**: [explicitly lossy, output-only](design.md#parity-decisions) `to_f64` and `to_minor_f64`, "for display or interop only; never round-trip", never called inside ducat) (`ducat`): `.` `Money#toNumber`, `.` `Money#toMinorNumber`, `.` `ToMinorNumberOptions`,
   `.` `ToMinorNumberOptions#lossy`, `./fn` `toNumber`, `./fn` `toMinorNumber`, `./fixed` `Fixed#toNumber`,
   `./exact` `ExactMoney#toNumber`. Charts and JavaScript interop need an `f64`.
4. **`ExactMoney` gaps** (`ducat`, feature `exact`): `./exact` `ExactMoney#isZero`, `./exact` `ExactMoney#isPositive`,
   `./exact` `ExactMoney#isNegative`, `./exact` `ExactMoney#toJSON`. The predicates are one-liners over `signum`;
   `serde` for exact amounts lets a total be stored before it is rounded.
5. **`ExactMoney` and `Fixed` gaps** (`ducat`, feature `exact`; from the re-audit): `./exact` `ExactMoney#abs`,
   `./exact` `ExactMoney#negate`, `./exact` `ExactMoney#sign`, `./exact` `ExactMoney#percentage`,
   `./exact` `ExactMoney#ratioOf`, `./exact` `ExactMoney#min`, `./exact` `ExactMoney#max` (on `AnyExactMoney`),
   `./exact` `ExactMoney#isExact`, `./exact` `ExactMoney#toMoney`, `./exact` `Money#multiplyExact`,
   `./exact` `multiplyExact`, `./fixed` `Fixed#trimScale` (`InvalidScale` past `MAX_SCALE`, where TS throws
   `RangeError`), `./fixed` `FixedOptions#rounding` (`Fixed::from_f64_at`).
6. **JSON column shapes** (**decided**: `ducat-sqlx` and `ducat-diesel`, in the exact TS JSON shape):
   `./drizzle/pg` `moneyJson`, `./drizzle/mysql` `moneyJson`, `./drizzle/sqlite` `moneyJson`. Storing money is the
   first thing an application does, and a JSON column is the layout that needs no currency column.
7. **A scale column for minor-unit columns** (`ducat-sqlx`, `ducat-diesel`): `./drizzle/pg` `scaledMoney`,
   `./drizzle/mysql` `scaledMoney`, `./drizzle/sqlite` `scaledMoney`, `./prisma` `ScaleColumnOption`,
   `./prisma` `ScaleColumnOption#scale`, `./drizzle/pg` `moneyMinor`, `./drizzle/mysql` `moneyMinor`,
   `./drizzle/sqlite` `moneyMinor` (the `{ scale }` option of `moneyMinor`, Kysely's `setMoney` and
   `selectMoney`, from ducat#380). A `MinorColumn<C>` with the scale stored beside the units, for money kept at more
   decimals than its currency's exponent.
8. **Processor tables and wire currency case** (`ducat`; from the re-audit): `./stripe` `STRIPE_RULES`,
   `./adyen` `ADYEN_EXPONENTS`, `./checkout` `CHECKOUT_RULES`, `./paypal` `PAYPAL_EXPONENTS`,
   `./braintree` `BRAINTREE_EXPONENTS`, `./klarna` `KLARNA_EXPONENTS` (a public `currencies()` iterator: the tables
   are private), `./checkout` `Money#toCheckout`, `./checkout` `toCheckout`, `./paypal` `Money#toPayPal`,
   `./paypal` `toPayPal` (uppercase the code, as ducat does).
9. **Format options a currency display uses** (`ducat-format`): `./format` `FormatOptions#signDisplay`,
   `./format` `FormatOptions#useGrouping`, `./format` `FormatOptions#minimumIntegerDigits`,
   `./format` `FormatOptions#minimumSignificantDigits`, `./format` `FormatOptions#roundingMode`,
   `./format` `FormatOptions#roundingPriority`, `./format` `FormatOptions#trailingZeroDisplay`. Invoices (`+`/`−`
   signs, no grouping) and price displays (`€5` for whole amounts) use these; all are TR35 number formatting over data
   the crate already has.
10. **Rate snapshots** (**decided**: synchronous in `ducat` through a loader closure or trait; asynchronous in
   `ducat-fetch` on `Transport`): `./convert` `snapshots`, `./convert` `snapshotsFrom`, `./convert` `Snapshots`,
   `./convert` `Snapshots#at`, `./convert` `SnapshotOptions`, `./convert` `SnapshotOptions#lookback`,
   `./convert` `SnapshotOptions#max`. Converting at historical dates without loading every table up front.
11. **CLDR currency names as `ducat-words` defaults** (**decided**: feature `cldr-names`, reusing `ducat-format`'s
   generated names without all its data): no `missing` row; `./words` `amountInWords` is `divergent` until then,
   because the caller must pass `UnitNames`.
12. **Adyen's IANA time zone** (**decided**: an optional `tz` feature on `ducat`, with jiff and a bundled tzdb, off by
   default, not `no_std`): `./adyen-fx` `AdyenRateOptions`, `./adyen-fx` `AdyenRateOptions#timeZone`. Only reports
   whose TimeZone column switches with daylight saving need it; abbreviations and offsets already work.
13. **Compact notation and numbering systems** (`ducat-format`, new CLDR data): `./format` `FormatOptions#notation`,
   `./format` `FormatOptions#compactDisplay`, `./format` `FormatOptions#numberingSystem`,
   `./format` `FormatOptions#localeMatcher`. Dashboards (`€1.2M`) and native digits; compact patterns and numbering systems add
   data to every locale, so they want their own features. `localeMatcher` chooses between `Intl`'s algorithms; the
   port has one (TR35 fallback), so it may end up `not ported: by design`.

### Follow-ups, not parity

- Fuzzing every boundary (milestone 8).
- `sqlite-unbundled` for `ducat-sqlx` and `ducat-diesel` (a system SQLite instead of building it).
- diesel 2.3 and later in the lockfile (needs Rust 1.86 and 1.88; the requirement already admits them).
