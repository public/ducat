# Changelog

All notable changes to `@ducatjs/money` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, a minor version may
contain breaking changes; they are always listed under **Changed** or **Removed**.

## [Unreleased]

### Documentation

- The documentation is rebuilt on [Diátaxis](https://diataxis.fr), in `docs/`: two tutorials (a
  first program and a checkout), how-to guides for each task (databases, payment processors,
  currency conversion with dated rates, tax, cash rounding, allocation, parsing, validation,
  testing, bundle size and more), a reference page for every entry, with each function's signature,
  rounding and errors, and explanation pages for the representation, rounding, exactness, modules,
  storage, the proofs and the decisions. The README is now the front door, with links into each
  part. Nothing was removed: every section moved to its page. `docs/COMPARISON.md` and
  `docs/FINANCE.md` moved to `docs/explanation/`, and the old paths link forward.
- Every TypeScript block in `docs/` runs as a doctest, as the README's do. A test fails when an
  export, type or method is missing from the reference, and another when a link or anchor in the
  docs doesn't resolve.

### Deprecated

- `npv`, `npvExact`, `irr`, `IrrOptions` and `IrrResult` from `@ducatjs/money/finance`: they
  moved to `@ducatjs/money/excel`, where Excel-named functions live. `/finance` re-exports them
  in 0.4, marked `@deprecated`; 0.5 removes them. Import them from `/excel` (#200).

### Added

- `@ducatjs/money/excel`, a new entry for Excel's financial functions, under the Excel rule:
  Excel's arguments and sign convention, and Excel's value at 15 significant digits wherever
  Excel's double evaluation is well conditioned (the exact value or root where it isn't). It has
  `npv`, `npvExact` and `irr`, moved from `/finance`, and the new functions below (#200).
- `fv`, `pv`, `pmt`, `nper` and `rate` in `/excel`: Excel's FV, PV, PMT, NPER and RATE, with
  Excel's arguments, sign convention and `type`, and Excel's values. `fv`, `pv` and `pmt` are exact
  and rounded once (`fvExact`, `pvExact`, `pmtExact` return the `ExactMoney`); `nper` is to
  `digits` places from rigorous logarithm bounds, with `exact` when it is rational; `rate` is
  `irr` of the implied flows. They throw where Excel would give another kind of answer: a
  fractional `nper`, a rate at or below −1, and several possible rates without a `bracket` (#200).
- `periodicRate(annual, { perYear, digits })` and `annualRate(periodic, { perYear })` in
  `/finance`: the periodic rate equivalent to an effective annual rate, `(1 + annual)^(1/perYear)
  − 1`, and its inverse. `annualRate` is an exact `Ratio`; `periodicRate` is found like `irr`, to
  `digits` places floored by exact bisection, with `lower` and `upper` 10^−digits apart around
  the root and `exact` when the root is rational (#199).
- `format(m, locale, { digits, rounding })` (and `formatToParts`, and the methods): rounds once,
  exactly, to `digits` decimals with `rounding` (default `'halfExpand'`), then shows that many
  fraction digits, exact at any size and in any of ducat's rounding modes; Intl's own
  fraction-digit options can't be combined with it (#207).
- A guide, [How to migrate from dinero.js](https://github.com/public/ducat/blob/main/docs/how-to/migrate-from-dinero.md):
  the API of dinero.js 1 and 2, their rounding defaults, stored amounts and the names that changed
  meaning (#209).
- `currencyContext(currency, { locale, parse? })` (`@ducatjs/money/context`, and `/fn`):
  `money`, `fromMinor`, `zero`, `format` and `is` bound to one currency and locale, as a frozen
  plain object, for single-currency apps, plus `parse` when it is passed in; `MoneyOf<typeof ctx>`
  is its Money type. Nothing global is set, and a `/fn` program using one carries only the
  currencies it imports (#216).
- `hasFraction()` (method and `/fn`): whether the amount has a non-zero fractional part, true for
  12.34 EUR and false for 12.00 EUR at any scale; dinero.js calls it `hasSubUnits` (#208).
- `@ducatjs/money/typeorm`: TypeORM column transformers, exact both ways:
  `minorTransformer(currency, { scale? })` for BIGINT minor units, `decimalTransformer(currency,
  size?)` for NUMERIC/DECIMAL and `jsonTransformer(currency?)` for `json`, `jsonb` and
  `simple-json`, which also work in find operators; and `fromRawMinor` and `fromRawDecimal` for
  aggregates from raw queries. `typeorm` is an optional peer dependency, and the entry doesn't
  import it (#215).
- `/wire`: dinero.js 1's `{ amount, currency, precision }` shape (`toDineroObject`,
  `fromDineroObject`), exact both ways and at the object's precision; `m.round('unnecessary')`
  brings a value to the currency's exponent. `amount` must be a safe integer or a bigint and
  `precision` a valid scale: a value of the wrong type throws a `TypeError`, one out of range a
  `RangeError` (#217).
- Arithmetic on `Ratio` values in `/math`: `ratioAdd`, `ratioSubtract`, `ratioMultiply`,
  `ratioDivide`, `ratioNegate`, `ratioComplement` (1 − r) and `ratioCompare`, exact and reduced,
  taking any factor (Ratio, Fixed, decimal string, integer) on either side (#201).
- `toNumber()` (method and `/fn`) and `toMinorNumber({ lossy: true })`: explicitly lossy number
  conversions that round once to the nearest double, for charts and APIs that take numbers.
  `ExactMoney#toNumber()` too (#206).
- `addTaxExact()` and `extractTaxExact()` in `/exact`: tax splits as unrounded `ExactMoney`
  parts (net + tax is exactly gross), so a report can sum the rows and round once (#218).
- `ExactMoney` has the helpers `Money` has: `abs`, `isPositive`, `isNegative`, `lessThan` and the
  other comparisons, `min`, `max`, `clamp`, `percentage` and `ratioOf`. `add`, `subtract`,
  `compare`, `equals` and these accept a `Money` of the same currency, exactly, and `round` and
  `roundWithResidual` take a rounding policy as well as a mode (#202).
- `multiplyExact()` (function and method, in `/exact`): an exact multiply whose scale grows to
  hold the product, never below the amount's, throwing a `RoundingError` when it doesn't
  terminate; and `ExactMoney#toMoney()`, the exact value as Money by the same rule (#223).

### Changed

- **Visible change:** `irr` throws a RangeError for an IRR above 2^1024 per period, where it used to keep doubling its
  search without limit; every rate solver in `/excel` and `/finance` now has a bounded number of steps (#200).
- **Visible change:** `toIso20022Amount` and `fromIso20022Amount` accept only ISO 4217 codes, as
  ISO 20022's `ActiveOrHistoricCurrencyCode` requires: current codes (including `XAU` and the other
  codes without a minor unit) and withdrawn ones registered with `defineHistoricCurrencies`. A
  registered non-ISO code such as `BTC` used to be written; it now throws a RangeError (#273).
- **Visible change:** `parse(text, currency, locale)` throws a RangeError naming the locale when
  the runtime has no Intl data for its language and region (`xx-ZZ`, `de-XX`), as `parseMoney`
  already did. It used to read the amount with the fallback locale's separators, which can misread
  it. Pass a supported locale, or the base language (`de`) (#271).
- **Visible change:** `tieredPrice` throws a RangeError naming the tier when one has neither a
  `unitAmount` nor a `flatAmount`; it used to charge that tier 0. Write a free tier as
  `unitAmount: money('0', …)` (#272).
- `extractTax` and `extractTaxExact` throw a RangeError naming the percent for -100% or below,
  where no net amount has that gross. Before, -100% failed inside `ratio()` with "Division by
  zero", and a percent below -100 returned a meaningless split (a net of −2 × gross at −150%).
  `format(m, locale, { digits })` also refuses Intl's significant digits and `roundingIncrement`,
  which would round a second time, on a double.
- **Breaking:** `ExactMoney`'s `num` and `den` are getters now, not own fields. They are still
  the reduced bigints, but spreading (`{ ...e }.num`), `Object.keys`/`entries` and copies no
  longer carry them, and `toEqual` compares the new own fields `numerator` and `denominator`
  (numbers or bigints). **Upgrading:** read `e.num` and `e.den` directly, and don't spread or copy
  an ExactMoney; to store one, `round()` it or use `toMoney()` (#224).
- `ExactMoney` is 2–6× faster on everyday amounts: it works on numbers while its numerator and
  denominator are safe integers, and on bigints beyond, as Money does. Values beyond 2^53 are about
  5–10% slower. `JSON.stringify` of an ExactMoney throws a TypeError naming `round()`, where it
  already failed on the bigints (#224).
- A `Money<string>` (a currency known only at run time) is accepted beside a literal
  `Money<'EUR'>` in `add`, `subtract`, `compare`, the comparisons, `min`, `max`, `clamp`,
  `ratioOf`, `divideToIntegral` and `remainder`, as functions and methods. The currency is checked
  at run time, and the result keeps the literal. A different literal or a union is still a compile
  error. The operand type is exported as `MoneyOperand` (#219).

### Fixed

- `convertDetailed(m, rate, mode, { strictValidity: true })` refuses an expired rate, as `convert`
  and `convertDetailed` with a policy already did: both now share the rate's validity check
  (#270).

## [0.3.0] - 2026-11-09

Finance, pricing, currency data and a much smaller `/fn`. New opt-in entries: `/finance` (day
counts, interest, loan schedules, Excel's NPV and IRR, proration), `/pricing` (price endings and
tiered pricing), `/math`, `/currencies` and `/territories` (ISO numeric codes, Intl names and
symbols, CLDR territory currencies), `/crypto`, `/wire` (google.type.Money, ISO 20022 amounts),
`/words` (amounts in words in seven languages) and `/iso` (ISO 4217 registration for `/fn`). A
`/fn` program that creates, adds and prints amounts now bundles to about 1.3 KiB gzipped. The root
entry grows from 4.9 to 5.5 KiB, for stricter validation and for installing the methods and
currencies that `/fn` now leaves out. These changes can break existing code; each is under
**Changed** with how to upgrade:

- `toMinor()` and `toMinorNumber()` return the currency's minor units at any scale (the old
  meaning is `toScaledUnits()`);
- the core Money methods are installed by the root entry, so code that imports only `/fn` and
  calls methods imports `@ducatjs/money` too;
- `/fn` no longer registers the ISO 4217 currencies, so a module that imports only `/fn` imports
  `@ducatjs/money/iso` (or the codes it uses);
- `/fixed` no longer loads Money: conversions moved to `/fixed/money`;
- a number beyond 15 significant digits is refused where it becomes exact;
- decimal strings with surrounding whitespace throw a `SyntaxError`.

Values that aren't Money or aren't factors, unknown currencies with an explicit scale, and invalid
scales now fail early with clearer errors.

### Added

- `@ducatjs/money/iso` registers every ISO 4217 currency, and `@ducatjs/money/iso/<CODE>` (one
  module per code, generated from the ISO list) registers one, for `/fn` programs.
- `Fixed#trimScale(minimumScale = 0)`, the smallest scale that keeps the value exact, like Money's
  `trimScale` from `/math`; and `Fixed#toNumber()`, the nearest double, an explicit lossy
  conversion for display and charts (`Number(fixed)` still throws).
- A `Fixed` is accepted as a factor everywhere a `Factor` is (Money's `multiply` and `divide`, the
  tax functions, `ExactMoney`, conversion and rates), read exactly as its scaled integer over
  10^scale, and `Fixed#toRatio()` gives it as a reduced `Ratio`. Money's core still doesn't load
  `/fixed`.
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
  amounts sum to the total. For real tier tables: quantities as `'a/b'` strings, ratios or
  `Fixed`; an open last tier as `'inf'`, `null` or `Infinity`; `beyondLastTier: 'cap'` to charge
  nothing past a bounded last tier; and `chargeQuantity`, in volume mode, to choose the tier by one
  quantity and charge by another.

### Changed

- **Breaking:** the core Money methods (`add`, `multiply`, `round`, `toDecimal`...) are installed by
  the root entry `@ducatjs/money` instead of being part of the class, so a program written with
  `@ducatjs/money/fn` keeps only the functions it uses: create, add and print goes from 4.0 to 1.8
  KiB gzipped, and create, add, multiply and print from 4.0 to 3.2 KiB. The root entry grows by about
  0.13 KiB. Code that imports only `/fn` and also calls methods must import `@ducatjs/money` (or
  `@ducatjs/money/all`) too, or call the functions instead of the methods. Importing the root entry
  throws if a program already defined a core method name with `extendMoney`.
- **Breaking:** `@ducatjs/money/fn` no longer registers the ISO 4217 currencies, so a `/fn` program
  carries only the ones it imports: `import '@ducatjs/money/iso/EUR'` registers EUR (create, add and
  print goes from 1.8 to 1.4 KiB gzipped), and `import '@ducatjs/money/iso'` registers them all.
  Without either, a code throws "Unknown currency", naming the import. Every other entry (the root,
  `/all`, the opt-in modules, `/parse`, `/wire`, the processor, database, schema and testing
  entries) registers the whole table itself, as before, and the root grows from 5.52 to 5.57 kB. The
  entries that never build Money (`/fixed`, `/words`, `/territories`) stay without it. Registration
  is by import, so it's the same bundled and unbundled. It's per module, not per program: any
  module that imports only `/fn` and builds Money while it loads (`const FEE = money('0.30',
  'EUR')`) runs before the modules that import it, so it throws even in a program whose entry point
  imports `@ducatjs/money`. Such a module, and any library built on `/fn`, imports the currencies
  it uses itself (`@ducatjs/money/iso`, or `/iso/EUR`).
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

- **Visible change:** an explicit scale no longer skips the currency check. `fromMinor(1, 'XYZ', 2)`,
  `money('1', 'XYZ', { scale: 2 })`, `zero('XYZ', 2)`, conversion into an unknown currency with
  `{ scale }`, and the processor and wire readers built on them now throw "Unknown currency", as
  they do without a scale. Register custom codes with `defineCurrency`.
- `fromMinor` says "Minor units must be an integer" for a fraction such as 12.3, and suggests a
  bigint only for integers beyond 2^53. `fromScaled` in `/fixed` does the same.
- **Visible change:** `ratio()` and everything that takes a `Factor` (`multiply`, `divide`,
  `percentage`, the tax functions, `ExactMoney`, `Fixed`, conversion and rates) throw a `TypeError`
  naming what was passed for a value that isn't a factor: a `Fixed`, `{ num: 1, den: 2 }` with number
  fields, `null`, a boolean. Before, `ratio(fixed('0.5'))` returned the object unchanged and
  arithmetic failed later with "Cannot mix BigInt and other types". A hand-made `{ num, den }` of
  bigints is now reduced and given its number fields, rather than trusted as it is.
- **Breaking:** a number whose shortest decimal form has more than 15 significant digits is
  refused wherever a number becomes an exact value, as `fixed()` already did: `ratio()` and so
  every factor (`multiply(1 / 0.52)`), allocation weights, and `money()` without a `rounding`
  mode (`money(1 / 0.52, 'EUR', { scale: 20 })`). Such a number (1.9230769230769231) is a float
  artefact, not a decimal anyone wrote. Pass a decimal string, or give `money()` a rounding mode.

- **Visible change:** every function that takes a scale checks it the same way, and refuses
  anything but an integer from 0 to 1000 with "Invalid scale -2: use an integer from 0 to 1000".
  `ExactMoney#round` and `#isExact` used to fail with an unrelated message ("undefined must be
  positive"), and `money()`, `fromMinor()`, `zero()`, `toScale()` and conversion had no upper bound.
  Round to tens or hundreds with an increment, not a negative scale.
- **Breaking:** decimal strings with surrounding whitespace are refused everywhere with a
  `SyntaxError`. `money(' 12.34', 'EUR')`, `fixed('1e-7 ')` and `ratio(' 1/3')` used to be
  accepted on the slower parsing path, while `'12.34 '` and similar were refused on the fast one.
  The grammar is now written down in the README and the `money()` and `fixed()` docs: an optional
  sign, digits, optionally a point with digits after it, and optionally an exponent.
  **Upgrading:** values read from CSV files, forms or databases with stray spaces (`' 12.34'`,
  `'1 / 3'`) now throw a `SyntaxError`. Trim them first, or use `parse()` for text people typed.

### Fixed

- `format()` and `formatToParts()` with options reuse a cached `Intl.NumberFormat` (keyed by
  locale, currency, scale and the options) instead of building one per call, about 30 times faster
  in a loop. The cache stays bounded.
- The README's links to the changelog, `docs/`, `compare/` and `bench/` are absolute GitHub URLs,
  so they work when the README is read from `node_modules` or the npm page; a test fails on any
  relative link to a file the package doesn't ship.
- TypeScript projects with `module: "commonjs"` (`node10` resolution) find ducat's types: the
  package has a top-level `types` and a `typesVersions` map for every entry, next to `exports`.
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
  from 1.0. See [Databases](docs/how-to/store-money-in-a-database.md).
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
  See [Drizzle](docs/reference/drizzle.md).
- **Kysely helpers** in `@ducatjs/money/kysely`: `moneyHelpers(dialect)` gives `selectMoney`
  and `selectDecimalMoney`, which select Money as a self-describing JSON value; `compareMoney`, which
  compares currency and amount together; and `sumMoney`, which throws across currencies.
  `setMoney` and `setDecimalMoney` give the columns for writes. `MoneyResultPlugin` converts only
  the marked values, wherever they appear (unions, CTEs, nested JSON, streams, `CamelCasePlugin`),
  so a raw column is never typed as Money. `kysely` is an optional peer dependency. See
  [Kysely](docs/reference/kysely.md).
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
  [node-postgres](docs/reference/pg.md).

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
  See [Design](docs/explanation/representation.md).
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
  See [Fixed-point decimals](docs/reference/fixed.md).
- **Payment processor views:** the amount each processor expects, with its own minor-unit
  exceptions, for Stripe, Adyen, Checkout.com, PayPal, Braintree and Klarna (`/stripe`,
  `/adyen`, `/checkout`, `/paypal`, `/braintree`, `/klarna`), plus Stripe and Adyen exchange
  rates (`/stripe-fx`, `/adyen-fx`).
  See [Payment processors](docs/reference/processors.md).
- **Database helpers** for Prisma (`/prisma`) and guidance for NUMERIC and BIGINT columns.
  See [Databases](docs/how-to/store-money-in-a-database.md).
- **Currency data** generated from the ISO 4217 list, with `defineCurrency` for codes that are
  not in it. See [Currency data](docs/reference/currency-data.md).
- **A comparison with other money libraries**, covering correctness, speed and bundle size:
  [docs/COMPARISON.md](docs/COMPARISON.md).

[Unreleased]: https://github.com/public/ducat/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/public/ducat/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/public/ducat/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/public/ducat/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/public/ducat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/public/ducat/releases/tag/v0.1.0
