# Changelog

All notable changes to `@ducatjs/money` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, a minor version may
contain breaking changes; they are always listed under **Changed** or **Removed**.

## [Unreleased]

### Added

- `toScaledUnits()` (method and `/fn`): the amount in units of the value's own scale, as a bigint.
- `@ducatjs/money/words`: amounts in words (`amountInWords`, cheque-style "and 45/100" by default,
  or with the minor unit's names) and whole numbers in words (`spellOut`, any of a language's rule
  sets: cardinals by gender, ordinals and the others CLDR has). An interpreter for
  CLDR's rule-based number formats, checked against ICU 4C 79.1 on 2808 vectors (and ICU 4C 74.2's engine on CLDR 49's rule text, 4096 more for the other rule sets), loads no Money. It refuses (`RangeError`) where it can't give ICU's words: outside ±(2^63 − 1), private rule sets, and English ordinals whose suffix ICU takes from a 32-bit cast.
  The languages are their own entries, from CLDR 49 with a `--check`: `/words/en`, `/de`, `/fr`,
  `/es`, `/it`, `/pt` and `/nl`. Currency names and "and" come from `Intl`.
- `@ducatjs/money/wire`: wire formats, exact both ways and strict on input. `google.type.Money`
  (`toGoogleMoney`, `fromGoogleMoney`: int64 units, nanos with the same sign); ISO 20022 amounts
  (`toIso20022Amount`, `fromIso20022Amount`: at most 5 decimals and 18 digits, non-negative,
  written with the currency's decimals); and
  `{ value, currency }` in ISO 4217 minor units (`toMinorUnits`, `fromMinorUnits`).
- `@ducatjs/money/crypto`: BTC (8 decimals), ETH (18), SOL (9) and common Ethereum tokens (USDC,
  USDT, DAI, WBTC, EURC, PYUSD) as an opt-in table, each unit's decimals read from its defining
  source with a `--check` (`scripts/fetch-crypto-units.mjs`, snapshot `data/crypto-units.json`).
  `defineCryptoCurrencies` registers them; `toBaseUnits` and `fromBaseUnits` convert to and from
  satoshi, wei and lamport exactly, with strict parsing.
- `@ducatjs/money/currencies`: ISO 4217 numeric codes both ways (`numericCode('EUR')` is '978',
  `currencyFromNumeric(8)` is 'ALL'), generated from ISO 4217 List One; `minorUnit`, the size of
  the minor unit; and `currencyName` and `currencySymbol` per locale, from the runtime's `Intl`.
  `cashUnit` in `@ducatjs/money/cash` gives the smallest cash step (the smallest coin), from the
  cash rules.
- `@ducatjs/money/territories`: `territoryCurrencies` and `currencyTerritories`, which
  currencies a territory uses or used and since when, from CLDR release 49 (a snapshot in
  `data/cldr-territories.json`, regenerated and checked like the ISO table).
- `@ducatjs/money/fixed/money`: Fixed and Money together. It has everything in
  `@ducatjs/money/fixed`, plus `moneyToFixed` and `fixedToMoney`, and installs
  `Money#toFixedPoint()` and `Fixed#toMoney()`.
- `@ducatjs/money/finance`: day counts (`yearFraction` under ACT/360, ACT/365F, ACT/ACT ISDA,
  30/360, 30E/360 and 30E/360 ISDA), simple and compound interest (`interest`, `interestExact`,
  `compound`), loan schedules (`amortise`: annuity, linear and interest-only, with a balloon,
  payment dates and the rounding residual on the last payment or the last interest), Excel's
  `npv` (and `npvExact`) and `irr` (exact bisection to a stated number of digits, checked against
  Microsoft's examples and LibreOffice Calc), the period-0 form as `discountedSum` and
  `discountedSumExact`, and subscription proration (`prorate` by the day or the second, `splitPeriod`). Exact
  arithmetic throughout, rounded once per paid amount with a mode or a policy; dates are
  `'YYYY-MM-DD'` or `{ year, month, day }`, so `Temporal.PlainDate` works.
- The ECB parsers (`parseEcbXml`, `parseEcbCsv`, `parseEcbSdmxCsv`) and fetchers (`fetchEcb`,
  `fetchEcbRange`) take an opt-in `availableAt`: `true` for the ECB's documented publication time,
  16:00 CET (Frankfurt time, summer time included), or a function of the day for the caller's
  own, so historical lookups can't use a rate before it was published. Without it nothing
  changes.
- `@ducatjs/money/pricing`: `priceEnding`, retail price endings ("charm pricing"). A rule allows
  the prices `ending + k × step` (.99, .95, 9.90 in steps of 10, the nearest 5) and moves an amount
  to one of them by a rounding mode (up by default, down, or to the nearest), exactly.
- `@ducatjs/money/math`: `average` (the exact sum divided by the count, rounded once), `ratioOf`
  (the exact share of one amount in another, as a `Ratio`), `divideToIntegral` and `remainder`
  (truncating division between amounts, with `m = divisor × count + remainder` exactly) and
  `trimScale` (the smallest exact scale, not below the currency's exponent unless asked).
- `@ducatjs/money/pricing`: `tieredPrice` prices a quantity under graduated or volume tiers in
  the style of Stripe's (inclusive `upTo`, per-unit and flat amounts, sub-cent unit prices and
  decimal quantities), exactly, with the total rounded once and a breakdown per tier whose
  amounts sum to the total.

### Changed

- **Breaking:** `@ducatjs/money/fixed` no longer loads Money or the currency table, so a program
  that uses only `Fixed` is 3.3 kB gzipped instead of 5.4 kB. `Money#toFixedPoint()`,
  `Fixed#toMoney()` and `moneyToFixed` moved to the new `@ducatjs/money/fixed/money`: import that
  entry instead where you convert between the two. `/all` and `/fn` include it.
- **Visible change:** arithmetic and comparison with an operand that isn't Money (`m.add(5)` from
  untyped code) throw a `TypeError` ("Expected Money, got number") instead of a
  `CurrencyMismatchError`. Two Money values in different currencies still throw
  `CurrencyMismatchError`.
- **Breaking:** `toMinor()` and `toMinorNumber()` (the methods and the `/fn` functions) return
  units of the currency's minor unit at every scale. Before, they returned units of the value's own
  scale, so `fromMinor(1234, 'EUR', 3).toMinorNumber()` was 1234 (tenths of a cent), and writing a
  scale-3 value to a cents column stored ten times the amount. Now 12.340 EUR at scale 3 gives 1234
  (cents), 1.5 EUR at scale 1 gives 150, and a value with non-zero digits below the minor unit
  throws a `RoundingError` (round it first). The old meaning is the new `toScaledUnits()`, which
  goes with the value's scale. Values at the currency's exponent are unaffected.
  **Upgrading:** if you stored `toMinor()` or `toMinorNumber()` of amounts that aren't at the
  currency's exponent, the same call now returns a different number, with no error, for values
  below the exponent (1.5 EUR at scale 1: 15 → 150) and for values above it with trailing zeros
  (12.340 EUR at scale 3: 12340 → 1234). Switch those calls to `toScaledUnits()` to keep the old
  numbers, or migrate the stored values. See #211.

### Fixed

- The ECB parsers and fetchers throw a `TypeError` naming `availableAt` when it is neither a boolean
  nor a function (a string or a Date from untyped code), before parsing or fetching anything.
  Before, it was ignored on a file with no days and failed as "not a function" on the first day.

## [0.2.2] - 2026-11-08

### Changed

- `Fixed#divide` takes the number fast path Money's `divide` has: a safe-integer value divided by a
  divisor whose ratio parts are safe integers, at the value's own scale, no longer builds the
  inverse ratio in bigint. It runs 43% fewer instructions dividing by 3 or by '1.5', and on a clean
  machine `Fixed` now divides faster than bigdecimal.js on every runtime. Results are unchanged.
- NOTICE names the source of every data file (the Braintree, Checkout.com, Klarna and PayPal tables and
  ISO 4217 List Three were missing), and a test keeps it so.

## [0.2.1] - 2026-11-08

### Fixed

- Types: a program that augments Money itself (`declare module '@ducatjs/money' { interface Money<C
  extends string> { ... } }`, as `extendMoney` plugins do) and imports opt-in modules no longer
  loses methods. Depending on the order TypeScript read the files, the methods of modules loaded
  after the augmentation, and the augmentation's own methods, were missing from `Money`. Every
  module now augments the root entry, as users do.
  0.1.0 has the same problem; upgrade to 0.2.1 to fix it.
- NOTICE now credits the Unicode CLDR data that `data/cldr-cash.json` ships, with the Unicode
  License v3 it is used under.

## [0.2.0] - 2026-11-08

Integrations and sources. New opt-in entries for Drizzle, Kysely, node-postgres, Zod, Valibot and
test matchers; historical exchange rates, with parsers for the ECB Data Portal, the Bank of Canada,
the Federal Reserve's H.10, HMRC and the Bank of England; rounding policies; withdrawn currency
codes; and more cash-rounding rules. Some results change: `parse` now rejects misplaced group
separators, and amounts in ten more currencies cash-round. The breaking changes are listed under
**Changed**.

### Added

- `@ducatjs/money/historic`: an opt-in table of 54 withdrawn ISO 4217 codes (HRK, BGN, ANG, STD,
  SLL, ZWL, CUC, VEF, the euro's predecessors and more) and the offshore yuan CNH, each with the
  exponent ISO gave it while it was current and, from ISO 4217 List Three, the month it was
  withdrawn. `defineHistoricCurrencies(codes?)` registers them so Money can hold old records and
  processor listings; `historicCurrency(code)` and `historicCurrencies()` read the table, and
  `HistoricCurrencies` adds the codes to the `CurrencyCode` type.
- Cash-rounding rules for AMD and CRC (10), UZS and TZS (50), RSD, PKR, MNT, GYD and TWD (1)
  and MRU (0.20), each checked against the national central bank's own pages (GYD, MRU and TZS
  rest on secondary sources and are marked unverified). CLDR's cash data is now a second source,
  with a test that fails when the two disagree unless the difference is listed with its reason.
- `currencyDigits(code, { usage: 'cash' })` in `/cash`: the decimals a cash amount is shown with
  (0 for SEK, 2 for CHF and DKK); without `usage: 'cash'`, the ISO exponent.
- A cash rule can carry its source's tie rule: Serbia rounds a 50 para tie down, so
  `cashRound(money('10.50', 'RSD'))` is `10.00 RSD`. An explicit `rounding` still wins.
- `convert`, `convertDetailed`, `Rate#convert` and `Money#convert` accept a rounding policy wherever
  they accept a rounding mode: the result lands on the policy's scale and increment (and its
  currency is checked against the target), and `convertDetailed`'s residual stays exact.
- `parseMoney(text, locale, options)` in `/parse` parses `"CHF 1’234.50"` or `"USD 100"` and
  detects the currency from ISO codes and the locale's `Intl` symbols. It never guesses: a shared
  symbol such as `$` needs a `hint` or a `symbols` map, a contradicting hint, a locale without
  Intl data and bad grouping throw, and `lenient: true` relaxes only the grouping (and reads a
  bare number in the hint).
- `@ducatjs/money/testing` for Vitest and Jest: value equality for `toEqual` (any scale, number
  or bigint), a snapshot serializer and inspect hook (`12.34 EUR`), and the matchers
  `toBeMoney`, `toHaveCurrency`, `toBeGreaterThanMoney` (and the other comparisons) and
  `toSumTo`. `/testing/vitest` and `/testing/jest` set it all up in one import, and
  `/testing/arbitraries` has the fast-check arbitraries `arbMoney` and `arbCurrency`.
- **Sterling sources:** `parseHmrcMonthlyCsv` in the new `@ducatjs/money/convert/hmrc` reads
  HMRC's monthly exchange rates (customs and VAT, Open Government Licence) into GBP tables valid
  for their month, available from the end of the day HMRC publishes them. `parseBankOfEnglandCsv` in the
  new `@ducatjs/money/convert/boe` reads the Bank of England's daily spot rates from its database
  CSV, putting back the stripped zeros. Parsers only; the Bank's spot rates may be third-party
  data, so ducat ships none.
- **Federal Reserve H.10:** `parseFedH10Csv` in the new `@ducatjs/money/convert/fed` reads the
  Board's daily rates (CSV from its Data Download Program) into USD tables, with the four currencies
  H.10 quotes as USD per unit inverted exactly and `ND` holidays left out. Parser only.
- `@ducatjs/money/zod` and `@ducatjs/money/valibot`: `moneySchema()` parses the JSON form
  `{ amount, currency }` into Money at API boundaries (exact decimal strings only, known or listed
  currencies, at most 50 digits by default, typed output), and `moneyJSONSchema()` validates it
  without converting. The Zod schema is a codec, so `z.encode` writes Money back as JSON. Zod 4
  and Valibot 1 are optional peer dependencies.
- **Bank of Canada:** `parseBankOfCanadaJson` in the new `@ducatjs/money/convert/boc` reads the
  Valet API's daily rates into CAD tables (exact inverses of the published CAD-per-unit quotes,
  with `availableAt` 16:30 Toronto time), and `fetchBankOfCanada({ start, end })` in
  `@ducatjs/money/convert/fetch` fetches them.
- **Rounding policies** (`@ducatjs/money/policy`): `roundingPolicy({ scale, increment,
  rounding, currency })`, `isoPolicy` and `cashPolicy(currency, options)` (in `/cash`) are
  reusable values accepted wherever a rounding mode is (`multiply`, `divide`, `round`,
  `percentage`, `discount`, `addTax`, `extractTax`). The result is rounded once, straight to the
  policy's scale and increment; for the tax functions that is the gross (`addTax`), the net
  (`extractTax`) or the discounted price (`discount`). A policy is also a function that rounds an
  amount. `assertScale(money, policy)` checks that an amount is already rounded to a policy.
- **A scale column for minor units:** `toMinorColumns(m, 'amountMinor', 'currency', { scale:
  'amountScale' })` and `minorMoneyField(..., { scale: 'amountScale' })` store and read each
  amount's scale next to its minor units, so any scale round-trips and stored amounts keep their
  meaning if an exponent changes. A bundled ISO 4217 exponent change is now documented as
  breaking: listed under Changed, and shipped only in a minor version before 1.0 and a major version
  from 1.0. See [Databases](README.md#databases).
- `isMoneyIn(value, currency)` and `assertCurrency(money, currency)` narrow a `Money<string>`
  (a currency known only at run time) to a literal `Money<'EUR'>` without a cast;
  `assertCurrency` throws `CurrencyMismatchError` for another currency.
- `majorPart` and `minorPart` split an amount at the decimal point (`12` and `34` for 12.34 EUR),
  truncating toward zero and keeping the sign.
- `identical(a, b)`: equal value, currency _and_ scale, for round-trip tests (`equals` treats
  1.0 EUR and 1.00 EUR as equal).
- `m.with(operation)` applies a function such as a rounding step or a conversion as one link of a
  method chain.
- **Drizzle ORM column types** in `@ducatjs/money/drizzle/pg`, `/drizzle/mysql` and
  `/drizzle/sqlite`: `moneyMinor('EUR')` (BIGINT minor units), `moneyDecimal('EUR')` (NUMERIC) and
  `moneyJson()` (JSON), so selects return `Money` and inserts take it, with the currency in the
  column's type. Writes that a column would round, clamp or mislabel throw, and so do driver values
  that may have lost digits. `drizzle-orm` is an optional peer dependency.
  See [Drizzle](README.md#drizzle).
- **Kysely helpers** in `@ducatjs/money/kysely`: `moneyHelpers(dialect)` gives `selectMoney`
  and `selectDecimalMoney`, which select Money as a self-describing JSON value; `compareMoney`, which
  compares currency and amount together; and `sumMoney`, which throws across currencies.
  `setMoney` and `setDecimalMoney` give the columns for writes. `MoneyResultPlugin` converts only
  the marked values, wherever they appear (unions, CTEs, nested JSON, streams, `CamelCasePlugin`),
  so a raw column is never typed as Money. `kysely` is an optional peer dependency. See
  [Kysely](README.md#kysely).
- **ECB Data Portal:** `parseEcbSdmxCsv` (and `parseEcbSdmxDecimals`) in
  `@ducatjs/money/convert/ecb` read the SDMX-CSV of the daily euro reference rates, any range back
  to 1999, with the published digits rebuilt from each series' `DECIMALS`.
  `fetchEcbRange({ start, end, currencies })` in `@ducatjs/money/convert/fetch` fetches a range
  from it.
- **Historical rates.** In `@ducatjs/money/convert`: `availableAt` on rates and tables (a lookup
  before publication gets nothing, `Rate#isAvailable`), `Rate#quote` with the published digits,
  `null` for missing values with the table's `missing` list, and `validUntil` periods on tables.
  In the new opt-in `@ducatjs/money/convert/history`: `quotedTable` and `rateFromQuote` for rates
  published the other way round, per 100 units or with stripped zeros (`per`, `inverted`,
  `decimals`), and `rateHistory()` over a date range, whose `lookup()` reports why it fell back.
- **node-postgres support** in `@ducatjs/money/pg`: `exactTypes(pg.types)` parses BIGINT as bigint
  and NUMERIC (and their arrays) as exact strings, rejecting `NaN` and `Infinity`. `moneyTypeSql()`
  creates a `(amount, currency)` composite type with a currency-checked `sum` aggregate, read and
  written as Money. `toNumeric` refuses values a `NUMERIC(p, s)` column would round silently. See
  [node-postgres](README.md#node-postgres).

### Changed

- **`parse` checks where group separators are**, as `parseMoney` does: `78.00` in de-DE (where
  `.` groups thousands) and `1,5` in en-US now throw instead of becoming 7800.00 and 15.00. Text
  `format()` produces always parses, in both the standard and the accounting style, which can
  group differently (en-IN writes JP¥1,00,000 but (JP¥100,000)). `{ lenient: true }` restores
  the old behaviour.
- `parseMoney` accepts the accounting style's grouping too, so `(₹1,234,567.50)` parses in en-IN.

- **Visible change:** `cashRound`, `cashPolicy` and `cashRule` now have rules for AMD, CRC, UZS,
  TZS, RSD, PKR, MNT, GYD, TWD and MRU. Before, `cashRound` returned these amounts unchanged,
  `cashPolicy` threw a RangeError (no cash-rounding rule) and `cashRule` returned `undefined`. Cash
  amounts in these currencies now round to the smallest coin: `cashRound(money('1234.56', 'AMD'))`
  is `1230.00 AMD`, and RSD ties round down. Pass `includeUnverified: false` to leave out GYD, MRU
  and TZS, whose rules rest on secondary sources.
- `adyenRate` with `{ timeZone }` keeps one `Intl.DateTimeFormat` per time zone instead of
  building one for every row, which makes it about 20 times faster.
- **Visible change:** `Rate#toString()` (and so `toJSON().rate`) prints a decimal-string rate
  with the digits it was given, and `rateFromJSON` keeps them: `exchangeRate('EUR', 'HUF',
  '363.90').toString()` is `'363.90'`, not `'363.9'`. The value is unchanged.
- `rateTable` lookups with an `asOf` after a rate's `validUntil` now return nothing.
- `parseEcbCsv` lists `N/A` and blank cells in the table's `missing`, and throws on a cell that
  isn't a rate instead of passing it on.
- `divide` is about 3 to 14 times faster for ordinary amounts (number minor units, a divisor such as `3`,
  `'7'` or `'1.5'`). It no longer builds the inverse ratio with bigints on every call. The results
  are unchanged: the same proved rounding kernel is used.

### Fixed

- `multiply(zero, -1)` (and `Fixed#multiply`) returned `-0` minor units, which broke
  `Object.is`-based equality such as Vitest's `toBe`. Every operation now returns `0`.

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

[Unreleased]: https://github.com/public/ducat/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/public/ducat/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/public/ducat/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/public/ducat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/public/ducat/releases/tag/v0.1.0
