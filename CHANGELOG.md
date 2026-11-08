# Changelog

All notable changes to `@ducatjs/money` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, a minor version may
contain breaking changes; they are always listed under **Changed** or **Removed**.

## [Unreleased]

### Added

- **Rounding policies:** `roundingPolicy({ scale, increment, rounding, currency })`, `isoPolicy`
  and `cashPolicy(currency, options)` (in `/cash`) are reusable values accepted wherever a
  rounding mode is (`multiply`, `divide`, `round`, `percentage`, `discount`, `addTax`,
  `extractTax`). The result is rounded once, straight to the policy's scale and increment. A
  policy is also a function that rounds an amount. `assertScale(money, policy)` checks that an
  amount is already rounded to a policy.
- `isMoneyIn(value, currency)` and `assertCurrency(money, currency)` narrow a `Money<string>`
  (a currency known only at run time) to a literal `Money<'EUR'>` without a cast;
  `assertCurrency` throws `CurrencyMismatchError` for another currency.
- `majorPart` and `minorPart` split an amount at the decimal point (`12` and `34` for 12.34 EUR),
  truncating toward zero and keeping the sign.
- `identical(a, b)`: equal value, currency _and_ scale, for round-trip tests (`equals` treats
  1.0 EUR and 1.00 EUR as equal).
- `m.with(operation)` applies a function such as a rounding step or a conversion as one link of a
  method chain.

## [0.1.0] - 2026-11-07

The first release: an exact, fast, typed `Money` type for TypeScript, with zero runtime
dependencies, for Node 24 and later, Bun, Deno and browsers. It is published as ESM only.

### Added

- **`Money<C>`** holds an integer count of minor units. The count is a JS number while it is a
  safe integer and a bigint beyond that, so ordinary amounts never allocate and huge amounts
  never lose a digit. The currency is a type parameter: mixing currencies is a compile-time
  error, and a `CurrencyMismatchError` at run time when the types are erased.
  See [Design](README.md#design).
- **Arithmetic and comparison:** `add`, `subtract`, `sum`, `multiply`, `divide`, `percentage`,
  `discount`, `negate`, `abs`, `compare`, `equals`, `min`, `max`, `clamp` and more, as methods
  on `Money`. The same operations are plain functions of the same name in `@ducatjs/money/fn`
  (and `/all`); the root entry exports only the constructors and list functions (`money`,
  `fromMinor`, `zero`, `fromJSON`, `sum`, `isMoney`, `ratio`).
- **Nine rounding modes**, named as in `Intl.NumberFormat` (`halfEven`, `halfExpand`, `trunc`,
  ...), plus `unnecessary`, which throws instead of rounding. Parsing never rounds by default.
- **Allocation that always sums to the whole:** `allocate` with five remainder strategies,
  `split`, `instalments`, `schedule` (fixed, percentage, capped and rest tranches) and `chunk`.
- **Tax:** `addTax` and `extractTax`, where net plus tax is always exactly gross.
- **Cash rounding** for cash tenders, from a table of national rules (`cashRound`,
  `roundToIncrement`, `cashRule`).
- **Formatting and parsing** with `Intl`: `format`, `formatToParts` and a locale-aware `parse`
  that handles local separators, non-Latin digits and accounting negatives.
- **Small core, opt-in modules.** The core covers construction, arithmetic, rounding,
  comparison and serialisation. Everything else is a subpath import that adds its methods when
  imported (`/allocate`, `/tax`, `/convert`, `/cash`, `/format`, `/parse`), or use `/all` for
  everything and `/fn` for plain functions only, with no prototype changes. See [Modules](README.md#modules).
- **Exchange rates:** an exact `Rate` type with composition and round-once conversion, rate
  providers (tables, chains, reversed and cross rates, dated snapshots), `ExactMoney` for
  carrying conversion residuals, `MoneyBag` totals across currencies, ECB reference rate
  parsers (`/convert/ecb`) and an opt-in ECB fetcher (`/convert/fetch`).
- **Fixed-point decimals:** `@ducatjs/money/fixed` adds `Fixed`, an exact decimal without a
  currency (unit prices, quantities, intermediate results), with the same strict input and
  rounding rules as `Money`. `Money#toFixedPoint()` and `moneyToFixed` convert between them.
  See [Fixed-point decimals](README.md#fixed-point-decimals).
- **Payment processor views:** the amount each processor expects, with its own minor-unit
  exceptions, for Stripe, Adyen, Checkout.com, PayPal, Braintree and Klarna (`/stripe`,
  `/adyen`, `/checkout`, `/paypal`, `/braintree`, `/klarna`), plus Stripe and Adyen exchange
  rates (`/stripe-fx`, `/adyen-fx`).
  See [Payment processors](README.md#payment-processors-the-amount-you-send).
- **Database helpers** for Prisma (`/prisma`) and guidance for NUMERIC and BIGINT columns.
  See [Databases](README.md#databases).
- **Currency data** generated from the ISO 4217 list, with `defineCurrency` for codes that are
  not in it. See [Currency data](README.md#currency-data-source-generation-verification).
- **A comparison with other money libraries**, covering correctness, speed and bundle size:
  [docs/COMPARISON.md](docs/COMPARISON.md).

[Unreleased]: https://github.com/public/ducat/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/public/ducat/releases/tag/v0.1.0
