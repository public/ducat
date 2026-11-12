<p align="center"><img src="https://raw.githubusercontent.com/public/ducat/main/assets/logo.png" width="128" height="128" alt="A gold ducat of Doge Francesco Foscari, 1423–1457"></p>
<p align="center"><sub>Gold ducat of Francesco Foscari, Venice, 1423–1457. Photo: Francesco Bini, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, via Wikimedia Commons (<a href="assets/CREDITS.md">credits</a>).</sub></p>

# ducat

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/public/ducat?utm_source=badge)

An exact, fast, typed Money type for TypeScript. It has zero runtime dependencies and runs on Node, Bun, Deno and browsers.

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate'; // opt-in modules add their methods to Money
import '@ducatjs/money/tax';
import '@ducatjs/money/convert';
import '@ducatjs/money/format'; // or import '@ducatjs/money/all' for everything except the integrations that need optional peers

const price = money('19.99', 'EUR'); // Money<'EUR'>
const total = price.add(money('5.01', 'EUR')); // → 25.00 EUR
total.multiply('1.075'); // → 26.88 EUR (26.875 rounds half away from zero by default)
total.multiply('1.075', 'halfEven'); // → 26.88 EUR (any of 9 modes, or 'unnecessary' to throw)
money('100', 'EUR').allocate([1, 1, 1]); // → [33.34 EUR, 33.33 EUR, 33.33 EUR] (sums to 100.00, always)
money('12', 'GBP').extractTax(20); // → { net: 10.00 GBP, tax: 2.00 GBP, gross: 12.00 GBP }
total.convert('JPY', '162.457'); // → 4061 JPY
total.format('de-DE'); // → '25,00 €'
price.add(money('1', 'USD')); // compile error, and throws if types are erased
```

Operations are methods on `Money`. For pipelines or code that prefers plain functions, `@ducatjs/money/fn` has each of them as a function of the same name (`add(price, fee)`, `allocate(m, [1, 1, 1])`), and a bundle keeps only the functions it imports: a program that only creates, adds and prints amounts is about 1.3 KiB gzipped through `/fn`. Importing `@ducatjs/money` installs the methods and registers every ISO 4217 currency; `/fn` does neither, so a `/fn` program imports the currencies it uses (`import '@ducatjs/money/iso/EUR'`, or `@ducatjs/money/iso` for all of them) and carries only those. The core (`@ducatjs/money`) holds construction, arithmetic, rounding, comparison and serialisation; everything else is an opt-in module, so a bundle only pays for what it imports (see [Modules](#modules), and [How to keep bundles small](https://github.com/public/ducat/blob/main/docs/how-to/keep-bundles-small.md)).

Status: 0.x. The API is meant to stay small, but until 1.0 a minor version may change it; the [changelog](https://github.com/public/ducat/blob/main/CHANGELOG.md) lists every breaking change. See [Known limitations](https://github.com/public/ducat/blob/main/docs/reference/limitations.md).

## Install

```sh
pnpm add @ducatjs/money
```

It runs on Node 24 or later, Bun, Deno and browsers. ducat is an ES module; CommonJS projects can `require()` it on Node 24 (see [How to use ducat from CommonJS](https://github.com/public/ducat/blob/main/docs/how-to/use-from-commonjs.md)).

## Documentation

- **[Tutorials](https://github.com/public/ducat/blob/main/docs/README.md#tutorials)**: start with [Your first program with ducat](https://github.com/public/ducat/blob/main/docs/tutorials/first-steps.md), then [Build a checkout](https://github.com/public/ducat/blob/main/docs/tutorials/checkout.md).
- **[How-to guides](https://github.com/public/ducat/blob/main/docs/README.md#how-to-guides)**: store money in [a database](https://github.com/public/ducat/blob/main/docs/how-to/store-money-in-a-database.md), [send amounts to Stripe, Adyen and others](https://github.com/public/ducat/blob/main/docs/how-to/send-amounts-to-payment-processors.md), [convert currencies](https://github.com/public/ducat/blob/main/docs/how-to/convert-currencies.md) with [dated rates](https://github.com/public/ducat/blob/main/docs/how-to/use-historical-rates.md), [add and extract VAT](https://github.com/public/ducat/blob/main/docs/how-to/add-and-extract-tax.md), [round cash](https://github.com/public/ducat/blob/main/docs/how-to/round-cash.md), [split amounts](https://github.com/public/ducat/blob/main/docs/how-to/split-and-allocate.md), [parse what people type](https://github.com/public/ducat/blob/main/docs/how-to/parse-user-input.md), [test your code](https://github.com/public/ducat/blob/main/docs/how-to/test-code-that-uses-money.md), [migrate from dinero.js](https://github.com/public/ducat/blob/main/docs/how-to/migrate-from-dinero.md), and more.
- **[Reference](https://github.com/public/ducat/blob/main/docs/reference/README.md)**: every entry, function, method, type and error, with its rounding and what it throws.
- **[Explanation](https://github.com/public/ducat/blob/main/docs/README.md#explanation)**: [the representation](https://github.com/public/ducat/blob/main/docs/explanation/representation.md), [rounding](https://github.com/public/ducat/blob/main/docs/explanation/rounding.md), [exactness](https://github.com/public/ducat/blob/main/docs/explanation/exactness.md), [modules](https://github.com/public/ducat/blob/main/docs/explanation/modules.md), [what is proved](https://github.com/public/ducat/blob/main/docs/explanation/proofs.md), [decisions](https://github.com/public/ducat/blob/main/docs/explanation/decisions.md) and [how ducat compares](https://github.com/public/ducat/blob/main/docs/explanation/comparison.md).

Coming from dinero.js? [How to migrate from dinero.js](https://github.com/public/ducat/blob/main/docs/how-to/migrate-from-dinero.md) maps its API, rounding defaults and stored data to ducat.

## Why ducat

Choosing a money library for JavaScript today means choosing which problem to live with.

- **Wrong, to varying degrees.** On the same 41 correctness vectors, no other money library passes more than 34, and most return some wrong answers without an error: multiplying through floats turns 0.50 × 1.15 into 0.57, splitting −100.00 three ways loses a cent, amounts past 2⁵³ minor units drift, and a decimal string from another locale can parse as 100 times the amount. Their issue trackers are full of these bugs, some open for years.
- **Slow.** The libraries that get the arithmetic right pay for it in speed: dinero.js 2, the most careful of them, is 1.6× to 27× slower than ducat on the operations ducat leads.
- **Missing features.** Most stop at add, multiply, allocate and format. Exact currency conversion, rounding modes beyond half up, cash rounding, the amounts payment processors expect and database storage are left to you, and that hand-written code is where the bugs come back.

ducat is built to fix all three:

- **Exact, and tested to stay exact.** Amounts are integers of minor units: a JS number while safe, a bigint beyond, so nothing is ever a float. Every operation that can round takes one of nine rounding modes (or `'unnecessary'`, which throws), the rounding kernel is generated from Lean proofs, and allocation is checked against a proved model. It passes all 41 vectors, and the bug classes found in the issue trackers and fix histories of dinero.js, currency.js, js-money, decimal.js, big.js and bignumber.js each have a regression test in ducat's suite.
- **Fast.** Safe amounts stay on a plain-number fast path, so ducat is the fastest money library measured on creating, parsing, add, multiply, allocate and toDecimal on Node, Bun and Deno ([How it compares](#how-it-compares) has the numbers, and the cases where it isn't fastest).
- **Complete, but you only pay for what you use.** Conversion with exact rates and their sources, rounding policies, cash rounding, processor amounts (Stripe, Adyen, Checkout.com, PayPal, Braintree, Klarna), tax, a fixed-point `Fixed`, Intl formatting and strict parsing, and Prisma, Drizzle, Kysely and Postgres helpers are all opt-in modules. The core is 5.5 KiB gzipped.

---

## How it compares

The same 41 correctness vectors, the same benchmark and the same bundle snippet for every library. The details, the
other libraries' bugs, the fixed-point libraries and the money libraries in other languages are in
[docs/explanation/comparison.md](https://github.com/public/ducat/blob/main/docs/explanation/comparison.md), regenerated from [compare/](https://github.com/public/ducat/tree/main/compare) for each release.

| library                            | correct (of 41) | wrong, silently |        bundle (gzip) |
| ---------------------------------- | --------------: | --------------: | -------------------: |
| **ducat**                          |          **41** |           **0** |              4.6 KiB |
| dinero.js 2 (bigint calculator)    |              34 |               0 |              1.8 KiB |
| monetra                            |              34 |               3 |              4.5 KiB |
| ts-money / js-money                |              31 |           7 / 6 |       30.7 / 8.8 KiB |
| bigint-money                       |              30 |               0 |              1.5 KiB |
| dinero.js 2 (number calculator)    |              30 |               4 |              1.8 KiB |
| decimal.js / big.js / bignumber.js |              22 |               1 | 12.6 / 2.9 / 8.5 KiB |
| currency.js                        |              16 |               6 |              1.3 KiB |

- **Correct everywhere:** ducat is the only library that passes every vector, including amounts beyond 2⁵³ minor
  units, float traps and negative allocations.
- **Fastest on arithmetic:** with its methods API, it is the fastest money library on creating, parsing a decimal string
  (`money('12.34', 'EUR')`), add, multiply and allocate on Node, Bun and Deno, on toDecimal on Node and Deno (level with
  js-money on Bun), and on compare on Deno (level with ts-money on Node). Against the fastest other money library the
  margin ranges from about 1.09× (compare on Deno: 7.44 against currency.js's 8.13 ns) to about 8.7× (allocate on
  Node: 51 against bigint-money's 439 ns). Against dinero.js 2, on the operations where ducat is fastest, it ranges from
  1.6× (creating on Node) to about 26× (allocate on Bun), measured on Node and Bun: dinero.js 2's Deno cells vary
  several-fold between machines (see
  [the 0.3.0 run's notes](https://github.com/public/ducat/blob/main/compare/results/genoa-2026-11-09-v030-final/README.md)).
- **Where it isn't fastest:** formatting, where currency.js (formatting a float) is 8% faster on Node and 3% on Deno, and
  level on Bun; dinero.js 1 is also 3% faster on Node. On Bun, currency.js compares plain numbers faster (6.5 against
  7.6 ns). Bun's toDecimal and compare cells vary a lot between runs.
- **Fixed-point decimals:** ducat's `Fixed` is the fastest fixed-point library on parsing a decimal string
  (`fixed('12.34')`), add, multiply, divide and compare on every runtime. It divides by 3 in 31, 29 and 26 ns on Node,
  Bun and Deno, against bigdecimal.js's 63, 37 and 51. js-big-decimal and ethers are faster on `toString` everywhere;
  see
  [docs/explanation/comparison.md](https://github.com/public/ducat/blob/main/docs/explanation/comparison.md#fixed-point-decimal-libraries).
- **Not the smallest:** currency.js, bigint-money, dinero.js 2, @screeny05/ts-money, big.js, dinero.js 1 and monetra are
  smaller for the same snippet. ducat's core includes exact decimal parsing, bigint support and the ISO table; everything else
  is opt-in.
- **Measurement:** speed is from one quiet AMD EPYC Genoa vCPU, on ducat at commit f7ff47c (the 0.4.0 release candidate) under Node 24.22.2,
  Bun 1.4.4 and Deno 2.9.8; sizes are gzipped KiB. Differences within 2.5% are called level.

## Modules

Each module is an opt-in entry: importing it installs its methods on `Money` and makes them type-check. [About modules](https://github.com/public/ducat/blob/main/docs/explanation/modules.md) explains how, and [the reference](https://github.com/public/ducat/blob/main/docs/reference/README.md) has a page for every entry.

| import                              | adds to `Money`                                                    | also exports                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `@ducatjs/money`                    | the core: arithmetic, rounding, comparison, `toDecimal`, `toJSON`… | `money`, `fromMinor`, `zero`, `sum`, `fromJSON`, ISO exponents                                     |
| `@ducatjs/money/allocate`           | `allocate`, `split`, `instalments`, `schedule`, `chunk`            | the same as plain functions                                                                        |
| `@ducatjs/money/tax`                | `percentage`, `discount`, `addTax`, `extractTax`                   | the same                                                                                           |
| `@ducatjs/money/math`               | `ratioOf`, `divideToIntegral`, `remainder`, `trimScale`            | the same, `average`, `ratioAdd` and the other Ratio arithmetic                                     |
| `@ducatjs/money/convert`            | `convert`                                                          | `exchangeRate`, providers, `bag`, `comparator`…                                                    |
| `@ducatjs/money/exact`              | `exact`, `addTaxExact`, `extractTaxExact`, `multiplyExact`         | `ExactMoney`, `sumExact`, `addTaxExact`, `extractTaxExact`, `multiplyExact`                        |
| `.../convert/ecb`                   | nothing                                                            | `parseEcbXml`, `parseEcbCsv`, `parseEcbSdmxCsv`                                                    |
| `.../convert/history`               | nothing                                                            | `rateHistory`, `quotedTable`, `rateFromQuote`                                                      |
| `.../convert/boc`                   | nothing                                                            | `parseBankOfCanadaJson`                                                                            |
| `.../convert/fed`                   | nothing                                                            | `parseFedH10Csv` (parser only)                                                                     |
| `.../convert/boe`                   | nothing                                                            | `parseBankOfEnglandCsv` (parser only)                                                              |
| `.../convert/hmrc`                  | nothing                                                            | `parseHmrcMonthlyCsv` (parser only)                                                                |
| `.../convert/fetch`                 | nothing                                                            | `fetchEcb`, `fetchEcbRange`, `fetchBankOfCanada` (network I/O)                                     |
| `.../stripe-fx`, `adyen-fx`         | nothing                                                            | `stripeRate`, `stripeImpliedRate`, `adyenRate`                                                     |
| `@ducatjs/money/policy`             | nothing                                                            | `roundingPolicy`, `isoPolicy`, `assertScale`                                                       |
| `@ducatjs/money/context`            | nothing                                                            | `currencyContext` (one currency and locale, nothing global)                                        |
| `@ducatjs/money/pricing`            | nothing                                                            | `priceEnding` (.99, .95, the nearest 5), `tieredPrice` (tiers)                                     |
| `@ducatjs/money/cash`               | `cashRound`, `roundToIncrement`                                    | the same, `cashPolicy`, `cashRule`, `currencyDigits`                                               |
| `@ducatjs/money/historic`           | nothing                                                            | `defineHistoricCurrencies`, `historicCurrency` (withdrawn codes)                                   |
| `@ducatjs/money/crypto`             | nothing                                                            | `defineCryptoCurrencies`, `toBaseUnits`, `fromBaseUnits`                                           |
| `@ducatjs/money/currencies`         | nothing                                                            | numeric codes, `minorUnit`, `currencyName`, `currencySymbol`                                       |
| `@ducatjs/money/territories`        | nothing                                                            | `territoryCurrencies`, `currencyTerritories` (CLDR)                                                |
| `@ducatjs/money/wire`               | nothing                                                            | `google.type.Money`, ISO 20022, minor units, dinero.js objects                                     |
| `@ducatjs/money/words`              | nothing                                                            | `amountInWords`, `spellOut` (CLDR rules, no Money loaded)                                          |
| `@ducatjs/money/words/<language>`   | nothing                                                            | `english`, `german`, `french`, `spanish`, `italian`…                                               |
| `@ducatjs/money/finance`            | nothing                                                            | `yearFraction`, `amortise`, `periodicRate`, `discountedSum`…                                       |
| `@ducatjs/money/excel`              | nothing                                                            | `npv`, `irr`, `pmt`, `fv`, `pv`, `nper`, `rate`…                                                   |
| `@ducatjs/money/format`             | `format`, `formatToParts`                                          | the same                                                                                           |
| `@ducatjs/money/parse`              | nothing                                                            | `parse`, `parseMoney`                                                                              |
| `@ducatjs/money/stripe`             | `toStripe`, `toStripeAmount`                                       | the same, `fromStripe`, `stripeExponent`…                                                          |
| `@ducatjs/money/adyen`              | `toAdyen`                                                          | the same, `fromAdyen`, `adyenExponent`…                                                            |
| `@ducatjs/money/checkout`           | `toCheckout`, `toCheckoutAmount`                                   | the same, `fromCheckout`, `checkoutExponent`…                                                      |
| `@ducatjs/money/paypal`             | `toPayPal`, `toPayPalValue`                                        | the same, `fromPayPal`, `paypalExponent`…                                                          |
| `@ducatjs/money/braintree`          | `toBraintree`                                                      | the same, `fromBraintree`, `braintreeExponent`…                                                    |
| `@ducatjs/money/klarna`             | `toKlarna`                                                         | the same, `fromKlarna`, `klarnaExponent`…                                                          |
| `@ducatjs/money/prisma`             | `toDecimalValue`                                                   | the same, `fromDecimal`, the field helpers                                                         |
| `.../drizzle/pg`, `mysql`, `sqlite` | nothing                                                            | `moneyMinor`, `moneyDecimal`, `moneyJson` Drizzle columns                                          |
| `@ducatjs/money/kysely`             | nothing                                                            | `moneyHelpers`, `setMoney`, `MoneyResultPlugin`                                                    |
| `@ducatjs/money/typeorm`            | nothing                                                            | `minorTransformer`, `decimalTransformer`, `jsonTransformer`                                        |
| `@ducatjs/money/pg`                 | nothing                                                            | `exactTypes`, `moneyTypeSql`, `toNumeric`, composite I/O                                           |
| `@ducatjs/money/fixed`              | nothing                                                            | `Fixed`, `fixed`, `fromScaled`, `isFixed` (without Money)                                          |
| `@ducatjs/money/fixed/money`        | `toFixedPoint`, and `Fixed#toMoney`                                | `/fixed`, plus `moneyToFixed`, `fixedToMoney`                                                      |
| `@ducatjs/money/zod`                | nothing                                                            | `moneySchema`, `moneyJSONSchema` (Zod, an optional peer)                                           |
| `@ducatjs/money/valibot`            | nothing                                                            | `moneySchema`, `moneyJSONSchema` (Valibot, an optional peer)                                       |
| `@ducatjs/money/testing`            | nothing                                                            | matchers, value equality, snapshot serializer                                                      |
| `.../testing/vitest`, `/jest`       | nothing (installs on `expect`)                                     | the same, set up in one import                                                                     |
| `.../testing/arbitraries`           | nothing                                                            | `arbMoney`, `arbCurrency` (fast-check)                                                             |
| `@ducatjs/money/all`                | the methods of every module above                                  | everything except `/convert/fetch` and the database (except `/prisma`), schema and testing entries |
| `@ducatjs/money/fn`                 | nothing                                                            | every operation as a plain function, core and modules                                              |
| `@ducatjs/money/iso`                | nothing (registers every ISO 4217 currency, for `/fn`)             | nothing                                                                                            |
| `@ducatjs/money/iso/EUR`, ...       | nothing (registers that one currency, for `/fn`)                   | nothing                                                                                            |
