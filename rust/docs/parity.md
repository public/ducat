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
| `CurrencyMismatchError` | `ducat::Error::CurrencyMismatch` | same | typed `Money<C>` makes the mismatch a compile error; `AnyMoney` operations return `Err(CurrencyMismatch)` where ducat throws, with `expected` the receiver's currency and `actual` the operand's, as ducat |
| `CurrencyMismatchError#actual` | `Error::CurrencyMismatch { actual }` | same | |
| `CurrencyMismatchError#expected` | `Error::CurrencyMismatch { expected }` | same | |
| `CurrencyMismatchError#name` | `ducat::Error::kind` | same | |
| `CustomCurrencies` | `ducat::define_currency!` | not ported: by design (no registry: currencies carry their exponent, `CurrencyCode::custom`) | a TS declaration-merging registry |
| `DEFAULT_ROUNDING` | — | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | every rounding operation takes a `Rounding` |
| `ExtendMoneyOptions` | — | not ported: by design (Rust uses extension traits; there's no prototype to install on) | |
| `ExtendMoneyOptions#owner` | — | not ported: by design (as `extendMoney`) | |
| `Factor` | [`ducat::Factor`](../crates/ducat/src/ratio.rs) | same | integers, decimal strings and `"a/b"` (`&str`), `Ratio`, `Fixed`; a float through `Ratio::try_from(f64)`, under ducat's binary64 rule. Failures as ducat's `ratio()`: `Syntax` (`SyntaxError`), `DivisionByZero`, `NotFinite`, `TooManyDigits`, `ExponentOutOfRange` (`RangeError`); but see `ratio` for `"1/2/3"` |
| `ISO_4217_PUBLISHED` | `ducat::ISO_4217_PUBLISHED` | same | |
| `ISO_EXPONENTS` | `ducat::CurrencyCode::iso_codes`, `CurrencyCode::exponent` | same | an iterator, not a record |
| `ISO_NON_MONETARY` | `ducat::CurrencyCode::iso_non_monetary` | same | |
| `IsoCurrencyCode` | `ducat::iso` markers (`ducat::iso::Eur`) | same | |
| `Money` | `ducat::Money<C>`, `ducat::AnyMoney` | same | |
| `Money#abs` | `Money::abs`, `AnyMoney::abs` | same | |
| `Money#add` | `Add` for `Money<C>`; `AnyMoney::checked_add` | same | `AnyMoney::checked_add` returns `Err(CurrencyMismatch)` where ducat throws `CurrencyMismatchError`; a `Money<C>` and an `AnyMoney` mix after `.to_any()` or `try_into()` |
| `Money#clamp` | `Money::clamp`, `AnyMoney::clamp` | same | `Err(LowAboveHigh)` (ducat's message, `clamp(): lo > hi`, a range kind) where ducat throws `RangeError`; on `AnyMoney`, ducat's order: `Err(CurrencyMismatch)` for bounds in two currencies (`expected` `lo`'s), then `lo > hi`, then `Err(CurrencyMismatch)` for a value in another currency (`expected` the value's). A value equal to a bound is returned as it is. Unlike `Ord::clamp`, which panics for `lo > hi`: `Money::clamp` takes `self` by value so that `a.clamp(lo, hi)` resolves to it rather than to `Ord::clamp`; on a `&Money` receiver it is still `Ord::clamp` (documented) |
| `Money#compare` | `Ord::cmp` for `Money<C>`; `AnyMoney::compare` | same | `AnyMoney::compare` returns `Result<Ordering, _>`: `Err(CurrencyMismatch)` where ducat throws |
| `Money#currency` | `Money::currency`, `AnyMoney::currency` | same | |
| `Money#divide` | `Money::divide`, `AnyMoney::divide` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the `Rounding` is required |
| `Money#equals` | `==` (`PartialEq` by value), `eq_value` | same | another currency is `false`, never an error, as ducat's (`AnyMoney`'s `==` and `eq_value`) |
| `Money#greaterThan` | `>` (`PartialOrd`) for `Money<C>`; `AnyMoney::compare` | same | `AnyMoney::compare(..)?.is_gt()`: `Err(CurrencyMismatch)` where ducat throws |
| `Money#greaterThanOrEqual` | `>=` for `Money<C>`; `AnyMoney::compare` | same | `AnyMoney::compare(..)?.is_ge()`: `Err(CurrencyMismatch)` where ducat throws |
| `Money#hasFraction` | `Money::has_fraction`, `AnyMoney::has_fraction` | same | whether the amount has a non-zero part below the major unit, at any scale: `false` for 12.000 EUR at scale 3 |
| `Money#identical` | `Money::identical`, `AnyMoney::identical` | same | another currency is `false`, as ducat's |
| `Money#isNegative` | `Money::is_negative`, `AnyMoney::is_negative` | same | |
| `Money#isPositive` | `Money::is_positive`, `AnyMoney::is_positive` | same | |
| `Money#isZero` | `Money::is_zero`, `AnyMoney::is_zero` | same | |
| `Money#lessThan` | `<` for `Money<C>`; `AnyMoney::compare` | same | `AnyMoney::compare(..)?.is_lt()`: `Err(CurrencyMismatch)` where ducat throws |
| `Money#lessThanOrEqual` | `<=` for `Money<C>`; `AnyMoney::compare` | same | `AnyMoney::compare(..)?.is_le()`: `Err(CurrencyMismatch)` where ducat throws |
| `Money#majorPart` | `Money::major_part`, `AnyMoney::major_part` | same | the whole units, truncated toward zero (−12 for −12.34 EUR, 0 for −0.05 EUR); an `Int`, ducat's `number` or `bigint` |
| `Money#max` | `Money::max`, `Money::max_of`; `AnyMoney::max`, `AnyMoney::max_of` | same | the first of equal values wins, as ducat (1.0 EUR at scale 1 against 1.00 EUR keeps scale 1), where `Ord::max` keeps the *second*: the inherent `Money::max` takes `self` by value so that `a.max(b)` resolves to it; `core::cmp::max`, `Iterator::max` and `Ord`-generic code keep `Ord`'s rule (documented). `max_of` is the variadic form over an iterator (`None` for none). `AnyMoney`'s return `Err(CurrencyMismatch)` where ducat throws, with ducat's `expected` (the candidate's currency) and `actual` (the largest so far's) |
| `Money#min` | `Money::min`, `Money::min_of`; `AnyMoney::min`, `AnyMoney::min_of` | same | the first of equal values wins, as ducat (and `Ord::min`); `min_of` is the variadic form over an iterator (`None` for none). `AnyMoney`'s return `Err(CurrencyMismatch)` where ducat throws, with ducat's `expected` (the candidate's currency) and `actual` (the smallest so far's) |
| `Money#minor` | `Money::units`, `AnyMoney::units` | same | the integer at the value's scale |
| `Money#minorPart` | `Money::minor_part`, `AnyMoney::minor_part` | same | what is left after `major_part`, in 10^−scale units (not the currency's minor units: 5 for 1.005 EUR at scale 3) and with the amount's sign (−34 for −12.34 EUR); an `Int` |
| `Money#multiply` | `Money::multiply`, `AnyMoney::multiply` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#negate` | `Neg` for `Money<C>` and `AnyMoney` | same | |
| `Money#round` | `Money::round`, `AnyMoney::round` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#scale` | `Money::scale`, `AnyMoney::scale` | same | |
| `Money#sign` | `Money::signum`, `AnyMoney::signum` | same | |
| `Money#subtract` | `Sub` for `Money<C>`; `AnyMoney::checked_sub` | same | `AnyMoney::checked_sub` returns `Err(CurrencyMismatch)` where ducat throws |
| `Money#toDecimal` | `Money::to_decimal`, `AnyMoney::to_decimal` | same | |
| `Money#toJSON` | `serde::Serialize` (feature `serde`) | divergent: [serde writes the value's scale, reads at the exponent](design.md#decisions-made-while-building-milestone-1) | |
| `Money#toMinor` | `Money::to_minor`, `AnyMoney::to_minor` | same | `Int`, not a `bigint`; `Err(Rounding)` for digits below the minor unit, where ducat throws `RoundingError` |
| `Money#toMinorNumber` | `Money::to_minor_f64`, `AnyMoney::to_minor_f64` | same | [floats only go out](design.md#parity-decisions): for display or interop only, never round-trip, never called inside ducat (`rust/clippy.toml`). `Err(Rounding)` for digits below the minor unit (`RoundingError`), then `Err(Overflow)` past 2^53 − 1 minor units without `lossy` (`RangeError`); bit for bit as ducat |
| `Money#toNumber` | `Money::to_f64`, `AnyMoney::to_f64` | same | [floats only go out](design.md#parity-decisions): for display or interop only, never round-trip, never called inside ducat (`rust/clippy.toml`). The exact decimal rounded once to the nearest double, bit for bit as ducat's `Number` of it: ±infinity beyond the largest double, −0.0 for a negative amount below the smallest subnormal |
| `Money#toScale` | `Money::to_scale`, `AnyMoney::to_scale` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the `Rounding` is required (ducat defaults to halfExpand); a scale past `MAX_SCALE` is `Err(InvalidScale)` where ducat throws `RangeError`, and the `u16` rules out negative and fractional scales |
| `Money#toScaledUnits` | `Money::units`, `AnyMoney::units` | same | an `&Int`, ducat's `bigint` |
| `Money#toString` | `Display` (`12.34 EUR`) | same | exact, as ducat's `formatScaled(minor, scale) + ' ' + currency`: the amount at its own scale, a space and the code. Format flags (`{:.1}`) are ignored rather than rounding, so there is nothing Rust-only |
| `Money#with` | — | not ported: by design (idiomatic Rust, not transliterated TypeScript: a closure or a plain call does it) | a pipeline helper |
| `MoneyJSON` | the `serde` shape `{"amount":"12.34","currency":"EUR"}` | same | no named Rust type |
| `MoneyOperand` | — | not ported: by design (TS typing device; `Money<C>` operators take values and references) | |
| `MoneyOptions` | arguments of `Money::parse_at` / `AnyMoney::parse_at` | same | the arguments of `parse_at` (strings) and `from_f64_at` (floats); `FromStr` and `from_f64` are the no-options call |
| `MoneyOptions#rounding` | the `Rounding` argument of `parse_at` | same | the `Rounding` argument of `parse_at`, `from_f64_at`; `Rounding::Unnecessary` is ducat's default (`Err(Rounding)` where it throws `RoundingError`) |
| `MoneyOptions#scale` | the `scale` argument of `parse_at`, `from_units` | same | the `scale` argument of `parse_at`, `from_f64_at`, `from_units`: `Err(InvalidScale)` past `MAX_SCALE`, where ducat throws `RangeError` |
| `Ratio` | [`ducat::Ratio`](../crates/ducat/src/ratio.rs) | same | |
| `Rounding` | [`ducat::Rounding`](../crates/ducat/src/rounding.rs) | divergent: [rounding modes have one name each](design.md#parity-decisions) | the enum has ECMA-402's names only (`HalfExpand`, `HalfEven`, `Trunc`...); ducat's `Rounding` object adds `HalfUp`, `HalfDown`, `Bankers`, `Up` and `Down` aliases; plus `Unnecessary` |
| `RoundingError` | `ducat::Error::Rounding` | same | |
| `RoundingError#name` | `ducat::Error::kind` | same | |
| `RoundingInput` | `ducat::RoundingInput` | same | `Mode` or `Policy` |
| `RoundingMode` | `ducat::Rounding` | same | an enum, so no invalid mode (ducat throws `RangeError` for one, when rounding is needed); `FromStr` reads ducat's strings (`"halfEven"`) |
| `RoundingPolicy` | [`ducat::policy::RoundingPolicy`](../crates/ducat/src/policy.rs) | same | |
| `ToMinorNumberOptions` | `ToMinorF64Options` | same | the options argument of `to_minor_f64`; `Default` is ducat's `{}` |
| `ToMinorNumberOptions#lossy` | `ToMinorF64Options::lossy` | same | `false` by default, as ducat: the nearest double (ties to even, ±infinity) instead of `Err(Overflow)` past 2^53 − 1; `Err(Rounding)` still comes first |
| `assertCurrency` | `TryFrom<AnyMoney> for Money<C>` | same | `Err(CurrencyMismatch)` where ducat throws `CurrencyMismatchError`; ducat's `TypeError` for a non-`Money` has no Rust counterpart |
| `currencyExponent` | `ducat::CurrencyCode::exponent` | divergent: [no registry](design.md#decisions-made-while-building-milestone-1) | on a `CurrencyCode` value; a string goes through `parse::<CurrencyCode>()?` first (`Err(UnknownCurrency)` where ducat throws `RangeError`). A custom currency carries its exponent: there is no `defineCurrency`'d code to look up by string |
| `defineCurrency` | `ducat::CurrencyCode::custom`, `ducat::define_currency!` | divergent: [no registry](design.md#decisions-made-while-building-milestone-1) | |
| `extendMoney` | — | not ported: by design (Rust uses extension traits; there's no prototype to install on) | |
| `fromJSON` | `serde::Deserialize` | divergent: [reads at the currency's exponent](design.md#decisions-made-while-building-milestone-1) | |
| `fromMinor` | `Money::from_minor`, `AnyMoney::from_minor`; `from_units` with a scale | same | `from_minor` at the exponent, `from_units(units, scale)` at another scale (`Err(InvalidScale)` past `MAX_SCALE`, ducat's `RangeError`); `Int` takes any integer, so ducat's `RangeError` for an unsafe or fractional number has no counterpart |
| `isCurrency` | `str::parse::<CurrencyCode>().is_ok()` | divergent: [no registry](design.md#decisions-made-while-building-milestone-1) | true for ISO 4217 codes with a minor unit, as ducat; a code `defineCurrency` registered is true in ducat, but Rust has no registry (`CurrencyCode::custom` makes one without registering it) |
| `isMoney` | — | not ported: by design (the type system: a value is a `Money<C>` or not) | |
| `isMoneyIn` | `TryFrom<AnyMoney> for Money<C>` | not ported: by design (the type system) | |
| `money` | `Money::parse_at`, `FromStr`, `from_f64`, `from_f64_at` (and `AnyMoney`'s) | same | strings at the exponent (`FromStr`) or a scale (`parse_at`), floats (`from_f64`, `from_f64_at`); a `bigint` of major units is `from_units(n, 0)?.to_scale(e, Rounding::Unnecessary)`. The same failures in ducat's order: `Syntax` (`SyntaxError`), `ExponentOutOfRange`, `InvalidScale`, `NotFinite` (`RangeError`), then `Rounding` before `TooManyDigits` for a float (`from_f64_at` checks the scale before the value, so NaN at a scale past `MAX_SCALE` is `InvalidScale`, and has no `TooManyDigits`, as ducat once a rounding is given); an unknown code fails when the `CurrencyCode` is parsed (`UnknownCurrency`) |
| `ratio` | `ducat::Ratio::new`, `Ratio`'s `FromStr`, `Ratio::div` | divergent: [a ratio string has one slash](design.md#parity-decisions) | `Ratio::new` takes two integers; two decimals are `"1.5/2"` or `Ratio::div`. `DivisionByZero` where ducat throws `RangeError`. ducat reads `"1/2/3"` as 1/(2/3) = 3/2 (it splits at the first slash and recurses), where Rust's `FromStr` refuses it with `Syntax` |
| `sum` | `Sum` for `Money<C>`; `AnyMoney::try_sum` | divergent: [sums start at the currency's exponent](design.md#parity-decisions) | `Sum` for `Money<C>` and `AnyMoney::try_sum(items, currency)` (`Err(CurrencyMismatch)` where ducat throws); the currency is always known, so ducat's `RangeError` for an empty list without one can't happen. The result's scale is the largest of the items' *and the exponent*: one EUR item at scale 0 sums to scale 2 in Rust, scale 0 in ducat |
| `zero` | `Money::zero`, `AnyMoney::zero` | same | at the exponent; ducat's `scale` argument is `from_units(0, scale)` (`Err(InvalidScale)` past `MAX_SCALE`) |

### `./fn`

No split in Rust: unused methods cost nothing ([mapping](design.md#mapping-ducats-entries)). `./fn` re-exports the core's factories, types and errors and every plugin's free functions; their rows are in those entries. Its own rows are the free-function forms of the core methods and its method-less `Money`.

| TS | Rust | status | note |
|---|---|---|---|
| `Money` | `ducat::Money<C>`, `ducat::AnyMoney` | same | |
| `Money#currency` | `Money::currency`, `AnyMoney::currency` | same | a `CurrencyCode` (code and exponent), not a string |
| `Money#minor` | `Money::units`, `AnyMoney::units` | same | the integer at the value's scale |
| `Money#scale` | `Money::scale`, `AnyMoney::scale` | same |  |
| `Money#toJSON` | `serde::Serialize` | divergent: [serde writes the value's scale](design.md#decisions-made-while-building-milestone-1) | |
| `Money#toString` | `Display` | same | as `.` `Money#toString` |
| `abs` | `Money::abs`, `AnyMoney::abs` | same | methods, not free functions |
| `add` | `Add`; `AnyMoney::checked_add` | same | as `.` `Money#add` |
| `clamp` | `Money::clamp`, `AnyMoney::clamp` | same | as `.` `Money#clamp` |
| `compare` | `Ord::cmp`; `AnyMoney::compare` | same | as `.` `Money#compare` |
| `divide` | `Money::divide` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `equals` | `==`; `AnyMoney::eq_value` | same | as `.` `Money#equals` |
| `greaterThan` | `>`; `AnyMoney::compare` | same | as `.` `Money#greaterThan` |
| `greaterThanOrEqual` | `>=`; `AnyMoney::compare` | same | as `.` `Money#greaterThanOrEqual` |
| `hasFraction` | `Money::has_fraction`, `AnyMoney::has_fraction` | same | as `.` `Money#hasFraction` |
| `identical` | `Money::identical`, `AnyMoney::identical` | same | as `.` `Money#identical` |
| `isNegative` | `Money::is_negative`, `AnyMoney::is_negative` | same |  |
| `isPositive` | `Money::is_positive`, `AnyMoney::is_positive` | same |  |
| `isZero` | `Money::is_zero`, `AnyMoney::is_zero` | same |  |
| `lessThan` | `<`; `AnyMoney::compare` | same | as `.` `Money#lessThan` |
| `lessThanOrEqual` | `<=`; `AnyMoney::compare` | same | as `.` `Money#lessThanOrEqual` |
| `majorPart` | `Money::major_part`, `AnyMoney::major_part` | same | as `.` `Money#majorPart` |
| `max` | `Money::max`, `Money::max_of`; `AnyMoney::max`, `AnyMoney::max_of` | same | as `.` `Money#max`: the first of equal values wins (not `Ord::max`'s second) |
| `min` | `Money::min`, `Money::min_of`; `AnyMoney::min`, `AnyMoney::min_of` | same | as `.` `Money#min` |
| `minorPart` | `Money::minor_part`, `AnyMoney::minor_part` | same | as `.` `Money#minorPart` |
| `multiply` | `Money::multiply` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `negate` | `Neg` for `Money<C>` and `AnyMoney` | same |  |
| `round` | `Money::round` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `sign` | `Money::signum`, `AnyMoney::signum` | same | an `i8` |
| `subtract` | `Sub`; `AnyMoney::checked_sub` | same | as `.` `Money#subtract` |
| `toDecimal` | `Money::to_decimal`, `AnyMoney::to_decimal` | same |  |
| `toMinor` | `Money::to_minor`, `AnyMoney::to_minor` | same | as `.` `Money#toMinor` |
| `toMinorNumber` | `Money::to_minor_f64`, `AnyMoney::to_minor_f64` | same | as `.` `Money#toMinorNumber` |
| `toNumber` | `Money::to_f64`, `AnyMoney::to_f64` | same | as `.` `Money#toNumber` |
| `toScale` | `Money::to_scale`, `AnyMoney::to_scale` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | as `.` `Money#toScale`: the `Rounding` is required |
| `toScaledUnits` | `Money::units`, `AnyMoney::units` | same | an `&Int` |

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
| `AllocateOptions` | the `Remainder` argument | same | the `Remainder` argument of `allocate` and `split` (required: ducat defaults to `Largest` for `allocate`, `First` for `split`) |
| `AllocateOptions#remainder` | `ducat::allocate::Remainder` argument of `allocate`/`split` | same | an enum, so no invalid strategy (ducat throws `RangeError` for one); `FromStr` reads ducat's names |
| `InstalmentOptions` | the arguments of `Money::instalments` | same | the `unit` and `remainder` arguments |
| `InstalmentOptions#remainder` | `ducat::allocate::InstalmentRemainder` argument | same | required (ducat defaults to `toFirst`); `Largest` is left out of the enum, as ducat's type leaves it out |
| `InstalmentOptions#unit` | the `unit` argument of `Money::instalments` | same | an `Option<&Money<C>>`: `Err(NotPositive)` for a unit that isn't positive, `Err(CurrencyMismatch)` on `AnyMoney` (ducat's `RangeError`, `CurrencyMismatchError`). `AnyMoney` checks the unit's currency before the count, ducat after |
| `Money#allocate` | `Money::allocate`, `AnyMoney::allocate` | same | `Err(NoWeights)`, `Err(ZeroWeights)`, `Err(NegativeWeight)` where ducat throws `RangeError`, and a weight's own reading errors (see `Weight`) |
| `Money#chunk` | `Money::chunk`, `AnyMoney::chunk` | same | `Err(NotPositive)` for a `max` that isn't positive, then `Err(NegativeTotal)` (ducat's two `RangeError`s, in its order); `Err(CurrencyMismatch)` on `AnyMoney`; `Err(Overflow)` for more tranches than can be held |
| `Money#instalments` | `Money::instalments`, `AnyMoney::instalments` | same | a count of 0 is `Err(NoWeights)` (ducat's `RangeError`; the `usize` rules out negative and fractional counts); see `InstalmentOptions#unit` |
| `Money#schedule` | `Money::schedule`, `AnyMoney::schedule` | same | `Err(InvalidSchedule)` for each of ducat's `RangeError`s (two rest tranches, percentages over 100, tranches over the total, a leftover without a rest); `Err(CurrencyMismatch)` on `AnyMoney` for an amount or cap in another currency |
| `Money#split` | `Money::split`, `AnyMoney::split` | same | a count of 0 is `Err(NoWeights)` (ducat's `RangeError`); `Err(Overflow)` for more parts than can be held |
| `Remainder` | `ducat::allocate::Remainder` | same | `Largest`, `First`, `Last`, `ToFirst`, `ToLast` |
| `Tranche` | `ducat::allocate::Tranche` | same | `Tranche::amount`, `percent`, `percent_capped`, `rest`; the percentage is read when the tranche is built |
| `Weight` | `ducat::allocate::Weight`, `IntoWeight` | divergent: [no float weights](design.md#parity-decisions) | integers, `Int` and decimal strings (`Err(NegativeWeight)` for a negative one, as ducat's `RangeError`); ducat also takes a float (`allocate(m, [0.7, 0.3])`, read at its shortest form under the 15-digit rule), which has no `IntoWeight` impl: pass `"0.7"` |
| `allocate` | `Money::allocate`, `AnyMoney::allocate` | same | as `Money#allocate` |
| `chunk` | `Money::chunk`, `AnyMoney::chunk` | same | as `Money#chunk` |
| `instalments` | `Money::instalments`, `AnyMoney::instalments` | same | as `Money#instalments` |
| `schedule` | `Money::schedule`, `AnyMoney::schedule` | same | as `Money#schedule` |
| `split` | `Money::split`, `AnyMoney::split` | same | as `Money#split` |

### `./tax`

[`ducat::tax`](../crates/ducat/src/tax.rs) (feature `tax`).

| TS | Rust | status | note |
|---|---|---|---|
| `Money#addTax` | `Money::add_tax`, `AnyMoney::add_tax` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#discount` | `Money::discount`, `AnyMoney::discount` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#extractTax` | `Money::extract_tax`, `AnyMoney::extract_tax` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `Money#percentage` | `Money::percentage`, `AnyMoney::percentage` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `TaxBreakdown` | `ducat::tax::TaxBreakdown<M>` | same | `net`, `tax`, `gross`, public fields; `M` is `Money<C>` or `AnyMoney` |
| `addTax` | `Money::add_tax` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `discount` | `Money::discount` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `extractTax` | `Money::extract_tax` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `percentage` | `Money::percentage` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |

### `./math`

[`ducat::math`](../crates/ducat/src/math.rs) (feature `math`); the ratio arithmetic is `Ratio`'s own.

| TS | Rust | status | note |
|---|---|---|---|
| `Money#divideToIntegral` | `Money::divide_to_integral`, `AnyMoney::divide_to_integral` | same | an `Int`, truncated toward zero; `Err(DivisionByZero)` for a zero divisor, `Err(CurrencyMismatch)` on `AnyMoney` (ducat's `RangeError`, `CurrencyMismatchError`, currency checked first) |
| `Money#ratioOf` | `Money::ratio_of`, `AnyMoney::ratio_of` | same | a reduced `Ratio`; `Err(DivisionByZero)`, `Err(CurrencyMismatch)` on `AnyMoney`, as `Money#divideToIntegral` |
| `Money#remainder` | `Money::remainder`, `AnyMoney::remainder` | same | at the larger scale with the dividend's sign; errors as `Money#divideToIntegral` |
| `Money#trimScale` | `Money::trim_scale`, `AnyMoney::trim_scale` | same | the minimum is an `Option<u16>` (`None` is the exponent, ducat's default): `Err(InvalidScale)` past `MAX_SCALE`, where ducat throws `RangeError`; the `u16` rules out negative and fractional minimums |
| `average` | `Money::average`, `AnyMoney::average` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `divideToIntegral` | `Money::divide_to_integral`, `AnyMoney::divide_to_integral` | same | as `Money#divideToIntegral` |
| `ratioAdd` | `Ratio::add` | same | a method on `&Ratio`; there are no `Ratio` operators (`+`). ducat's functions take any `Factor`: parse a string to a `Ratio` first |
| `ratioCompare` | `Ord` for `Ratio` | same | `Ordering`, ducat's −1, 0, 1 |
| `ratioComplement` | `Ratio::complement` | same | `1 − self` |
| `ratioDivide` | `Ratio::div` | same | a method returning `Err(DivisionByZero)` for a zero divisor, where ducat throws `RangeError`; there is no `/` operator |
| `ratioMultiply` | `Ratio::mul` | same | a method; there is no `*` operator |
| `ratioNegate` | `Ratio::neg` | same | a method; there is no unary `-` |
| `ratioOf` | `Money::ratio_of`, `AnyMoney::ratio_of` | same | as `Money#ratioOf` |
| `ratioSubtract` | `Ratio::sub` | same | a method; there is no `-` operator |
| `remainder` | `Money::remainder`, `AnyMoney::remainder` | same | as `Money#remainder` |
| `trimScale` | `Money::trim_scale`, `AnyMoney::trim_scale` | same | as `Money#trimScale` |

### `./convert`

[`ducat::convert`](../crates/ducat/src/convert/mod.rs) (feature `convert`): rates with metadata, providers and `MoneyBag`.

| TS | Rust | status | note |
|---|---|---|---|
| `ComparatorOptions` | arguments of `ducat::convert::comparator` | same | the `base` and `query` arguments of `comparator` and `sort_by_value` |
| `ComparatorOptions#asOf` | the `RateQuery` argument of `comparator` | divergent: [times are read strictly](design.md#milestone-5d1-rates-providers-and-bags) | a `Time` in the `RateQuery`, parsed strictly (`YYYY-MM-DD` or an instant with `Z`/`±HH:MM`, `Err(InvalidTime)`); ducat takes a `Date` or any string `new Date` reads, `RangeError` for one it can't |
| `ComparatorOptions#base` | the base `CurrencyCode` argument of `comparator` | same | a `CurrencyCode` |
| `ConvertOptions` | `ducat::convert::ConvertOptions` | same | `Default` is ducat's no-options call |
| `ConvertOptions#scale` | `ConvertOptions::scale` | same | an `Option<u16>`: `Err(InvalidScale)` past `MAX_SCALE` (ducat's `RangeError`), `Err(ScaleWithPolicy)` with a rounding policy (ducat's `TypeError`) |
| `ConvertOptions#strictValidity` | `ConvertOptions::valid_at` | divergent: [no clock: times are arguments](design.md#milestone-5d1-rates-providers-and-bags) | the time to check against is given, not read from a clock |
| `DetailedConversion` | the result of `Rate::convert_detailed` | same | `Rounded<Money<T>, ExactMoney<T>>`: `value` and `residual`; ducat's `rate` field is the receiver |
| `Money#convert` | `Money::convert`, `AnyMoney::convert`, `Rate::convert`, `convert_through` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the rounding is required (ducat defaults to halfExpand). At a `Rate`, at a factor (`Err(NonPositiveRate)` for one that isn't positive, ducat's `RangeError`) or through a provider (`Err(RateUnavailable)`) |
| `MoneyBag` | [`ducat::convert::MoneyBag`](../crates/ducat/src/convert/bag.rs) | same | of `AnyMoney`, in first-seen order |
| `MoneyBag#add` | `MoneyBag::with` | same | returns a `Result` that can't fail (one currency's amounts always add) |
| `MoneyBag#currencies` | `MoneyBag::currencies` | same | an iterator |
| `MoneyBag#exactTotal` | `MoneyBag::exact_total` | same | `Err(RateUnavailable)` or `Err(CurrencyMismatch)` from `rate_of`, as ducat's `rateOf` throws |
| `MoneyBag#get` | `MoneyBag::get` | same | `None` when the bag has none, as ducat's `undefined` |
| `MoneyBag#toJSON` | `serde::Serialize` for `MoneyBag` | same | a list of money JSON values, as ducat |
| `MoneyBag#total` | `MoneyBag::total` | same | rounded once; the rounding is required in ducat too; errors as `MoneyBag#exactTotal`, then `Err(Rounding)` |
| `MoneyBag#values` | `MoneyBag::values` | same | a slice, in first-seen order |
| `ProviderConvertOptions` | `ducat::convert::ProviderConvertOptions` | same | `Default` is ducat's no-options call |
| `ProviderConvertOptions#asOf` | `ProviderConvertOptions::as_of` | divergent: [times are read strictly](design.md#milestone-5d1-rates-providers-and-bags) | a `Time`, as `ComparatorOptions#asOf` |
| `ProviderConvertOptions#scale` | `ProviderConvertOptions::scale` | same | as `ConvertOptions#scale` |
| `ProviderConvertOptions#strictValidity` | `ProviderConvertOptions::valid_at` | divergent: [no clock: times are arguments](design.md#milestone-5d1-rates-providers-and-bags) |  |
| `Rate` | `ducat::convert::Rate<F, T>`, `AnyRate` | same | `Rate<F, T>` with the pair in the type, `AnyRate` at run time |
| `Rate#andThen` | `Rate::and_then`, `AnyRate::and_then` | same | typed: a pair that doesn't chain doesn't compile; `AnyRate::and_then` returns `Err(CurrencyMismatch)` (expected this rate's `to`, actual `next`'s `from`), as ducat throws |
| `Rate#asOf` | `RateInfo::as_of` (`Rate::info`) | same | an `Option<Time>` |
| `Rate#availableAt` | `RateInfo::available_at` | same | an `Option<Time>` |
| `Rate#checkValidity` | `Rate::check_validity`, `AnyRate::check_validity` | same | `check_validity(&self, at: &Time) -> Result<(), Error>`: ducat's check with `strictValidity: true` and the clock reading `at` passed in (the library reads no clock); without strict validity ducat checks nothing, which is not calling it. `Err(RateExpired)` when there is a `valid_until` and it has passed at `at` (a date is valid all day, UTC), as ducat's `RateExpiredError`. The conversions with `ConvertOptions::valid_at` call it |
| `Rate#convert` | `Rate::convert`, `convert_with`, `AnyRate::convert` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the rounding is required (ducat defaults to halfExpand). The same failures: `Err(CurrencyMismatch)` on `AnyRate`, `Err(RateExpired)` with `valid_at`, `Err(ScaleWithPolicy)` (ducat's `TypeError`), `Err(Rounding)` |
| `Rate#derivedFrom` | `Rate::derived_from` | same | a slice of `AnyRate` |
| `Rate#from` | `Rate::from` | same | a `CurrencyCode` |
| `Rate#inverse` | `Rate::inverse` | same | infallible: a quote describes its rate exactly |
| `Rate#isAvailable` | `Rate::is_available` | divergent: [no clock: times are arguments](design.md#milestone-5d1-rates-providers-and-bags) | takes the time |
| `Rate#isExpired` | `Rate::is_expired` | divergent: [no clock: times are arguments](design.md#milestone-5d1-rates-providers-and-bags) | takes `now` |
| `Rate#quote` | `RateInfo::quote` | same |  |
| `Rate#ratio` | `Rate::ratio` | same |  |
| `Rate#round` | `Rate::round`, `AnyRate::round` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the rounding is required (ducat defaults to halfEven); `places` is a `u16` up to `MAX_SCALE` (`Err(InvalidScale)`), where ducat takes any non-negative integer; `Err(NonPositiveRate)` when it rounds to zero, as ducat's `RangeError` |
| `Rate#source` | `RateInfo::source` | same |  |
| `Rate#to` | `Rate::to` | same | a `CurrencyCode` |
| `Rate#toDecimal` | `Rate::to_decimal`, `AnyRate::to_decimal` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the rounding is required (ducat defaults to halfEven); `places` up to `MAX_SCALE` as `Rate#round` |
| `Rate#toJSON` | `serde::Serialize` for `Rate`/`AnyRate` (`RateJSON` shape) | same | ducat's `RateJSON` shape and field order |
| `Rate#toString` | `Display` for `Rate` | same | the published digits for a one-for-one quote, else the exact decimal or `num/den`, as ducat |
| `Rate#type` | `RateInfo::rate_type` | same |  |
| `Rate#validUntil` | `RateInfo::valid_until` | same |  |
| `Rate#withMargin` | `Rate::with_margin`, `AnyRate::with_margin` | same | `Err(NonPositiveRate)` for a margin of −100% or less, where ducat throws `RangeError` |
| `RateExpiredError` | `ducat::Error::RateExpired` | same | with `from` and `to` too |
| `RateExpiredError#validUntil` | `Error::RateExpired { valid_until }` | same | a `Time` |
| `RateInfo` | `ducat::convert::RateInfo` | divergent: [times are read strictly](design.md#milestone-5d1-rates-providers-and-bags) | `as_of`, `available_at` and `valid_until` are `Time`s, parsed strictly (`Err(InvalidTime)`); ducat takes a `Date` or any string `new Date` reads (local times, `T24:00`), `RangeError` for one it can't. The quote is checked by `with_info`: `Err(InvalidQuote)`, `Err(QuoteMismatch)` for ducat's `RangeError`s |
| `RateJSON` | the `serde` shape of `Rate` | same | no named Rust type |
| `RateProvider` | `ducat::convert::RateProvider`, `BoxedProvider` | same | a trait over `CurrencyCode`s, so providers can be trait objects |
| `RateProvider#rate` | `RateProvider::rate` | same | returns `Option<AnyRate>` |
| `RateQuery` | `ducat::convert::RateQuery` | divergent: [times are read strictly](design.md#milestone-5d1-rates-providers-and-bags) | `as_of: Option<Time>`, as `ComparatorOptions#asOf` |
| `RateQuote` | `ducat::convert::RateQuote` | same | `per` an `Option<i64>`: below 1 is `Err(InvalidQuote)` (from `with_info`), as ducat's `RangeError` for one that isn't a positive safe integer |
| `RateTable` | [`ducat::convert::RateTable`](../crates/ducat/src/convert/provider.rs) | same |  |
| `RateTable#asOf` | `RateTable::as_of` | same | an `Option<Time>` |
| `RateTable#availableAt` | `RateTable::available_at` | same | an `Option<Time>` |
| `RateTable#base` | `RateTable::base` | same | an `Option<CurrencyCode>` |
| `RateTable#missing` | `RateTable::missing` | same | `CurrencyCode`s; plus `unknown()` for codes the port skips |
| `RateTable#rate` | `RateProvider::rate` for `RateTable` | same | filters by the rate's and the table's timing, as ducat |
| `RateTable#rates` | `RateTable::rates` | same | in the order given |
| `RateTable#validUntil` | `RateTable::valid_until` | same | an `Option<Time>` |
| `RateTableSpec` | `ducat::convert::RateTableBuilder`, `RateTable::from_rates` | divergent: [times are read strictly](design.md#milestone-5d1-rates-providers-and-bags) | `RateTable::with_base(base, info)` with `.rate(currency, text)`, `.entry(currency, rate)` (`Err(CurrencyMismatch)` for another pair, as ducat) and `.missing(currency)` for ducat's `null`; the timing is a `RateInfo` of `Time`s, read strictly (see `RateInfo`). `.rate` takes text: a `bigint` or `Ratio` entry goes through `entry` |
| `RateType` | `ducat::convert::RateType` | same | `Mid`, `Bid`, `Ask` and any other name, as ducat's open string type |
| `RateUnavailableError` | `ducat::Error::RateUnavailable` | same |  |
| `RateUnavailableError#asOf` | `Error::RateUnavailable { as_of }` | same | an `Option<Time>` |
| `RateUnavailableError#from` | `Error::RateUnavailable { from }` | same | a `CurrencyCode` |
| `RateUnavailableError#to` | `Error::RateUnavailable { to }` | same | a `CurrencyCode` |
| `SnapshotOptions` | — | missing | with `snapshots` |
| `SnapshotOptions#lookback` | — | missing | with `snapshots` |
| `SnapshotOptions#max` | — | missing | with `snapshots` |
| `Snapshots` | — | missing | with `snapshots` |
| `Snapshots#at` | — | missing | with `snapshots` |
| `TotalOptions` | `ducat::convert::TotalOptions` | same | `Default` is ducat's no-options call |
| `TotalOptions#asOf` | `TotalOptions::query` | divergent: [times are read strictly](design.md#milestone-5d1-rates-providers-and-bags) | the `RateQuery`'s `Time`, as `ComparatorOptions#asOf` |
| `TotalOptions#scale` | `TotalOptions::scale` | same | an `Option<u16>`: `Err(InvalidScale)` past `MAX_SCALE` |
| `bag` | `MoneyBag::new`, `MoneyBag::of` | same | `MoneyBag::of(items)` (a `Result` that can't fail), `MoneyBag::new()` for none |
| `chain` | `ducat::convert::chain` | same | providers of one type; mix kinds as `BoxedProvider`s |
| `comparator` | `ducat::convert::comparator` | same | a `Comparator` whose `compare` returns `Result<Ordering, _>`: `Err(RateUnavailable)` where ducat's function throws |
| `convert` | `Rate::convert`, `Money::convert`, `AnyMoney::convert`, `convert_through` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | as `Money#convert`; a factor conversion at a scale is `AnyRate::new(..)?.convert_with` |
| `convertDetailed` | `Rate::convert_detailed`, `convert_detailed_with`, `AnyRate::convert_detailed` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the rounding is required (ducat defaults to halfExpand); validity is checked first, as ducat |
| `exchangeRate` | `Rate::new`, `Rate::parse`, `AnyRate::new` | same | the codes are `CurrencyCode`s (ducat takes any string); `Err(NonPositiveRate)` for a rate that isn't positive, as ducat's `RangeError`; ducat's `info` is `with_info` (see `RateInfo`); `parse` keeps the published digits |
| `identity` | `ducat::convert::identity` | same |  |
| `impliedRate` | `AnyRate::implied`, `Rate::implied` | same | `AnyRate::implied(&presented, &settled, info)` takes run-time currencies and ducat's `info` (`RateInfo::default()` for none); the typed `Rate::implied(&Money<F>, &Money<T>)` takes none (chain `with_info`). Failures in ducat's order: `Err(DivisionByZero)` for a zero `presented` (ducat's `ratio(n, 0)` `RangeError`), `Err(NonPositiveRate)` for a quotient that isn't positive (`Exchange rate must be positive`), then `with_info`'s quote errors |
| `isRate` | — | not ported: by design (the type system) |  |
| `multiplyByRatioAtScale` | `Money::multiply`, `AnyMoney::multiply` with a scaled `RoundingPolicy` | divergent: [single rounding into another scale](design.md#parity-decisions) | `Money::multiply`/`AnyMoney::multiply` with a `RoundingPolicy::new(mode).with_scale(s)?` rounds the product once at scale `s`; the minor-unit kernel on `Int` isn't public. Failures differ: the TS kernel checks no argument (any integer `scaleShift`, negative or past 1000, works; a fractional or infinite one is a native `RangeError` from `BigInt`, a huge one `RangeError: Maximum BigInt size exceeded`; `NaN` acts as 0), where Rust's target scale is a `u16` and `with_scale` returns `Err(InvalidScale)` past `MAX_SCALE` (1000), so no shift to a negative or a >1000 scale; nothing panics |
| `rateFromJSON` | `serde::Deserialize` for `Rate`/`AnyRate` | divergent: [times are read strictly](design.md#milestone-5d1-rates-providers-and-bags) | `Deserialize` reads the times strictly (see `RateInfo`) and the rate as `Ratio`'s `FromStr`; ducat reads them with `new Date` and `ratio()` |
| `rateOf` | `ducat::convert::rate_of`, `Rate::lookup` | same | `Err(RateUnavailable)` when the provider has none, `Err(CurrencyMismatch)` when it answers for another pair, as ducat |
| `rateTable` | `RateTable::with_base`, `RateTable::from_rates` | same | see `RateTableSpec` |
| `reversed` | `ducat::convert::reversed` | same |  |
| `snapshots` | — | missing | tables loaded on demand by date; decided: a sync loader closure/trait in `ducat`, async in `ducat-fetch` |
| `snapshotsFrom` | — | missing | as `snapshots`, from a list of loaders |
| `sortByValue` | `ducat::convert::sort_by_value` | same | every rate is looked up before anything is reordered; `Err(RateUnavailable)` where ducat throws |
| `sumByCurrency` | `ducat::convert::sum_by_currency` | same | a `Vec` in first-seen order, ducat's `Map` |
| `via` | `ducat::convert::via` | same |  |

### `./convert/ecb`

[`ducat::convert::ecb`](../crates/ducat/src/convert/ecb.rs) (feature `ecb`); parsers take `&str` and return `Error::MalformedRates` for a file they can't read.

| TS | Rust | status | note |
|---|---|---|---|
| `EcbAvailableAt` | `ducat::convert::Publication` | divergent: [publication times without time-zone data](design.md#milestone-5d2-rate-sources) | `Unknown`, `Stated`, `Given(&dyn Fn)` |
| `EcbOptions` | `ducat::convert::ecb::EcbOptions` | same | `Default` is ducat's no-options call |
| `EcbOptions#availableAt` | `EcbOptions::available_at` | divergent: [publication times without time-zone data](design.md#milestone-5d2-rate-sources) | `Publication::Stated` is ducat's `true`: 16:00 Frankfurt time by the EU summer-time rule written out (agrees with tzdata 1999 to 2039), where ducat asks `Intl` for Europe/Berlin; `Given` returns a `Time`, where ducat's function may return any date string or `Date` |
| `EcbSdmxOptions` | `ducat::convert::ecb::EcbSdmxOptions` | same | `Default` is ducat's no-options call |
| `EcbSdmxOptions#availableAt` | `EcbSdmxOptions::available_at` | divergent: [publication times without time-zone data](design.md#milestone-5d2-rate-sources) | as `EcbOptions#availableAt` |
| `EcbSdmxOptions#decimals` | `EcbSdmxOptions::decimals` | same | a slice of `(code, u8)`, as `parse_ecb_sdmx_decimals` returns it; more than 30 is `Err(InvalidDecimals)`, ducat's `RangeError` |
| `parseEcbCsv` | `ducat::convert::ecb::parse_ecb_csv` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | a code that isn't ISO 4217 (current or withdrawn) is skipped and listed in `RateTable::unknown()`, where ducat keeps it as a currency; `Err(MalformedRates)` where ducat throws `SyntaxError` |
| `parseEcbSdmxCsv` | `ducat::convert::ecb::parse_ecb_sdmx_csv` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | as `parseEcbCsv` |
| `parseEcbSdmxDecimals` | `ducat::convert::ecb::parse_ecb_sdmx_decimals` | same | a `Vec<(String, u8)>` (ducat's record), codes as text; `Err(MalformedRates)` for a DECIMALS past 30, as ducat's `SyntaxError` |
| `parseEcbXml` | `ducat::convert::ecb::parse_ecb_xml` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | as `parseEcbCsv` |

### `./convert/history`

[`ducat::convert::history`](../crates/ducat/src/convert/history.rs) (feature `history`).

| TS | Rust | status | note |
|---|---|---|---|
| `Fallback` | `ducat::convert::history::Fallback` | same | `day` a `Date`, `reason` a `FallbackReason` |
| `FallbackReason` | `ducat::convert::history::FallbackReason` | same | `NoTable`, `NotYetAvailable`, `Expired`, `Missing`, `NotQuoted` |
| `QuotedRate` | `ducat::convert::history::QuotedRate` | same | `per: Option<i64>` (below 1 is `Err(InvalidQuote)`), `decimals: Option<u8>` (past 30 `Err(InvalidDecimals)`), as ducat's `RangeError`s |
| `QuotedTableSpec` | `ducat::convert::history::QuotedTableSpec` | divergent: [times are read strictly](design.md#milestone-5d1-rates-providers-and-bags) | `base` and the rates' codes are `CurrencyCode`s (`unknown` holds other codes), the timing a `RateInfo` of `Time`s read strictly (see `./convert` `RateInfo`) |
| `RateHistory` | `ducat::convert::history::RateHistory` | same |  |
| `RateHistory#lookup` | `RateHistory::lookup` | same | a `RateLookup` with the days passed over, as ducat |
| `RateHistory#rate` | `RateProvider::rate` for `RateHistory` | same |  |
| `RateHistory#tables` | `RateHistory::tables` | same | newest first |
| `RateHistoryOptions` | the arguments of `rate_history` | same | the `lookback` argument |
| `RateHistoryOptions#lookback` | the `lookback` argument of `rate_history` | same | a `u32`, required (ducat defaults to 4), so ducat's `RangeError` for a negative or fractional one can't happen |
| `RateLookup` | `ducat::convert::history::RateLookup` | same | `rate: Option<AnyRate>`, `skipped` |
| `quotedTable` | `ducat::convert::history::quoted_table` | same | the rates' text is trimmed, as ducat; `Err(InvalidQuote)`, `Err(InvalidDecimals)`, `Err(NonPositiveRate)` where ducat throws `RangeError` |
| `rateFromQuote` | `ducat::convert::history::rate_from_quote` | same | an `AnyRate`; `Err(InvalidQuote)` for a quote that isn't a plain positive decimal or a `per` below 1, ducat's `RangeError`; the `info` is a `RateInfo` (see `./convert` `RateInfo`) |
| `rateHistory` | `ducat::convert::history::rate_history` | same | a table without an `as_of` is `Err(UndatedTable)`, a range-kind error with ducat's message (`RangeError: rateHistory needs tables with an asOf`); `lookback` is a `u32`, so ducat's first check (a non-negative integer) has no failing input |

### `./convert/boc`

[`ducat::convert::boc`](../crates/ducat/src/convert/boc.rs) (feature `boc`).

| TS | Rust | status | note |
|---|---|---|---|
| `BankOfCanadaOptions` | `ducat::convert::boc::BankOfCanadaOptions` | same | `Default` (`Publication::Stated`) is ducat's no-options call |
| `BankOfCanadaOptions#availableAt` | `BankOfCanadaOptions::available_at` | divergent: [publication times without time-zone data](design.md#milestone-5d2-rate-sources) | Toronto 16:30 by the written-out DST rule |
| `parseBankOfCanadaJson` | `ducat::convert::boc::parse_bank_of_canada_json` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | as `./convert/ecb` `parseEcbCsv`; `Err(MalformedRates)` where ducat throws `SyntaxError` |

### `./convert/fed`

[`ducat::convert::fed`](../crates/ducat/src/convert/fed.rs) (feature `fed`).

| TS | Rust | status | note |
|---|---|---|---|
| `parseFedH10Csv` | `ducat::convert::fed::parse_fed_h10_csv` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | as `./convert/ecb` `parseEcbCsv` |

### `./words`

The crate [`ducat-words`](../crates/ducat-words/src/lib.rs): ducat's own RBNF interpreter over CLDR's rule text, a feature per language.

| TS | Rust | status | note |
|---|---|---|---|
| `AmountInWordsOptions` | `ducat_words::AmountInWordsOptions` | same | plus the required `currency: UnitNames` (see `amountInWords`) |
| `AmountInWordsOptions#gender` | `AmountInWordsOptions::gender` (`Gender`) | same | `Option<Gender>`: `Masculine`, `Feminine`, `Neuter`; `None` is ducat's default |
| `AmountInWordsOptions#minor` | `AmountInWordsOptions::minor` | same | `Option<UnitNames>`; `None` writes the minor part cheque-style (`45/100`), as ducat |
| `AmountInWordsOptions#ruleSet` | `AmountInWordsOptions::rule_set` | same | `Option<&str>`: `Err(NoRuleSet)`, `Err(PrivateRuleSet)` where ducat throws `RangeError` |
| `SpelloutRules` | `ducat_words::SpelloutRules`, `CompiledRules` | divergent: [a fixed set of languages for words](design.md#parity-decisions) | `locale` is a `Locale` (the seven shipped languages), not any BCP 47 tag: the plural rules, digit grouping and word for "and" come from the crate's CLDR 48 data, where ducat's come from `Intl` for any locale, so rule text for another language (Polish, say) can't be used. Malformed rule text is `Err(MalformedRules)` where ducat throws `SyntaxError` |
| `UnitNames` | `ducat_words::UnitNames` | same | `other`, with `one`, `two`, `few` and `many`; ducat's type also allows `zero`, a category none of the seven languages has |
| `amountInWords` | `ducat_words::amount_in_words` | divergent: [currency names are the caller's](design.md#currency-names-in-words) | `AmountInWordsOptions::currency` is required: no CLDR names as defaults yet (decided: feature `cldr-names`) |
| `ruleSets` | `CompiledRules::rule_sets` | same | the public rule sets, in the rules' order, as ducat |
| `spellOut` | `ducat_words::spell_out`, `spell_out_int` | same | values within ±(2^63 − 1), ICU's range: `Err(OutOfRange)` outside, `Err(PrivateRuleSet)`, `Err(NoRuleSet)`, `Err(NoRule)`, `Err(PluralTruncation)`, `Err(TooDeep)`, `Err(TooManySteps)` for ducat's `RangeError`s; `i128` or `&Int` input, so ducat's `RangeError` for an unsafe number can't arise |

### `./words/de`

`ducat_words::GERMAN` (feature `de`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `german` | `ducat_words::GERMAN` | same | CLDR 49's rule text for `de`, with the `Locale::De` data |

### `./words/en`

`ducat_words::ENGLISH` (feature `en`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `english` | `ducat_words::ENGLISH` | same | CLDR 49's rule text for `en`, with the `Locale::En` data |

### `./words/es`

`ducat_words::SPANISH` (feature `es`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `spanish` | `ducat_words::SPANISH` | same | CLDR 49's rule text for `es`, with the `Locale::Es` data |

### `./words/fr`

`ducat_words::FRENCH` (feature `fr`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `french` | `ducat_words::FRENCH` | same | CLDR 49's rule text for `fr`, with the `Locale::Fr` data |

### `./words/it`

`ducat_words::ITALIAN` (feature `it`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `italian` | `ducat_words::ITALIAN` | same | CLDR 49's rule text for `it`, with the `Locale::It` data |

### `./words/nl`

`ducat_words::DUTCH` (feature `nl`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `dutch` | `ducat_words::DUTCH` | same | CLDR 49's rule text for `nl`, with the `Locale::Nl` data |

### `./words/pt`

`ducat_words::PORTUGUESE` (feature `pt`, a default).

| TS | Rust | status | note |
|---|---|---|---|
| `portuguese` | `ducat_words::PORTUGUESE` | same | CLDR 49's rule text for `pt`, with the `Locale::Pt` data |

### `./wire`

[`ducat::wire`](../crates/ducat/src/wire.rs) (feature `wire`): plain structs with conversions on `Money` and `AnyMoney`, each in its format's JSON shape under `serde`.

| TS | Rust | status | note |
|---|---|---|---|
| `DineroObject` | `ducat::wire::DineroObject` | same | `amount` an `i64`, `precision` a `u16`; serde in dinero.js's JSON shape |
| `GoogleMoney` | `ducat::wire::GoogleMoney` | same | `units` an `i64`, `nanos` an `i32`, checked by `GoogleMoney::new` (`Err(InvalidWire)`, ducat's `RangeError`); serde writes ProtoJSON (`units` a string) |
| `GoogleMoneyInput` | `ducat::wire::GoogleMoney` (serde reads numbers or strings) | divergent: [no 2^53 rule for `units`](design.md#milestone-5e-wire-formats) |  |
| `Iso20022Amount` | `ducat::wire::Iso20022Amount` | same | `ccy` and `value`; serde as `{ "Ccy", "value" }` |
| `Iso20022WriteOptions` | the arguments of `Money::to_iso20022_amount` | same | the `scale: Option<u16>` argument |
| `Iso20022WriteOptions#scale` | the `scale` argument of `to_iso20022_amount` | same | `None` is the currency's exponent; above 5 is `Err(InvalidWire)` where ducat throws `RangeError` (the `u16` rules out negative and fractional scales) |
| `MinorUnitAmount` | `ducat::wire::MinorUnitAmount` | same | `value` an `i64` |
| `WireReadOptions` | `ducat::wire::WireReadOptions` | same | `Default` is ducat's no-options call |
| `WireReadOptions#rounding` | `WireReadOptions::rounding` | same | `Rounding::Unnecessary` by default, as ducat (`Err(Rounding)` where it throws `RoundingError`) |
| `WireReadOptions#scale` | `WireReadOptions::scale` | same | an `Option<u16>`: `Err(InvalidScale)` past `MAX_SCALE`, ducat's `RangeError` |
| `fromDineroObject` | `Money::from_dinero_object`, `AnyMoney::from_dinero_object`, `AnyMoney::from_dinero_object_with` | same | a typed `Money<C>` reads `C`'s own code at its exponent, so a `define_currency!` currency is read as ducat reads a `defineCurrency`'d one (`{ amount: 1, currency: 'POINTS', precision: 0 }`); `AnyMoney`'s `_with` reader takes the known currencies as an argument (`wire::KnownCurrencies`: a `CurrencyCode`, a slice or array of them, or a resolver closure such as `CurrencyCode::crypto`), ducat's registry without a global one. ISO codes come first and can't be redefined; withdrawn codes need no `defineHistoricCurrencies` (no registry). The same failures in ducat's order: `Err(InvalidScale)` past 1000 (`RangeError`), then `Err(UnknownCurrency)`; the `i64` amount rules out ducat's fractional and unsafe numbers |
| `fromGoogleMoney` | `Money::from_google_money`, `AnyMoney::from_google_money`, `AnyMoney::from_google_money_with` | same | currencies as `fromDineroObject`: a `define_currency!` three-letter code (`BTC`) is read; a longer one (`POINTS`) is `Err(InvalidWire)`, as ducat's `RangeError` for the format's code. The same checks and failures in ducat's order: `Err(InvalidWire)` for a malformed value (`RangeError`), `Err(UnknownCurrency)`, `Err(Rounding)` (`RoundingError`) |
| `fromIso20022Amount` | `Money::from_iso20022_amount`, `AnyMoney::from_iso20022_amount`, `AnyMoney::from_iso20022_amount_with` | divergent: [withdrawn codes need no registration](design.md#parity-decisions) | currencies as `fromDineroObject`, among ISO 4217's codes: a non-monetary code (XAU) is read at the exponent `C` (or the known currencies) give it, and a code ISO never published (BTC) is `Err(UnknownCurrency)` even when defined, as ducat. A withdrawn code (HRK) is always read, at the table's exponent or `C`'s, where ducat reads one only once `defineHistoricCurrencies` registers it and refuses a `defineCurrency`'d HRK (`RangeError`): Rust accepts what ducat rejects (no registry). The same checks in ducat's order: `Err(Syntax)` for the code's shape (`SyntaxError`), `Err(UnknownCurrency)` for a code that isn't ISO 4217 (`RangeError`), `Err(Syntax)` for the text, `Err(InvalidWire)` for a negative amount (`RangeError`), `Err(UnknownCurrency)` for an undefined non-monetary code, `Err(Rounding)` |
| `fromMinorUnits` | `Money::from_minor_units`, `AnyMoney::from_minor_units`, `AnyMoney::from_minor_units_with` | same | currencies as `fromDineroObject`: `{ value: 1, currency: 'BTC' }` is read in `Money<Btc>`, or with `BTC` known. The `i64` value is read whatever its size, where ducat refuses an unsafe *number* (`RangeError`) but reads any `bigint`, as the processors' readers ([integer amounts](design.md#milestone-5c-payment-processors)) |
| `toDineroObject` | `Money::to_dinero_object`, `AnyMoney::to_dinero_object` | same | `Err(Overflow)` past 2^53 − 1 units, where ducat throws `RangeError`; any currency, custom ones included, as ducat |
| `toGoogleMoney` | `Money::to_google_money`, `AnyMoney::to_google_money` | same | the rounding is an argument (`Rounding::Unnecessary` is ducat's default). The same failures in ducat's order: `Err(InvalidWire)` for a code that isn't three capital letters (`RangeError`), `Err(Rounding)` past 9 decimals (`RoundingError`), `Err(Overflow)` past int64 units (`RangeError`) |
| `toIso20022Amount` | `Money::to_iso20022_amount`, `AnyMoney::to_iso20022_amount` | same | the rounding is an argument (`Rounding::Unnecessary` is ducat's default, which doesn't round). The same failures in ducat's order: `Err(UnknownCurrency)` for a code that isn't ISO 4217 (`RangeError`), `Err(InvalidWire)` for a scale above 5, `Err(Rounding)`, `Err(InvalidWire)` for a negative amount, `Err(Overflow)` past 18 digits (`RangeError`s) |
| `toMinorUnits` | `Money::to_minor_units`, `AnyMoney::to_minor_units` | same | the rounding is an argument (ducat's default `'unnecessary'`); `Err(Rounding)`, then `Err(Overflow)` past 2^53 − 1 (ducat's `RoundingError`, `RangeError`) |

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
| `CryptoCurrencyCode` | `ducat::CurrencyCode::crypto` | same | a `CurrencyCode` from the table, `Err(UnknownCurrency)` for another code |
| `CryptoUnit` | `ducat::crypto::CryptoUnit` | same | getters: `code` (with the decimals as its exponent), `decimals`, `name`, `base_unit`, `network`, `contract` |
| `cryptoUnit` | `ducat::crypto::unit` | same | `None` for a code not in the table, as ducat's `undefined` |
| `cryptoUnits` | `ducat::crypto::units` | same | an iterator, by code |
| `defineCryptoCurrencies` | `ducat::CurrencyCode::crypto` | divergent: [no registry](design.md#decisions-made-while-building-milestone-1) | a code from the table, nothing registered |
| `fromBaseUnits` | `Money::from_base_units`, `AnyMoney::from_base_units` | same | text read as ducat reads it (an optional minus, digits, no leading zeros, at most 1000 digits; `Err(Syntax)` where ducat throws `SyntaxError`); a `bigint` or number count is `from_minor`. ducat looks the currency up (`RangeError` for an unknown one); a `CurrencyCode` already carries the exponent |
| `toBaseUnits` | `Money::to_base_units`, `AnyMoney::to_base_units` | same | an `Int`; `Err(Rounding)` for a fraction of a base unit, where ducat throws `RoundingError` |

### `./currencies`

`ducat::currencies` (feature `currencies`); names and symbols are CLDR's, in [`ducat-format`](../crates/ducat-format/src/format.rs).

| TS | Rust | status | note |
|---|---|---|---|
| `CurrencySymbolOptions` | the `narrow` argument of `ducat_format::currency_symbol` | same | `narrow: bool` |
| `CurrencySymbolOptions#display` | the `narrow: bool` argument of `currency_symbol` | same | `true` for `'narrow'`, `false` for `'symbol'` (ducat's default) |
| `currencyFromNumeric` | `ducat::currencies::currency_from_numeric`, `currency_from_number` | same | `currency_from_numeric(&str)` (trimmed, one to three ASCII digits) and `currency_from_number(u16)`: `Ok(None)` for a number ISO doesn't assign, as ducat's `undefined`, and `Err(InvalidNumericCode)` for anything else (above 999, not digits), where ducat throws `RangeError` |
| `currencyName` | `ducat_format::currency_name` | divergent: [CLDR 48 data, a fixed set of locales](design.md#coverage) | TS reads the runtime's `Intl` |
| `currencySymbol` | `ducat_format::currency_symbol` | divergent: [CLDR 48 data, a fixed set of locales](design.md#coverage) |  |
| `minorUnit` | `ducat::currencies::minor_unit` | same | an `AnyMoney` (`to_decimal()` is ducat's string, `"0.01"`); it takes a `CurrencyCode`, so ducat's `RangeError` for an unknown code is the code's parse error (`UnknownCurrency`) |
| `numericCode` | `ducat::currencies::numeric_code`, `CurrencyCode::numeric_code` | same | `None` for a code without one, as ducat's `undefined` |

### `./territories`

`ducat::territories` (feature `territories`).

| TS | Rust | status | note |
|---|---|---|---|
| `TerritoryCurrency` | `ducat::territories::TerritoryCurrency` | same | `currency`, `from`, `to` (`Option<&str>`), `tender` |
| `TerritoryOptions` | `ducat::territories::TerritoryOptions` | same | `Default` is ducat's no-options call |
| `TerritoryOptions#includeNonTender` | `TerritoryOptions::include_non_tender` | same | `false` by default, as ducat |
| `TerritoryOptions#on` | `TerritoryOptions::on` | same | an `Option<&str>`, checked only for its `YYYY-MM-DD` shape and compared as text, as ducat: `Err(InvalidDate)` where ducat throws `RangeError` |
| `currencyTerritories` | `ducat::territories::currency_territories` | same | in code order; `Err(InvalidDate)` as `TerritoryOptions#on` |
| `territoryCurrencies` | `ducat::territories::territory_currencies` | same | an unknown territory gives an empty list, as ducat; `Err(InvalidDate)` as `TerritoryOptions#on` |

### `./historic`

`ducat::historic` (feature `historic`).

| TS | Rust | status | note |
|---|---|---|---|
| `HistoricCurrencies` | — | not ported: by design (no registry: currencies carry their exponent) | a TS declaration-merging registry |
| `HistoricCurrency` | `ducat::historic::HistoricCurrency` | same | getters: `code`, `exponent`, `name`, `numeric`, `withdrawn` |
| `HistoricCurrencyCode` | `ducat::CurrencyCode::historic` | same | a `CurrencyCode` from the table, `Err(UnknownCurrency)` for another code |
| `ISO_4217_LIST_THREE_PUBLISHED` | `ducat::historic::LIST_THREE_PUBLISHED` | same | the same date |
| `defineHistoricCurrencies` | `ducat::CurrencyCode::historic` | divergent: [no registry](design.md#decisions-made-while-building-milestone-1) |  |
| `historicCurrencies` | `ducat::historic::currencies` | same | an iterator, by code |
| `historicCurrency` | `ducat::historic::currency` | same | `None` for a code not in the table, as ducat's `undefined` |

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
| `annualRate` | [`ducat::finance::annual_rate`](../crates/ducat/src/finance/rates.rs) | same | `Err(InvalidPerYear)` outside 1 to `MAX_PERIODS`, then `Err(RateTooLow)` at or below −1, in ducat's order (its `RangeError`s) |
| `compound` | [`Money::compound`, `AnyMoney::compound`](../crates/ducat/src/finance/day_count.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `discountedSum` | [`ducat::finance::discounted_sum`](../crates/ducat/src/finance/rates.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `discountedSumExact` | [`ducat::finance::discounted_sum_exact`](../crates/ducat/src/finance/rates.rs) | same | also needs the `exact` feature; `Err(NoFlows)`, `Err(CurrencyMismatch)`, `Err(RateTooLow)` where ducat throws, in its order |
| `interest` | [`Money::interest`, `AnyMoney::interest`](../crates/ducat/src/finance/day_count.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'` |
| `interestExact` | [`Money::interest_exact`, `AnyMoney::interest_exact`](../crates/ducat/src/finance/day_count.rs) | same | `exact` feature |
| `irr` | [`ducat::excel::irr`](../crates/ducat/src/finance/rates.rs) | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: a deprecated TS re-export of `./excel`'s `irr`; there's no `ducat::finance::irr` |
| `npv` | [`ducat::excel::npv`](../crates/ducat/src/finance/rates.rs) | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: a deprecated TS re-export of `./excel`'s `npv`; there's no `ducat::finance::npv` (and rounding is required) |
| `npvExact` | [`ducat::excel::npv_exact`](../crates/ducat/src/finance/rates.rs) | divergent: [only in `ducat::excel`](design.md#mapping-ducats-entries) | undocumented: a deprecated TS re-export of `./excel`'s `npvExact`; there's no `ducat::finance::npv_exact` |
| `periodicRate` | [`ducat::finance::periodic_rate`](../crates/ducat/src/finance/rates.rs) | same | `Err(InvalidPerYear)` outside 1 to 50,000, `Err(InvalidDigits)` past 100 or past 50,000 with `per_year`, `Err(RateTooLow)`, in ducat's order (its `RangeError`s) |
| `prorate` | [`Money::prorate`, `AnyMoney::prorate`](../crates/ducat/src/finance/proration.rs) | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | rounding is required; TS defaults to `'halfExpand'`. Errors: `InvalidPeriod`, `OutsidePeriod`, `InvalidInstant`, `Rounding` |
| `savingsPlan` | [`ducat::finance::savings_plan`](../crates/ducat/src/finance/savings.rs) | same | errors in ducat's order: `InvalidPeriods`, `InvalidPerYear`, `InvalidSavingsPlan`, `CurrencyMismatch`, `NotAMultiple`, `RateTooLow`, `PowerTooLarge` (ducat's same 2^20-bit limit), `Unsettled`, `DateOutOfRange` (ducat's `RangeError`s and `CurrencyMismatchError`) |
| `splitPeriod` | [`Money::split_period`, `AnyMoney::split_period`](../crates/ducat/src/finance/proration.rs) | same | errors: `InvalidPeriod`, `InvalidInstant`, `OutsidePeriod` for change points that don't increase inside the period (ducat's `RangeError`s) |
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
| `BankOfEnglandOptions` | `ducat::convert::boe::BankOfEnglandOptions` | same | `Default` (4 decimals) is ducat's no-options call |
| `BankOfEnglandOptions#decimals` | `BankOfEnglandOptions::decimals` | same | a `u8`, 0 to 30 (`Err(InvalidDecimals)`, ducat's `RangeError`) |
| `parseBankOfEnglandCsv` | `ducat::convert::boe::parse_bank_of_england_csv` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | as `./convert/ecb` `parseEcbCsv` |

### `./convert/hmrc`

[`ducat::convert::hmrc`](../crates/ducat/src/convert/hmrc.rs) (feature `hmrc`).

| TS | Rust | status | note |
|---|---|---|---|
| `HmrcOptions` | `ducat::convert::hmrc::HmrcOptions` | same | `Default` (`Publication::Stated`) is ducat's no-options call |
| `HmrcOptions#availableAt` | `HmrcOptions::available_at` | same | `Stated` is ducat's default (the end of the Wednesday before the month before's penultimate Thursday, UTC: no time zone involved), `Unknown` its `false`, `Given` its function (returning a `Time`) |
| `parseHmrcMonthlyCsv` | `ducat::convert::hmrc::parse_hmrc_monthly_csv` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | as `./convert/ecb` `parseEcbCsv` |

### `./convert/fetch`

The crate [`ducat-fetch`](../crates/ducat-fetch/src/lib.rs): a sans-IO core and blocking fetchers over a `Transport` (`UreqTransport` behind the default `ureq` feature). `FetchError` carries every error kind ducat throws here (`Status` for `FetchRatesError`, `Parse`, `Transport`, and the `RangeError`s as `InvalidCurrency`, `StartTooEarly`, `EndBeforeStart`, `EndWithoutStart`).

| TS | Rust | status | note |
|---|---|---|---|
| `AbortSignalLike` | — | not ported: by design (cancellation and timeouts are the transport's) |  |
| `AbortSignalLike#aborted` | — | not ported: by design (as `AbortSignalLike`) |  |
| `AbortSignalLike#addEventListener` | — | not ported: by design (as `AbortSignalLike`) |  |
| `AbortSignalLike#reason` | — | not ported: by design (as `AbortSignalLike`) |  |
| `AbortSignalLike#removeEventListener` | — | not ported: by design (as `AbortSignalLike`) |  |
| `BANK_OF_CANADA_URL` | `ducat_fetch::BANK_OF_CANADA_URL` | same | the same URL |
| `ECB_DATA_API` | `ducat_fetch::ECB_DATA_API` | same | the same URL |
| `ECB_URLS` | `ducat_fetch::ECB_URLS` (`EcbUrls`) | divergent: [a struct, `ninety_days` for `90d`](design.md#milestone-7b-fetching-rates) |  |
| `Fetch` | `ducat_fetch::Transport` | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchBankOfCanadaOptions` | `ducat_fetch::FetchBankOfCanadaOptions` | same | `Default` is ducat's no-options call (`recent=1`) |
| `FetchBankOfCanadaOptions#end` | `FetchBankOfCanadaOptions::end` | divergent: [days are `Date`s](design.md#milestone-7b-fetching-rates) | an `Option<Date>`: ducat's `RangeError` for text that isn't a calendar day is the caller's `Date` parse error, and a JavaScript `Date`'s UTC day has no counterpart; `FetchError::EndBeforeStart`, `EndWithoutStart` as ducat's `RangeError`s |
| `FetchBankOfCanadaOptions#fetch` | the `&mut impl Transport` argument | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchBankOfCanadaOptions#signal` | — | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) | the transport cancels |
| `FetchBankOfCanadaOptions#start` | `FetchBankOfCanadaOptions::start` | divergent: [days are `Date`s](design.md#milestone-7b-fetching-rates) | an `Option<Date>`, as `#end`; `FetchError::StartTooEarly` before 2017-01-03, as ducat's `RangeError` |
| `FetchBankOfCanadaOptions#timeout` | `UreqTransport::with_timeout` | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbOptions` | `ducat_fetch::FetchEcbOptions` | same | `Default` is ducat's no-options call (`daily`) |
| `FetchEcbOptions#availableAt` | `FetchEcbOptions::available_at` | divergent: [publication times without time-zone data](design.md#milestone-5d2-rate-sources) | a `Publication`, passed to the parser as ducat passes it: see `./convert/ecb` `EcbOptions#availableAt` |
| `FetchEcbOptions#fetch` | the `&mut impl Transport` argument | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbOptions#history` | `FetchEcbOptions::history` (`EcbHistory`) | divergent: [an enum](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbOptions#signal` | — | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbOptions#timeout` | `UreqTransport::with_timeout` | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbRangeOptions` | `ducat_fetch::FetchEcbRangeOptions` | same |  |
| `FetchEcbRangeOptions#availableAt` | `FetchEcbRangeOptions::available_at` | divergent: [publication times without time-zone data](design.md#milestone-5d2-rate-sources) | as `FetchEcbOptions#availableAt` |
| `FetchEcbRangeOptions#currencies` | `FetchEcbRangeOptions::currencies` | same | `&[&str]`, checked as ducat checks them (three ASCII capitals): `FetchError::InvalidCurrency` for ducat's `RangeError` |
| `FetchEcbRangeOptions#end` | `FetchEcbRangeOptions::end` | divergent: [days are `Date`s](design.md#milestone-7b-fetching-rates) | an `Option<Date>`, as `FetchBankOfCanadaOptions#end` |
| `FetchEcbRangeOptions#fetch` | the `&mut impl Transport` argument | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbRangeOptions#signal` | — | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchEcbRangeOptions#start` | `FetchEcbRangeOptions::start` | divergent: [days are `Date`s](design.md#milestone-7b-fetching-rates) | a `Date`, as `FetchBankOfCanadaOptions#start`; `FetchError::StartTooEarly` before 1999-01-04 |
| `FetchEcbRangeOptions#timeout` | `UreqTransport::with_timeout` | divergent: [the transport replaces `fetch`, `signal` and `timeout`](design.md#milestone-7b-fetching-rates) |  |
| `FetchRatesError` | `ducat_fetch::FetchError::Status` | same | `FetchError::Status { url, status }` |
| `FetchRatesError#status` | `FetchError::status` | same | `Option<u16>`, `Some` for `Status` |
| `FetchRatesError#url` | `FetchError::url` | same | `Option<&str>`, also for `Parse` and `Transport` |
| `fetchBankOfCanada` | `ducat_fetch::fetch_bank_of_canada`, `bank_of_canada_request`/`bank_of_canada_tables` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | the tables come from `parse_bank_of_canada_json`, which skips codes that aren't ISO 4217 into `unknown()`; the request and its failures (`FetchError::Status`, `Parse` for ducat's `SyntaxError` with ` (from url)`, `Transport`) as ducat |
| `fetchEcb` | `ducat_fetch::fetch_ecb`, `ecb_request`/`ecb_tables` | divergent: [currency codes in files](design.md#milestone-5d2-rate-sources) | the tables come from `parse_ecb_xml`, as `fetchBankOfCanada` |
| `fetchEcbRange` | `ducat_fetch::fetch_ecb_range`, `ecb_range_requests`/`ecb_range_tables` | divergent: [the two requests run one after the other](design.md#milestone-7b-fetching-rates) |  |

### `./exact`

[`ducat::exact`](../crates/ducat/src/exact.rs) (feature `exact`): `ExactMoney<C>` and `AnyExactMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `ExactMoney` | `ducat::exact::ExactMoney<C>`, `AnyExactMoney` | same | |
| `ExactMoney#abs` | `ExactMoney::abs`, `AnyExactMoney::abs` | same | |
| `ExactMoney#add` | `Add` for `ExactMoney<C>`; `AnyExactMoney::checked_add` | same | `AnyExactMoney::checked_add` takes only `&AnyExactMoney`: call `.exact()` on an `AnyMoney` first |
| `ExactMoney#clamp` | `ExactMoney::clamp`, `AnyExactMoney::clamp` | same | bounds exact or `Money` (owned or borrowed, `impl Into<ExactMoney<C>>`), as ducat's; `Err(LowAboveHigh)` where ducat throws `RangeError` (`clamp: lo > hi`), where `Ord::clamp` panics (`ExactMoney::clamp` takes `self` by value so that it, not `Ord::clamp`, is called). `AnyExactMoney`'s, in ducat's order: `Err(CurrencyMismatch)` for bounds in two currencies, `lo > hi`, then `Err(CurrencyMismatch)` for a value in another currency (`expected` `lo`'s, as ducat's `this.max(lo)`) |
| `ExactMoney#compare` | `Ord`; `AnyExactMoney::compare` | same | |
| `ExactMoney#convert` | `ducat::convert::Rate::convert_exact`, `AnyRate::convert_exact` | same | on the rate, not the money |
| `ExactMoney#currency` | `ExactMoney::currency` | same | |
| `ExactMoney#den` | `ExactMoney::value` → `Ratio::denom` | same | |
| `ExactMoney#denominator` | `ExactMoney::value` → `Ratio::denom` | same | |
| `ExactMoney#divide` | `ExactMoney::divide` | same | |
| `ExactMoney#equals` | `==` | same | `==` within one type only; call `.exact()` on a `Money` first; `AnyExactMoney` in different currencies is `!=` |
| `ExactMoney#greaterThan` | `>` | same | `>`; `compare(..)?.is_gt()`; call `.exact()` on a `Money` first |
| `ExactMoney#greaterThanOrEqual` | `>=` | same | `>=`; `compare(..)?.is_ge()`; call `.exact()` on a `Money` first |
| `ExactMoney#isExact` | `ExactMoney::is_exact`, `AnyExactMoney::is_exact` | same | a `Result<bool>`: `Err(InvalidScale)` for a scale past `MAX_SCALE`, ducat's `RangeError` (`Invalid scale`); `None` is ducat's default, the currency's exponent |
| `ExactMoney#isNegative` | `ExactMoney::is_negative`, `AnyExactMoney::is_negative` | same | |
| `ExactMoney#isPositive` | `ExactMoney::is_positive`, `AnyExactMoney::is_positive` | same | |
| `ExactMoney#isZero` | `ExactMoney::is_zero`, `AnyExactMoney::is_zero` | same | |
| `ExactMoney#lessThan` | `<` | same | `<` (typed); `AnyExactMoney::compare(..)?.is_lt()`; call `.exact()` on a `Money` first |
| `ExactMoney#lessThanOrEqual` | `<=` | same | `<=`; `compare(..)?.is_le()`; call `.exact()` on a `Money` first |
| `ExactMoney#max` | `ExactMoney::max`, `ExactMoney::max_of`; `AnyExactMoney::max`, `AnyExactMoney::max_of` | same | as `.` `Money#max`: the first of equal values wins (not `Ord::max`'s second; the inherent `ExactMoney::max` takes `self` by value so that `a.max(b)` resolves to it); `other` may be exact or `Money`, as ducat's; `max_of` is the variadic form over an iterator (`None` for none). `AnyExactMoney`'s return `Err(CurrencyMismatch)` where ducat throws, with ducat's `expected` (the candidate's currency) and `actual` (the largest so far's) |
| `ExactMoney#min` | `ExactMoney::min`, `ExactMoney::min_of`; `AnyExactMoney::min`, `AnyExactMoney::min_of` | same | as `ExactMoney#max`: the first of equal values wins; `AnyExactMoney`'s `Err(CurrencyMismatch)` has ducat's `expected` (the candidate's currency) and `actual` (the smallest so far's) |
| `ExactMoney#multiply` | `ExactMoney::multiply` | same | |
| `ExactMoney#negate` | `Neg` for `ExactMoney<C>` and `AnyExactMoney` (owned and borrowed) | same | |
| `ExactMoney#num` | `ExactMoney::value` → `Ratio::numer` | same | |
| `ExactMoney#numerator` | `ExactMoney::value` → `Ratio::numer` | same | |
| `ExactMoney#percentage` | `ExactMoney::percentage`, `AnyExactMoney::percentage` | same | |
| `ExactMoney#ratioOf` | `ExactMoney::ratio_of`, `AnyExactMoney::ratio_of` | same | the total may be exact or `Money` (owned or borrowed), as ducat's; `AnyExactMoney`'s, in ducat's order: `Err(CurrencyMismatch)` (`expected` the receiver's currency), then `Err(DivisionByZero)` for a zero total, ducat's `RangeError` |
| `ExactMoney#round` | `ExactMoney::round`, `AnyExactMoney::round` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | |
| `ExactMoney#roundWithResidual` | `ExactMoney::round_with_residual` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the mode is required |
| `ExactMoney#sign` | `ExactMoney::signum`, `AnyExactMoney::signum` | same | |
| `ExactMoney#subtract` | `Sub`; `AnyExactMoney::checked_sub` | same | as add: `checked_sub` takes only `&AnyExactMoney` |
| `ExactMoney#toJSON` | no `serde` impls, on purpose | same | ducat's `toJSON` always throws (`TypeError`: `ExactMoney has no JSON form; round() it to Money first`), so there is no shape to port; neither `ExactMoney<C>` nor `AnyExactMoney` implements `Serialize` or `Deserialize`, and serializing one is a compile error rather than a run-time one ([parity decisions](design.md#parity-decisions)). Round to `Money` first |
| `ExactMoney#toMoney` | `ExactMoney::to_money`, `AnyExactMoney::to_money` | same | in ducat's order: `Err(InvalidScale)` for a minimum past `MAX_SCALE`, `Err(Rounding)` for a value with no finite decimal form (ducat's `RoundingError`), then `Err(InvalidScale)` for one needing more than `MAX_SCALE` places (ducat's `RangeError`) |
| `ExactMoney#toNumber` | `ExactMoney::to_f64`, `AnyExactMoney::to_f64` | same | [floats only go out](design.md#parity-decisions): for display or interop only, never round-trip, never called inside ducat. ducat's algorithm step for step (a 65- or 66-bit quotient with a sticky bit, rounded once, scaled by powers of two), so the bits match, subnormals included |
| `ExactMoney#toString` | `Display` | same | |
| `ExactTaxBreakdown` | `ducat::exact::ExactTaxBreakdown` | same | |
| `Money#addTaxExact` | `ExactMoney::add_tax` (via `Money::exact`) | same | |
| `Money#exact` | `Money::exact`, `AnyMoney::exact` | same | |
| `Money#extractTaxExact` | `ExactMoney::extract_tax` | same | |
| `Money#multiplyExact` | `Money::multiply_exact`, `AnyMoney::multiply_exact` | same | as `ExactMoney#toMoney` at the amount's scale: the factor's error, then `Err(Rounding)` for a product with no finite decimal form, then `Err(InvalidScale)` (not `Rounding`) for one needing more than `MAX_SCALE` places, ducat's `RangeError` |
| `Rounded` | `ducat::exact::Rounded` | same | `value`, `residual` |
| `addTaxExact` | `ExactMoney::add_tax` | same | |
| `exact` | `Money::exact` | same | |
| `extractTaxExact` | `ExactMoney::extract_tax` | same | |
| `isExactMoney` | — | not ported: by design (the type system) | |
| `multiplyExact` | `Money::multiply_exact`, `AnyMoney::multiply_exact` | same | as `Money#multiplyExact` |
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
| `FormatOptions` | `ducat_format::FormatOptions` | same | `Default` is ducat's no-options call; the fields ducat passes to `Intl` are checked as `Intl` checks them (`Error::InvalidOptions` for its `RangeError`s) |
| `FormatOptions#compactDisplay` | — | missing | Intl's `compactDisplay`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#currency` | — | not ported: by design ([money is always formatted as its own currency](design.md#parity-decisions)) | ducat sets it from the money; overriding it formats another code |
| `FormatOptions#currencyDisplay` | `FormatOptions::currency_display`, `display` (`CurrencyDisplay`) | same | `CurrencyDisplay`: `Symbol` (default), `NarrowSymbol`, `Code`, `Name` |
| `FormatOptions#currencySign` | `FormatOptions::currency_sign`, `sign` (`CurrencySign`) | same | `CurrencySign`: `Standard` (default), `Accounting` |
| `FormatOptions#digits` | `FormatOptions::digits` | same | `Option<u16>`, rounded once by ducat's kernel; beside `Intl`'s digit options it is `Error::ConflictingOptions`, ducat's `TypeError` |
| `FormatOptions#localeMatcher` | — | missing | Intl's `localeMatcher`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#maximumFractionDigits` | `FormatOptions::maximum_fraction_digits` | same | `Option<u16>`; past 100, or below the minimum, `Error::InvalidOptions` (`Intl`'s `RangeError`), except with significant digits and `roundingPriority` auto, where `Intl` neither uses nor validates the fraction digits, so they aren't checked then (as `Intl`) |
| `FormatOptions#maximumSignificantDigits` | `FormatOptions::maximum_significant_digits` | same | `Option<u16>`, 1 to 21 (`Error::InvalidOptions` outside) |
| `FormatOptions#minimumFractionDigits` | `FormatOptions::minimum_fraction_digits` | same | `Option<u16>`, as `#maximumFractionDigits`, including the exception: with significant digits and `roundingPriority` auto they aren't checked (as `Intl`, which neither uses nor validates them) |
| `FormatOptions#minimumIntegerDigits` | `FormatOptions::minimum_integer_digits` | same | `Option<u16>`, 1 to 21 (`Error::InvalidOptions` outside, `Intl`'s `RangeError`); the padding zeros are grouped as digits are (`$00,001.00`) |
| `FormatOptions#minimumSignificantDigits` | `FormatOptions::minimum_significant_digits` | same | `Option<u16>`, 1 to 21 and at most the maximum (`Error::InvalidOptions` otherwise); the maximum defaults to 21. With significant digits and `roundingPriority` auto the fraction digits play no part, unchecked, as in `Intl`; beside `digits` it is `Error::ConflictingOptions`, ducat's `TypeError` |
| `FormatOptions#notation` | — | missing | Intl's `notation`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#numberingSystem` | — | missing | Intl's `numberingSystem`, passed through by ducat; no counterpart in `ducat_format::FormatOptions` |
| `FormatOptions#rounding` | `FormatOptions::rounding` | same | `Option<Rounding>`, `None` is ducat's default halfExpand; without `digits` it is `Error::ConflictingOptions`, ducat's `TypeError` |
| `FormatOptions#roundingIncrement` | `FormatOptions::rounding_increment` | same | `Option<u16>`, one of `Intl`'s 15 increments (`Error::InvalidOptions` otherwise) |
| `FormatOptions#roundingMode` | `FormatOptions::rounding_mode` | same | `Option<Rounding>`, `None` is `Intl`'s halfExpand: how `Intl`'s fraction digits, significant digits and increment round, on the exact decimal with ducat's kernel (no floats). `Rounding::Unnecessary` is no `Intl` mode (`Error::InvalidOptions`, its `RangeError`); after `digits` there is nothing left to round |
| `FormatOptions#roundingPriority` | `FormatOptions::rounding_priority` (`RoundingPriority`) | same | `Auto` (default), `MorePrecision`, `LessPrecision`, comparing ECMA-402's rounding magnitudes (significant digits default to 1 to 21, so `MorePrecision` shows 1.20 as `1.2`); a `roundingIncrement` other than 1 beside it or beside significant digits is `Error::IncrementNeedsFractionDigits` (`Intl`'s `TypeError`) |
| `FormatOptions#signDisplay` | `FormatOptions::sign_display` (`SignDisplay`) | same | `Auto` (default), `Never`, `Always`, `ExceptZero`, `Negative`; a negative amount `Intl` rounds to zero keeps its minus sign with `Auto` and `Always`, as in `Intl`. The plus form is the negative subpattern with the plus sign for the minus, or the plus sign before the positive one where the negative has none (accounting's parentheses), as ICU writes it |
| `FormatOptions#style` | — | not ported: by design ([money is always formatted as its own currency](design.md#parity-decisions)) | ducat sets `currency`; another style drops the currency |
| `FormatOptions#trailingZeroDisplay` | `FormatOptions::trailing_zero_display` (`TrailingZeroDisplay`) | same | `Auto` (default), `StripIfInteger` (`€5` for 5.00, after rounding); a name takes the plural of the number shown (`1 US dollar`) |
| `FormatOptions#unit` | — | not ported: by design ([money is always formatted as its own currency](design.md#parity-decisions); only with `style: 'unit'`) |  |
| `FormatOptions#unitDisplay` | — | not ported: by design ([money is always formatted as its own currency](design.md#parity-decisions); only with `style: 'unit'`) |  |
| `FormatOptions#useGrouping` | `FormatOptions::use_grouping` (`UseGrouping`) | same | `Auto` (default; CLDR's minimum grouping digits), `Always` (`true`), `Min2` (at least two, or the locale's), `Off` (`false`); `From<bool>`, and `FromStr` for `Intl`'s strings (`"true"` and `"false"` are `Auto`, as in `Intl`). The option enums' `FromStr` take `Intl`'s names, `Error::InvalidOptions` for others |
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
| `Fixed#toNumber` | `Fixed::to_f64` | same | as `.` `Money#toNumber` |
| `Fixed#toRatio` | `Fixed::to_ratio` | same | |
| `Fixed#toScale` | `Fixed::to_scale` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) | the mode is required |
| `Fixed#toScaled` | `Fixed::units`, `Fixed::scale` | same | |
| `Fixed#toString` | `Display` | same | |
| `Fixed#trimScale` | `Fixed::trim_scale` | same | a `Result`: `Err(InvalidScale)` for a minimum past `MAX_SCALE`, ducat's `RangeError` (`Invalid scale`), checked before the value; the minimum is an `Option<u16>` (`None` is 0, ducat's default), as `Money::trim_scale` |
| `Fixed#value` | `Fixed::units` | same | |
| `FixedInput` | `Fixed::new`, `FromStr`, `parse_at`, `from_f64`, `from_f64_at`, `From<Int>` | same | |
| `FixedOptions` | arguments of `Fixed::parse_at` | same | |
| `FixedOptions#rounding` | the `Rounding` argument of `Fixed::parse_at`, `Fixed::from_f64_at`, `Fixed::to_scale` | same | where ducat applies it: a string (`parse_at`), a number (`from_f64_at`: the shortest round-trip form, without the 15-digit rule, as ducat once a rounding is given) and a `Fixed` (`to_scale`); `Rounding::Unnecessary` is ducat's default (`Err(Rounding)` where it throws `RoundingError`). ducat's `RangeError` for a rounding without a scale can't arise: each takes both. `from_f64_at` checks the scale before the value, as ducat (`Err(InvalidScale)`, then `Err(NotFinite)`) |
| `FixedOptions#scale` | the `scale` argument of `parse_at` | same | |
| `ScaledInteger` | `Fixed::units`, `Fixed::scale` | same | no named type |
| `fixed` | `FromStr`, `Fixed::parse_at`, `Fixed::from_f64`, `Fixed::from_f64_at` | same | |
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
| `ParseMoneyOptions` | `ducat_format::ParseMoneyOptions` | same | `Default` is ducat's no-options call |
| `ParseMoneyOptions#currencies` | `ParseMoneyOptions::currencies` | same | `Option<&[CurrencyCode]>`; `None` is every ISO 4217 currency with a minor unit, ducat's default |
| `ParseMoneyOptions#hint` | `ParseMoneyOptions::hint` | same | `Option<CurrencyCode>`; a text naming another currency is `Syntax(NotTheHint)`, ducat's `SyntaxError` |
| `ParseMoneyOptions#lenient` | `ParseMoneyOptions::lenient` | same | `false` by default, as ducat |
| `ParseMoneyOptions#rounding` | `ParseMoneyOptions::rounding` | same | `Option<Rounding>`; `None` makes extra decimals `Error::Money(Rounding)`, ducat's `RoundingError` |
| `ParseMoneyOptions#scale` | `ParseMoneyOptions::scale` | same | `Option<u16>`; past `MAX_SCALE` `Error::Money(InvalidScale)` |
| `ParseMoneyOptions#symbols` | `ParseMoneyOptions::symbols` | same | a slice of `(symbol, CurrencyCode)`, ducat's record |
| `ParseOptions` | `ducat_format::ParseOptions` | same | `Default` is ducat's no-options call |
| `ParseOptions#lenient` | `ParseOptions::lenient` | same | `false` by default, as ducat |
| `ParseOptions#rounding` | `ParseOptions::rounding` | same | as `ParseMoneyOptions#rounding` |
| `ParseOptions#scale` | `ParseOptions::scale` | same | as `ParseMoneyOptions#scale` |
| `parse` | `ducat_format::parse` | divergent: [refuses a locale the build lacks](design.md#coverage) | `Locale::has_data` |
| `parseMoney` | `ducat_format::parse_money` | divergent: [refuses a locale the build lacks](design.md#coverage) |  |

### `./stripe`

[`ducat::processors::stripe`](../crates/ducat/src/processors/stripe.rs) (feature `stripe`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `Money#toStripe` | `Money::to_stripe`, `AnyMoney::to_stripe` | same |  |
| `Money#toStripeAmount` | `Money::to_stripe_amount` | same |  |
| `STRIPE_RULES` | `ducat::processors::stripe::rules` (`StripeEntry`), `rule` | same | a sorted `&'static [StripeEntry]` (`code`, `exponent`, `charge_multiple`, `payout_multiple`; `#[non_exhaustive]`, `StripeEntry::rule` its `StripeRule`): ducat's record of `[exponent, chargeMultiple, payoutMultiple]` as rows, with the same codes and values |
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
| `ADYEN_EXPONENTS` | `ducat::processors::adyen::exponents` (`ExponentEntry`), `exponent`, `rule` | same | a sorted `&'static [ExponentEntry]` (`code`, `exponent`; `#[non_exhaustive]`, `ducat::processors::ExponentEntry`): ducat's record as rows, with the same codes and exponents |
| `Money#toAdyen` | `Money::to_adyen`, `AnyMoney::to_adyen` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |
| `adyenExponent` | `ducat::processors::adyen::exponent` | same |  |
| `fromAdyen` | `Money::from_adyen`, `AnyMoney::from_adyen` | divergent: [integer amounts are `i64`, read back whatever their size](design.md#milestone-5c-payment-processors) |  |
| `isAdyenCurrency` | `ducat::processors::adyen::is_currency` | same |  |
| `toAdyen` | `Money::to_adyen` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |

### `./checkout`

[`ducat::processors::checkout`](../crates/ducat/src/processors/checkout.rs) (feature `checkout`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `CHECKOUT_RULES` | `ducat::processors::checkout::rules` (`CheckoutEntry`), `rule` (`CheckoutRule`) | same | a sorted `&'static [CheckoutEntry]` (`code`, `exponent`, `multiple`, `standalone_multiple`; `#[non_exhaustive]`, `CheckoutEntry::rule` its `CheckoutRule`): ducat's record of `[exponent, multiple, standaloneMultiple]` as rows, with the same codes and values |
| `CheckoutAmountOptions` | `ducat::processors::checkout::CheckoutOptions` | same |  |
| `CheckoutAmountOptions#rounding` | `CheckoutOptions::rounding` | same |  |
| `CheckoutAmountOptions#standalone` | `CheckoutOptions::standalone` | same |  |
| `Money#toCheckout` | `Money::to_checkout`, `AnyMoney::to_checkout` | same | `currency` in uppercase, as ducat: a custom currency defined in lowercase (`CurrencyCode::custom("usd", 2)`, ducat's `defineCurrency('usd', 2)`) is sent as `USD`. The failures are `toCheckoutAmount`'s, in its order |
| `Money#toCheckoutAmount` | `Money::to_checkout_amount` | same |  |
| `checkoutExponent` | `ducat::processors::checkout::exponent` | same |  |
| `fromCheckout` | `Money::from_checkout`, `AnyMoney::from_checkout` | divergent: [integer amounts are `i64`, read back whatever their size](design.md#milestone-5c-payment-processors) |  |
| `isCheckoutCurrency` | `ducat::processors::checkout::is_currency` | same |  |
| `toCheckout` | `Money::to_checkout`, `AnyMoney::to_checkout` | same | as `Money#toCheckout` |
| `toCheckoutAmount` | `Money::to_checkout_amount`, `AnyMoney::to_checkout_amount` | same | an `i64`; the same failures in ducat's order: `UnsupportedCurrency` (TS `RangeError`), `Rounding` (`RoundingError`), `AmountTooLarge` beyond 2^53 − 1, `NegativeAmount` (`RangeError`). The `i64` divergence is the read-back path (`fromCheckout`) only |

### `./paypal`

[`ducat::processors::paypal`](../crates/ducat/src/processors/paypal.rs) (feature `paypal`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `Money#toPayPal` | `Money::to_paypal`, `AnyMoney::to_paypal` | same | `currency_code` in uppercase, as ducat: a custom currency defined in lowercase (`usd`) is sent as `USD`. The failures are `toPayPalValue`'s, in its order |
| `Money#toPayPalValue` | `Money::to_paypal_value` | same |  |
| `PAYPAL_EXPONENTS` | `ducat::processors::paypal::exponents` (`ExponentEntry`), `exponent`, `rule` | same | a sorted `&'static [ExponentEntry]` (`code`, `exponent`; `#[non_exhaustive]`, `ducat::processors::ExponentEntry`): ducat's record as rows, with the same codes and exponents |
| `PayPalAmountOptions` | the `Rounding` argument | same |  |
| `PayPalAmountOptions#rounding` | the `Rounding` argument of `to_paypal` | divergent: [no default rounding](design.md#decisions-made-while-building-milestone-1) |  |
| `fromPayPal` | `Money::from_paypal`, `AnyMoney::from_paypal` | same |  |
| `isPayPalCurrency` | `ducat::processors::paypal::is_currency` | same |  |
| `paypalExponent` | `ducat::processors::paypal::exponent` | same |  |
| `toPayPal` | `Money::to_paypal`, `AnyMoney::to_paypal` | same | as `Money#toPayPal` |
| `toPayPalValue` | `Money::to_paypal_value` | same |  |

### `./braintree`

[`ducat::processors::braintree`](../crates/ducat/src/processors/braintree.rs) (feature `braintree`); conversions are methods on `Money` and `AnyMoney`.

| TS | Rust | status | note |
|---|---|---|---|
| `BRAINTREE_EXPONENTS` | `ducat::processors::braintree::exponents` (`ExponentEntry`), `exponent`, `rule` | same | a sorted `&'static [ExponentEntry]` (`code`, `exponent`; `#[non_exhaustive]`, `ducat::processors::ExponentEntry`): ducat's record as rows, with the same codes and exponents |
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
| `KLARNA_EXPONENTS` | `ducat::processors::klarna::exponents` (`ExponentEntry`), `exponent`, `rule` | same | a sorted `&'static [ExponentEntry]` (`code`, `exponent`; `#[non_exhaustive]`, `ducat::processors::ExponentEntry`): ducat's record as rows, with the same codes and exponents |
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
| `ScaleColumnOption` | [`ducat_sqlx::ScaledMinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::ScaledMinorColumn`](../crates/ducat-diesel/src/money.rs); `scaled_minor_units` | same | also the `{ scale }` option of the Drizzle entries' `moneyMinor` and Kysely's `setMoney`/`selectMoney` (ducat#380): a `ScaledMinorColumn<C>` (fixed currency) or `scaled_minor_units` (any money) writes the units at the value's own scale and that scale (`to_columns`: an `i64` and an `i16`), with only `Err(OutOfRange)` beyond the BIGINT range |
| `ScaleColumnOption#scale` | the scale column bound and selected beside the units | same | no column names in Rust: the application binds `to_columns`' scale into its own column and selects it beside the units (`from_columns`); ducat's `readScale` as `Err(InvalidScaleColumn)` for a NULL, negative or past-`MAX_SCALE` scale, checked before the units |
| `decimalMoneyField` | — | not ported: by design (adapter for a TypeScript ORM) | `Decimal::to_money_at_exponent`, or `DecimalColumn<C>` for a fixed currency |
| `fromDecimal` | — | not ported: by design (adapter for a TypeScript ORM) | `Decimal::to_money_at_exponent` (or `"…".parse::<Money<C>>()`) |
| `minorMoneyField` | — | not ported: by design (adapter for a TypeScript ORM) | `MinorColumn<C>`, or `AnyMoney::from_minor` with the currency column |
| `toDecimalValue` | — | not ported: by design (adapter for a TypeScript ORM) | `Decimal::from_money` |
| `toMinorColumns` | — | not ported: by design (adapter for a TypeScript ORM) | `minor_units` plus `currency()`; with a scale column, `Decimal::from_money`'s `units` and `scale` |

### `./drizzle/pg`

The column shapes (not Drizzle, a TypeScript ORM) are in `ducat-sqlx` and `ducat-diesel` (feature `postgres`, the default): `DecimalColumn<C>`, `MinorColumn<C>`, `Decimal`, `DecimalColumnSize` at each crate's root, shared through the internal `ducat-sql-core`. The JSON shape is `JsonColumn<M>` (`moneyJson`).

| TS | Rust | status | note |
|---|---|---|---|
| `DEFAULT_DECIMAL_SIZE` | [`ducat_sqlx::DEFAULT_DECIMAL_SIZE`](../crates/ducat-sqlx/src/decimal.rs), [`ducat_diesel::DEFAULT_DECIMAL_SIZE`](../crates/ducat-diesel/src/decimal.rs) | same | NUMERIC(19,4) |
| `DecimalColumnSize` | [`ducat_sqlx::DecimalColumnSize`](../crates/ducat-sqlx/src/decimal.rs), [`ducat_diesel::DecimalColumnSize`](../crates/ducat-diesel/src/decimal.rs) | same | a validated struct (`new(precision, scale)`: precision at least 1, scale at most precision, else `Error::InvalidColumnSize`) with `precision()`/`scale()`, `check_currency` and `fit` |
| `moneyDecimal` | [`ducat_sqlx::DecimalColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::DecimalColumn`](../crates/ducat-diesel/src/money.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | `DecimalColumn<C>` has no size: check it with `DecimalColumnSize::check_currency`, and bind `fit`'s `Decimal` after `to_decimal`'s scale check |
| `moneyJson` | [`ducat_sqlx::JsonColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::JsonColumn`](../crates/ducat-diesel/src/money.rs) | same | jsonb (bound as jsonb, as ducat's column) or json; `JsonColumn<AnyMoney>` is `moneyJson()`, `JsonColumn<Money<C>>` `moneyJson('EUR')`. Written exactly as `JSON.stringify` (`{"amount":"12.34","currency":"EUR"}`, at the exponent, else `Err(ScaleMismatch)`); read as `jsonFromDriver`: `Err(Malformed)` for text that isn't JSON (`SyntaxError`), `Err(NotMoneyJson)` unless `amount` and `currency` are strings (`TypeError`; other members ignored, the last duplicate wins), then `Err(UnknownCurrency)`, the amount's `Err(Ducat(Syntax | Rounding))` at the exponent, then `Err(CurrencyMismatch)`, in ducat's order. A json or jsonb value that is a JSON string is parsed again: ducat's `jsonFromDriver` parses a string value too ([`src/drizzle/mysql.ts:96`](../../src/drizzle/mysql.ts), "mysql2 parses JSON columns itself; other drivers may return the text"), and node-postgres hands it such a value as the string. Pinned by `spec/vectors/wire/money-json.json` |
| `moneyMinor` | [`ducat_sqlx::MinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::MinorColumn`](../crates/ducat-diesel/src/money.rs); [`ducat_sqlx::ScaledMinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::ScaledMinorColumn`](../crates/ducat-diesel/src/money.rs) with a scale column | same | BIGINT; `ScaleMismatch`, `OutOfRange` beyond the i64 range; the `{ scale }` option (ducat#380) is `ScaledMinorColumn<C>`, units at each value's own scale beside a scale column |
| `scaledMoney` | `ScaledMinorColumn::from_columns`, `from_nullable_columns` ([`ducat_sqlx::ScaledMinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::ScaledMinorColumn`](../crates/ducat-diesel/src/money.rs)) | same | reads the units with their scale column (ducat#380): `from_columns(units, scale)` keeps the stored scale (above, at or below the exponent), `from_nullable_columns` gives `None` for a NULL amount whatever the scale, and a NULL, negative or past-`MAX_SCALE` scale is `Err(InvalidScaleColumn)` (ducat's `RangeError`). diesel loads it straight from `(BigInt, S)` or `(BigInt, Nullable<S>)` selected together (`S` a `SmallInt`, `Integer` or `BigInt`); sqlx reads the two columns and calls `from_columns`. Nothing stops `MinorColumn<C>` reading the units alone at the exponent, where ducat throws for such a column read by itself |

### `./drizzle/mysql`

The MySQL column shapes are `ducat-sqlx`'s and `ducat-diesel`'s root types with the `mysql` feature (impls in each crate's `mysql` module). `DEFAULT_DECIMAL_SIZE` and `DecimalColumnSize` are homed in `./drizzle/pg`.

| TS | Rust | status | note |
|---|---|---|---|
| `moneyDecimal` | [`ducat_sqlx::DecimalColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::DecimalColumn`](../crates/ducat-diesel/src/money.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | DECIMAL; size via `DecimalColumnSize::check_currency`/`fit`, not the column; FLOAT/DOUBLE is `Error::UnexpectedType`; text read as `-?[0-9]+(\.[0-9]+)?` |
| `moneyJson` | [`ducat_sqlx::JsonColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::JsonColumn`](../crates/ducat-diesel/src/money.rs) | same | JSON (diesel's `Json`), or a string column with sqlx; as `./drizzle/pg`, a JSON column's JSON string parsed again as mysql2 does, a string column's text once |
| `moneyMinor` | [`ducat_sqlx::MinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::MinorColumn`](../crates/ducat-diesel/src/money.rs); [`ducat_sqlx::ScaledMinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::ScaledMinorColumn`](../crates/ducat-diesel/src/money.rs) with a scale column | same | BIGINT; signed integer types only (`UnexpectedType`); the `{ scale }` option is `ScaledMinorColumn<C>`, as `./drizzle/pg` |
| `scaledMoney` | `ScaledMinorColumn::from_columns`, `from_nullable_columns` | same | as `./drizzle/pg` |

### `./drizzle/sqlite`

The SQLite column shapes are `ducat-sqlx`'s and `ducat-diesel`'s root types with the `sqlite` feature (impls in each crate's `sqlite` module; SQLite bundled).

| TS | Rust | status | note |
|---|---|---|---|
| `moneyDecimal` | [`ducat_sqlx::DecimalColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::DecimalColumn`](../crates/ducat-diesel/src/money.rs) | divergent: [column and test-strategy shapes](design.md#parity-decisions) | TEXT read as `-?[0-9]+(\.[0-9]+)?` only (ducat's `money()` also takes `+` and exponents); a REAL value is `Error::UnexpectedType` |
| `moneyJson` | [`ducat_sqlx::JsonColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::JsonColumn`](../crates/ducat-diesel/src/money.rs) | same | TEXT, its storage class checked per value (`UnexpectedType`) and its text parsed once, as ducat's `fromJSON` of the string; otherwise as `./drizzle/pg` |
| `moneyMinor` | [`ducat_sqlx::MinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::MinorColumn`](../crates/ducat-diesel/src/money.rs); [`ducat_sqlx::ScaledMinorColumn`](../crates/ducat-sqlx/src/money.rs), [`ducat_diesel::ScaledMinorColumn`](../crates/ducat-diesel/src/money.rs) with a scale column | same | INTEGER; storage class checked per value; the `{ scale }` option is `ScaledMinorColumn<C>`, as `./drizzle/pg` |
| `scaledMoney` | `ScaledMinorColumn::from_columns`, `from_nullable_columns` | same | as `./drizzle/pg`; SQLite INTEGER for both columns |

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
| `jsonTransformer` | — | not ported: by design (adapter for a TypeScript ORM) | `JsonColumn<M>` (`moneyJson`): `JsonColumn<AnyMoney>` is `jsonTransformer()`, `JsonColumn<Money<C>>` `jsonTransformer('EUR')`; `Err(ScaleMismatch)` on write, `Err(CurrencyMismatch)` on read |
| `minorTransformer` | — | not ported: by design (adapter for a TypeScript ORM) | `MinorColumn<C>` |

### `./all`

Re-exports every plugin entry and `./fn`'s functions, and installs every plugin's methods on `Money`; its rows are in those entries. Rust has no prototype to install on: every method is there once its feature is on ([mapping](design.md#mapping-ducats-entries)).

## Missing, in proposed order
Every `missing` row, grouped into pull requests in the order users would hit them. Three pieces are decided (marked
**decided**); the rest are proposals.

12. **Rate snapshots** (**decided**: synchronous in `ducat` through a loader closure or trait; asynchronous in
   `ducat-fetch` on `Transport`): `./convert` `snapshots`, `./convert` `snapshotsFrom`, `./convert` `Snapshots`,
   `./convert` `Snapshots#at`, `./convert` `SnapshotOptions`, `./convert` `SnapshotOptions#lookback`,
   `./convert` `SnapshotOptions#max`. Converting at historical dates without loading every table up front.
13. **CLDR currency names as `ducat-words` defaults** (**decided**: feature `cldr-names`, reusing `ducat-format`'s
   generated names without all its data): no `missing` row; `./words` `amountInWords` is `divergent` until then,
   because the caller must pass `UnitNames`.
14. **Adyen's IANA time zone** (**decided**: an optional `tz` feature on `ducat`, with jiff and a bundled tzdb, off by
   default, not `no_std`): `./adyen-fx` `AdyenRateOptions`, `./adyen-fx` `AdyenRateOptions#timeZone`. Only reports
   whose TimeZone column switches with daylight saving need it; abbreviations and offsets already work.
15. **Compact notation and numbering systems** (`ducat-format`, new CLDR data): `./format` `FormatOptions#notation`,
   `./format` `FormatOptions#compactDisplay`, `./format` `FormatOptions#numberingSystem`,
   `./format` `FormatOptions#localeMatcher`. Dashboards (`€1.2M`) and native digits; compact patterns and numbering systems add
   data to every locale, so they want their own features. `localeMatcher` chooses between `Intl`'s algorithms; the
   port has one (TR35 fallback), so it may end up `not ported: by design`.

### Follow-ups, not parity

- Fuzzing every boundary (milestone 8).
- `sqlite-unbundled` for `ducat-sqlx` and `ducat-diesel` (a system SQLite instead of building it).
- diesel 2.3 and later in the lockfile (needs Rust 1.86 and 1.88; the requirement already admits them).
