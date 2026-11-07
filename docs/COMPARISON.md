# How ducat compares

ducat (`@ducatjs/money`) measured against the money and decimal libraries JavaScript developers actually use, then
compared on design with the best-known money libraries in other languages.

Everything in the JavaScript section is reproducible with the harness in `compare/`: the same correctness vectors,
the same benchmark operations and the same bundle snippet for every library. Library versions are listed below. Where
another library does something ducat doesn't, or does it better, this document says so.

> **Note.** These numbers were measured on ducat's pre-release code in November 2026. The tables come from
> `compare/results` (`pnpm tables` writes them to `compare/RESULTS.md`), and this document is updated from them.

## JavaScript and TypeScript libraries

Libraries tested (npm weekly downloads in parentheses, November 2026):

| library                                                                                                                                                                                                                                        | version                              | what it is                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [dinero.js](https://github.com/dinerojs/dinero.js)                                                                                                                                                                                             | 2.0.2, 1.9.1                         | immutable money with a functional API; number or bigint calculators (943k)                       |
| [currency.js](https://github.com/scurker/currency.js)                                                                                                                                                                                          | 2.0.4                                | float-based amounts with a precision; no currency codes (949k)                                   |
| [js-money](https://github.com/davidkalosi/js-money), [ts-money](https://github.com/macor161/ts-money), [@screeny05/ts-money](https://github.com/screeny05/ts-money)                                                                            | 0.6.3, 0.4.8, 1.2.0                  | Fowler's Money pattern, number minor units (9k, 31k, <1k)                                        |
| [monetra](https://github.com/zugobite/monetra)                                                                                                                                                                                                 | 2.3.0                                | bigint money plus ledger and finance functions (new)                                             |
| [bigint-money](https://github.com/evert/bigint-money)                                                                                                                                                                                          | 2.0.1                                | bigint with 20 fixed fractional digits (4k)                                                      |
| [money-math](https://github.com/ikr/money-math)                                                                                                                                                                                                | 2.6.3                                | arithmetic on `"x.yy"` strings (12k)                                                             |
| [decimal.js](https://github.com/MikeMcl/decimal.js), Prisma's `Decimal`, [big.js](https://github.com/MikeMcl/big.js), [bignumber.js](https://github.com/MikeMcl/bignumber.js), [decimal.js-light](https://github.com/MikeMcl/decimal.js-light) | 10.6.0, 7.10.1, 7.0.1, 11.1.5, 2.5.1 | arbitrary-precision decimals, the usual building blocks for money (decimal.js alone: about 137M) |

### Features

|                                    | ducat                                                                                                                                                                                    | dinero.js 2                   | currency.js    | ts-money family             | monetra                 | bigint-money      | decimal libraries                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------- | --------------------------- | ----------------------- | ----------------- | ---------------------------------------------------- |
| **Representation**                 | integer minor units; JS number while safe, bigint beyond                                                                                                                                 | integer + scale               | float          | number minor units          | bigint minor units      | bigint × 10²⁰     | arbitrary decimal                                    |
| **Currency table**                 | ISO 4217 (2026-09), generated and checked                                                                                                                                                | ISO                           | none           | own table                   | ISO, no 4-decimal codes | none              | none                                                 |
| **Amounts beyond 2⁵³ minor units** | exact                                                                                                                                                                                    | bigint calculator only        | wrong          | wrong                       | exact                   | exact             | exact                                                |
| **Rounding modes**                 | 9 modes, plus `'unnecessary'` to throw                                                                                                                                                   | 8                             | 1              | caller-supplied function    | 6                       | 4                 | 4–9                                                  |
| **Exact allocation and splits**    | yes, 5 remainder strategies, instalments, tranche schedules                                                                                                                              | yes                           | `distribute`   | yes                         | yes (see bugs)          | `allocate(n)`     | hand-rolled                                          |
| **VAT / tax helpers**              | net + tax = gross, exactly                                                                                                                                                               | no                            | no             | no                          | percentages             | no                | hand-rolled                                          |
| **Cash rounding by jurisdiction**  | 34 rules with sources (8 checked against primary sources, the rest secondary)                                                                                                            | no                            | no             | no                          | no                      | no                | no                                                   |
| **Payment processor amounts**      | Stripe, Adyen, Checkout.com, PayPal, Braintree, Klarna                                                                                                                                   | no                            | no             | no                          | no                      | no                | no                                                   |
| **Currency conversion**            | exact rates with metadata; providers (tables, chains, reversed, via a base currency, dated snapshots); ECB parsers and an opt-in fetcher; Stripe and Adyen rates; residuals; a money bag | scaled rates                  | no             | no                          | number rates            | no                | hand-rolled                                          |
| **Fixed-point decimal type**       | `@ducatjs/money/fixed`: currency-free exact decimal on the same engine and rounding as Money                                                                                             | no                            | no             | no                          | no                      | no                | arbitrary-precision decimals rather than fixed point |
| **Mixing currencies**              | compile-time _and_ runtime error                                                                                                                                                         | runtime error                 | not detectable | runtime error               | runtime error           | runtime error     | not detectable                                       |
| **Formatting / parsing**           | Intl; locale-aware parsing                                                                                                                                                               | via a transformer; no parser  | own; lenient   | basic                       | Intl; strings           | basic             | `toFixed`                                            |
| **Default JSON**                   | `{"amount":"12.34","currency":"EUR"}`                                                                                                                                                    | minor units + currency object | number         | minor units, no exponent    | minor units + precision | `["12.34","EUR"]` | `"12.34"`                                            |
| **Database helpers**               | BIGINT, NUMERIC and JSON helpers; Prisma extension                                                                                                                                       | no                            | no             | no                          | no                      | no                | Prisma uses decimal.js                               |
| **Module format**                  | ESM; one package, opt-in subpath modules                                                                                                                                                 | ESM                           | ESM + CJS      | CJS (@screeny05: ESM + CJS) | ESM + CJS               | ESM               | ESM + CJS                                            |

### Correctness: one test battery for every library

41 test vectors, run through a small adapter per library that uses the library's own API as its documentation
shows. A capability the library doesn't have counts as "n/a", never as a failure. Results were identical when run on Node 24,
Bun 1.4 and Deno 2.9.

The vectors cover:

- currencies with 0, 3 and 4 decimals;
- splitting 100.00 three ways, including negative amounts and a single cent;
- 2,000 random allocations that must sum exactly;
- VAT extraction (UK 20%, German 19%);
- half-even and half-up ties, including negative ties;
- float traps (0.1 + 0.2, 0.50 × 1.15, 1.15 × 1.1);
- amounts beyond 2⁵³ minor units, including world GDP and the BIGINT maximum;
- currency mismatches.

| library                   | pass | wrong (silent) | lossy | threw | n/a | no currency (by design) |
| ------------------------- | ---: | -------------: | ----: | ----: | --: | ----------------------: |
| ducat                     |   41 |              0 |     0 |     0 |   0 |                       0 |
| dinero.js 2.0.2           |   30 |              4 |     1 |     0 |   6 |                       0 |
| dinero.js 2.0.2 bigint    |   34 |              0 |     1 |     0 |   6 |                       0 |
| dinero.js 1.9.1           |   28 |              4 |     0 |     0 |   9 |                       0 |
| currency.js 2.0.4         |   16 |              6 |     2 |     0 |  14 |                       3 |
| js-money 0.6.3            |   31 |              6 |     0 |     1 |   3 |                       0 |
| ts-money 0.4.8            |   31 |              7 |     0 |     0 |   3 |                       0 |
| @screeny05/ts-money 1.2.0 |   31 |              7 |     0 |     1 |   2 |                       0 |
| money-math 2.6.3          |   12 |              1 |     2 |     0 |  23 |                       3 |
| monetra 2.3.0             |   34 |              3 |     2 |     0 |   2 |                       0 |
| bigint-money 2.0.1        |   30 |              0 |     0 |     0 |  11 |                       0 |
| big.js 7.0.1              |   22 |              1 |     0 |     0 |  15 |                       3 |
| bignumber.js 11.1.5       |   22 |              1 |     0 |     0 |  15 |                       3 |
| decimal.js 10.6.0         |   22 |              1 |     0 |     0 |  15 |                       3 |
| decimal.js-light 2.5.1    |   22 |              1 |     0 |     0 |  15 |                       3 |
| Prisma.Decimal 7.10.1     |   22 |              1 |     0 |     0 |  15 |                       3 |

"No currency (by design)" counts the currency-mismatch vectors for libraries that have no notion of currency, where
EUR + USD simply adds. The decimal libraries' one wrong result is float input: `0.1 + 0.2` is accepted and keeps the
float's error (`0.30000000000000004`) instead of being rejected.

**Issues found in other libraries** (reported here neutrally; each has a regression test in ducat's suite):

- **monetra 2.3.0:** allocating a negative amount loses minor units: −100.00 split three ways gives −33.33 × 3.
- **@screeny05/ts-money 1.2.0:** `allocate` throws when the amount is smaller than the number of parts (1 cent split three ways).
- **js-money 0.6.3:** `Money.fromDecimal(1.15, 'EUR')` throws, because 1.15 × 100 is 114.99999999999999 in floating
  point.
- **Float-based multiplication** (js-money, ts-money, @screeny05/ts-money): 0.50 × 1.15 rounds to 0.57 instead of
  0.58, even when a correct rounding function is supplied.
- **money-math 2.6.3:** `mul('-0.25', '0.50')` returns `-0.11`; the exact product is −0.125.
- **Number-based libraries above 2⁵³ minor units** (90 trillion in a 2-decimal currency): amounts are silently
  corrupted (e.g. 90,071,992,547,409.93 becomes …409.94).

### Speed

One quiet AMD EPYC Genoa machine (Vultr, Frankfurt; kernel 6.8; CPU steal 0.02%). Each runtime was a separate run
on the same machine. Each cell is nanoseconds per operation over 1,000 values: the median of 5 rounds, with library
order shuffled each round.

| ns/op     |                                                        node 22.11.0 |                                                             bun 1.4.4 |                                                          deno 2.9.8 |
| --------- | ------------------------------------------------------------------: | --------------------------------------------------------------------: | ------------------------------------------------------------------: |
| fromMinor |                          **8.28** (fastest other: dinero.js 2 16.4) |              **8.58** (fastest other: monetra 20.7; dinero.js 2 33.0) |                          **7.86** (fastest other: dinero.js 2 12.9) |
| parse     |                          **43.0** (fastest other: dinero.js 2 63.2) |     **30.1** (fastest other: dinero.js 2 bigint 168; dinero.js 2 174) |                          **29.6** (fastest other: dinero.js 2 61.4) |
| add       |             **11.7** (fastest other: monetra 15.1; dinero.js 2 250) |               **13.4** (fastest other: monetra 19.9; dinero.js 2 327) |             **10.1** (fastest other: monetra 13.2; dinero.js 2 216) |
| mulRatio  |  **19.8** (fastest other: @screeny05/ts-money 164; dinero.js 2 621) |   **29.7** (fastest other: @screeny05/ts-money 45.6; dinero.js 2 707) |              **21.3** (fastest other: monetra 168; dinero.js 2 459) |
| allocate3 |      **50.6** (fastest other: bigint-money 495; dinero.js 2 1.2 µs) | **65.5** (fastest other: @screeny05/ts-money 201; dinero.js 2 1.5 µs) |      **43.3** (fastest other: bigint-money 275; dinero.js 2 1.2 µs) |
| toDecimal |            **33.3** (fastest other: ts-money 80.1; dinero.js 2 477) |              **63.0** (fastest other: js-money 75.9; dinero.js 2 585) | **35.6** (fastest other: @screeny05/ts-money 66.4; dinero.js 2 409) |
| format    |        407 (fastest other: **currency.js 372**; dinero.js 2 1.2 µs) |          284 (fastest other: **currency.js 264**; dinero.js 2 1.2 µs) |        **440** (fastest other: currency.js 442; dinero.js 2 1.2 µs) |
| compare   | **7.67** (fastest other: @screeny05/ts-money 8.00; dinero.js 2 247) |           10.3 (fastest other: **currency.js 7.16**; dinero.js 2 332) | **7.30** (fastest other: @screeny05/ts-money 7.79; dinero.js 2 205) |

Measured on 2026-11-07 on one AMD EPYC Genoa vCPU with Node 22.11, Bun 1.4.4 and Deno 2.9.8, using an earlier ducat build from before the module split; numbers for the current code need a new clean-machine run (compare/runner). Lower is better; the faster of ducat and the fastest other money library is in bold.

That build ran on Node 22.11, below the `engines` requirement of Node 24 for releases.

Where ducat is not fastest:

- **Formatting:** every library spends most of its time inside `Intl.NumberFormat`. currency.js (formatting a float)
  is faster than ducat on Node (372 against 407 ns) and on Bun (264 against 284), and dinero.js 1 is slightly faster
  on both too (393 and 267). On Deno ducat and currency.js are level (440 and 442).
- **Comparing on Bun:** libraries that compare plain numbers are faster: currency.js 7.2, ts-money 7.7, js-money
  8.1, monetra 8.3 and @screeny05/ts-money 9.1 ns, against ducat's 10.3.

### Bundle size

The same program in every library (create an amount, add, multiply, print a decimal string), bundled with esbuild and
minified, then gzipped; sizes in KiB. "Whole package" bundles each library's root entry; for ducat that is the core,
and everything (`@ducatjs/money/all`) is about 18.9 kB gzipped.

| library             | program, min | program, gzip | whole package, min | whole package, gzip |
| ------------------- | -----------: | ------------: | -----------------: | ------------------: |
| currency.js         |       2.8 kB |        1.3 kB |             2.8 kB |              1.3 kB |
| bigint-money        |       3.7 kB |        1.5 kB |             3.7 kB |              1.5 kB |
| dinero.js 2         |       4.6 kB |        1.8 kB |            18.5 kB |              5.0 kB |
| @screeny05/ts-money |       6.0 kB |        2.2 kB |             5.9 kB |              2.2 kB |
| big.js              |       6.8 kB |        2.9 kB |             6.7 kB |              2.9 kB |
| dinero.js 1         |      10.1 kB |        3.2 kB |            10.0 kB |              3.2 kB |
| ducat               |       9.2 kB |        3.7 kB |            12.0 kB |              4.7 kB |
| monetra             |      13.7 kB |        4.5 kB |            37.3 kB |             11.2 kB |
| decimal.js-light    |      13.5 kB |        5.9 kB |            13.5 kB |              5.8 kB |
| money-math          |      23.1 kB |        8.3 kB |            23.1 kB |              8.3 kB |
| bignumber.js        |      19.8 kB |        8.5 kB |            19.7 kB |              8.5 kB |
| js-money            |      28.9 kB |        8.8 kB |            28.8 kB |              8.8 kB |
| decimal.js          |      31.6 kB |       12.6 kB |            31.6 kB |             12.6 kB |
| ts-money            |      91.3 kB |       30.7 kB |            91.3 kB |             30.7 kB |

ducat's figure includes exact decimal-string parsing; dinero.js leaves parsing to the caller, and currency.js parses
into a float.
Everything beyond the core (allocation, tax, conversion, formatting, processors, database helpers) is an opt-in
import and costs nothing unless used.

## Fixed-point decimal libraries

ducat's engine is also available without a currency, as `Fixed` (`@ducatjs/money/fixed`). This section compares it with
the fixed-point and BigInt decimal libraries on the operations they all share: parse, add, multiply and divide rounded to
a scale, round, compare and `toString`, with explicit half-even or half-up rounding. A library without a rounding mode is
marked n/a for that vector, never emulated.

### Correctness (fixed point)

Vectors: ties in both modes and both signs, float traps, values beyond 2⁵³, exact division and scale changes.

| library                     | pass | wrong (silent) | lossy | threw | n/a |
| --------------------------- | ---: | -------------: | ----: | ----: | --: |
| ducat Money                 |   27 |              0 |     0 |     0 |   0 |
| dnum 2.18.1                 |   20 |              0 |     0 |     0 |   7 |
| ethers FixedNumber 6.17.0   |   17 |              3 |     0 |     0 |   7 |
| js-big-decimal 2.2.0        |   27 |              0 |     0 |     0 |   0 |
| bigdecimal.js 1.7.2         |   27 |              0 |     0 |     0 |   0 |
| @formatjs/bigdecimal 0.2.10 |    7 |              0 |     0 |     0 |  20 |
| bigint-money 2.0.1          |   27 |              0 |     0 |     0 |   0 |

ducat is not alone here: js-big-decimal, bigdecimal.js and bigint-money pass all 27, and dnum and @formatjs/bigdecimal
pass every vector they support. The ducat row measures `Money`; a `Fixed` adapter is added with the next run.

### Bundle size (fixed point)

The ducat row here also measures `Money`, not `Fixed`.

| library                                   | program, min | program, gzip | whole package, min | whole package, gzip |
| ----------------------------------------- | -----------: | ------------: | -----------------: | ------------------: |
| dnum                                      |       3.4 kB |        1.5 kB |             7.2 kB |              2.8 kB |
| bigint-money                              |       3.7 kB |        1.5 kB |             3.7 kB |              1.5 kB |
| @formatjs/bigdecimal                      |       8.9 kB |        2.3 kB |             8.9 kB |              2.3 kB |
| js-big-decimal                            |       9.3 kB |        3.0 kB |             9.2 kB |              3.0 kB |
| ethers FixedNumber (import from 'ethers') |       8.5 kB |        3.2 kB |           376.4 kB |            140.8 kB |
| ducat Money                               |       9.2 kB |        3.7 kB |            12.0 kB |              4.7 kB |
| bigdecimal.js                             |      45.9 kB |       11.6 kB |            45.9 kB |             11.6 kB |

### Speed (fixed point)

No clean-machine run of the fixed-point benchmark yet; the next run of `compare/runner` covers it.

## Notable money libraries in other languages

Speed and bundle size don't carry across languages, so this is a design comparison: what each library does
particularly well, and where ducat stands.

| library                                                                                                        | language | noted for                                                                                                                | ducat                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Moneta](https://github.com/JavaMoney/jsr354-ri) (JSR 354, `javax.money`)                                      | Java     | the standard API: pluggable rounding providers, exchange-rate provider chains with rate metadata, composable operators   | rounding modes and cash rounding built in; exact rates with metadata (source, date, type), and providers that chain, reverse and go through a base currency, in `@ducatjs/money/convert` |
| [Joda-Money](https://github.com/JodaOrg/joda-money)                                                            | Java     | separates `Money` (always at the currency's scale) from `BigMoney` (any scale)                                           | one type with an explicit scale; `round()` returns to the currency scale                                                                                                                 |
| [brick/money](https://github.com/brick/money)                                                                  | PHP      | _contexts_ (default, cash, custom scale), exact `RationalMoney` intermediates, `MoneyBag` for mixed currencies           | exact fractions for factors and rates; exact intermediates (`@ducatjs/money/exact`) and a money bag for mixed-currency totals                                                            |
| [moneyphp/money](https://github.com/moneyphp/money)                                                            | PHP      | wide adoption; pluggable calculators; reversed and indirect currency exchanges                                           | ducat chooses number or bigint itself; reversed and indirect (via a base currency) conversion                                                                                            |
| [money](https://github.com/RubyMoney/money) + money-rails                                                      | Ruby     | Rails integration and a long track record                                                                                | Prisma and SQL helpers                                                                                                                                                                   |
| [py-moneyed](https://github.com/py-moneyed/py-moneyed) / django-money                                          | Python   | Django integration on top of Python's `decimal`                                                                          | Prisma and SQL helpers                                                                                                                                                                   |
| [ex_money](https://github.com/kipcole9/money)                                                                  | Elixir   | CLDR-driven formatting and parsing, a Postgres composite type with SQL aggregates                                        | Intl formatting and parsing; Postgres composite type planned                                                                                                                             |
| [bojanz/currency](https://github.com/bojanz/currency), [Rhymond/go-money](https://github.com/Rhymond/go-money) | Go       | CLDR data, a locale-aware formatter and parser                                                                           | Intl formatting and parsing                                                                                                                                                              |
| [rusty-money](https://github.com/varunsrin/rusty_money)                                                        | Rust     | typed currencies at compile time                                                                                         | typed currencies at compile time (TypeScript)                                                                                                                                            |
| [NodaMoney](https://github.com/RemyDuijkeren/NodaMoney)                                                        | .NET     | money context and formatting integration                                                                                 | explicit rounding on every operation, no ambient context                                                                                                                                 |
| [decNumber / libmpdec](https://speleotrove.com/decimal/) (Python's `decimal`)                                  | C        | the General Decimal Arithmetic specification: contexts, and _signals_ (Inexact, Rounded) that can be trapped or recorded | the `'unnecessary'` rounding mode behaves like a trapped Inexact signal; `convertDetailed` reports the rounding residual                                                                 |
| [ICU4C](https://icu.unicode.org/) / CLDR                                                                       | C/C++    | per-currency cash digits and rounding increments                                                                         | 34 jurisdiction-specific cash rules with per-country euro rules; CLDR's cash data is not used yet                                                                                        |
| [GnuCash `gnc-numeric`](https://github.com/Gnucash/gnucash)                                                    | C        | money as exact numerator/denominator pairs                                                                               | exact fractions for factors; exact intermediates (`@ducatjs/money/exact`)                                                                                                                |

Ideas ducat has deliberately not adopted:

- **An ambient or global rounding context** (Python's `decimal`, NodaMoney): JavaScript's async code has no safe
  equivalent, so ducat passes rounding explicitly.
- **Types that round silently after every operation:** drift becomes invisible.
- **IEEE 754 decimal floating point** (Intel's decimal library, C23 `_Decimal`): JavaScript has no native decimal
  type, and a software implementation is slower than integers.

## Reproducing

`compare/` is a separate workspace package with its own dependencies, so the other libraries are never dependencies of
ducat. It holds the adapters, the correctness batteries, the benchmarks, the bundle-size snippets, the clean-machine
runner (`compare/runner/`) and the committed results:

```sh
pnpm install --frozen-lockfile
pnpm compare          # run the correctness batteries and regenerate the tables
pnpm compare:check    # fail if ducat misses a vector or the committed tables are stale
pnpm tables           # regenerate the tables in compare/RESULTS.md from compare/results
```
