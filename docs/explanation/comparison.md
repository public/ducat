# How ducat compares

ducat (`@ducatjs/money`) measured against the money and decimal libraries JavaScript developers actually use, then
compared on design with the best-known money libraries in other languages.

Everything in the JavaScript section is reproducible with the harness in `compare/`: the same correctness vectors,
the same benchmark operations and the same bundle snippet for every library. Library versions are listed below. Where
another library does something ducat doesn't, or does it better, this document says so.

> **This is the canonical comparison.** The release process regenerates its numbers here, in `docs/explanation/comparison.md`; `docs/COMPARISON.md` is only a stub that links to it.
>
> **Note.** These numbers were measured on ducat at commit 01753e5 (the 0.3.0 release candidate) in November 2026. The tables come from
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

One quiet AMD EPYC Genoa machine (Vultr, Frankfurt; kernel 6.8; CPU steal 0.01%). Each runtime was a separate run on
the same machine. Each cell is nanoseconds per operation over 1,000 values: the median of 5 rounds, with library
order shuffled each round.

| ns/op     |                                                        node 24.22.2 |                                                             bun 1.4.4 |                                                            deno 2.9.8 |
| --------- | ------------------------------------------------------------------: | --------------------------------------------------------------------: | --------------------------------------------------------------------: |
| fromMinor |                          **8.68** (fastest other: dinero.js 2 13.7) |              **11.6** (fastest other: monetra 20.0; dinero.js 2 30.7) |              **7.32** (fastest other: monetra 26.5; dinero.js 2 89.1) |
| parse     |                          **29.7** (fastest other: dinero.js 2 63.2) |     **31.7** (fastest other: dinero.js 2 bigint 123; dinero.js 2 137) |                             **27.4** (fastest other: dinero.js 2 146) |
| add       |             **10.7** (fastest other: monetra 13.9; dinero.js 2 189) |               **12.2** (fastest other: monetra 19.1; dinero.js 2 296) |               **9.74** (fastest other: monetra 12.9; dinero.js 2 335) |
| mulRatio  |  **24.1** (fastest other: @screeny05/ts-money 143; dinero.js 2 459) |   **28.3** (fastest other: @screeny05/ts-money 57.0; dinero.js 2 741) | **21.3** (fastest other: @screeny05/ts-money 159; dinero.js 2 1.1 µs) |
| allocate3 |      **46.7** (fastest other: bigint-money 419; dinero.js 2 1.1 µs) | **60.1** (fastest other: @screeny05/ts-money 265; dinero.js 2 1.6 µs) |        **43.4** (fastest other: bigint-money 265; dinero.js 2 2.0 µs) |
| toDecimal | **33.7** (fastest other: @screeny05/ts-money 57.6; dinero.js 2 435) |              **49.9** (fastest other: ts-money 70.9; dinero.js 2 559) |              **33.1** (fastest other: ts-money 63.4; dinero.js 2 367) |
| format    |        375 (fastest other: **currency.js 371**; dinero.js 2 1.1 µs) |          **266** (fastest other: currency.js 267; dinero.js 2 1.2 µs) |          411 (fastest other: **currency.js 389**; dinero.js 2 1.0 µs) |
| compare   |         **7.05** (fastest other: currency.js 7.46; dinero.js 2 194) |           9.90 (fastest other: **currency.js 6.50**; dinero.js 2 307) |   **6.99** (fastest other: @screeny05/ts-money 7.39; dinero.js 2 174) |

Measured on 2026-11-09 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, on ducat at commit 01753e5 (the 0.3.0 release candidate). Lower is better; the faster of ducat and the fastest other money library is in bold.

The ducat column measures its methods API. The parse row is decimal-string construction (`money('12.34', 'EUR')`),
not the locale `parse()`. Where ducat is not fastest (every cell where another library measured
faster):

- **Formatting:** every library spends most of its time inside `Intl.NumberFormat`. currency.js (formatting a float)
  measures faster on Node (371 ns against 375, level) and Deno (389 against 411, 6%); on Bun ducat is level with it
  (266 against 267). dinero.js 1 is level with ducat everywhere (378, 272 and 409 ns).
- **Comparing on Bun:** libraries that compare plain numbers are faster: currency.js 6.5, js-money 7.7, ts-money 7.7,
  and @screeny05/ts-money and monetra 8.2 ns, against ducat's 9.9 with methods (7.9 with the functions). Bun's compare
  cells move a lot between runs: ducat's methods measured 7.9 ns in the previous run, and nothing this release changed
  is on that path. On Node and Deno ducat is ahead (7.05 against currency.js's 7.46, and 6.99 against
  @screeny05/ts-money's 7.39).

Differences within 2.5% are called level.

### Bundle size

The same program in every library (create an amount, add, multiply, print a decimal string), bundled with esbuild and
minified, then gzipped; sizes in KiB. "Whole package" bundles each library's root entry; for ducat that is the core,
and everything (`@ducatjs/money/all`) is about 50.5 KiB gzipped.

| library             | program, min | program, gzip | whole package, min | whole package, gzip |
| ------------------- | -----------: | ------------: | -----------------: | ------------------: |
| currency.js         |      2.8 KiB |       1.3 KiB |            2.8 KiB |             1.3 KiB |
| bigint-money        |      3.7 KiB |       1.5 KiB |            3.7 KiB |             1.5 KiB |
| dinero.js 2         |      4.6 KiB |       1.8 KiB |           18.5 KiB |             5.0 KiB |
| @screeny05/ts-money |      6.0 KiB |       2.2 KiB |            5.9 KiB |             2.2 KiB |
| big.js              |      6.8 KiB |       2.9 KiB |            6.7 KiB |             2.9 KiB |
| dinero.js 1         |     10.1 KiB |       3.2 KiB |           10.0 KiB |             3.2 KiB |
| monetra             |     13.7 KiB |       4.5 KiB |           37.3 KiB |            11.2 KiB |
| ducat               |     12.0 KiB |       4.5 KiB |           14.7 KiB |             5.5 KiB |
| decimal.js-light    |     13.5 KiB |       5.9 KiB |           13.5 KiB |             5.8 KiB |
| money-math          |     23.1 KiB |       8.3 KiB |           23.1 KiB |             8.3 KiB |
| bignumber.js        |     19.8 KiB |       8.5 KiB |           19.7 KiB |             8.5 KiB |
| js-money            |     28.9 KiB |       8.8 KiB |           28.8 KiB |             8.8 KiB |
| decimal.js          |     31.6 KiB |      12.6 KiB |           31.6 KiB |            12.6 KiB |
| ts-money            |     91.3 KiB |      30.7 KiB |           91.3 KiB |            30.7 KiB |

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
| ducat Money                 |   28 |              0 |     0 |     0 |   0 |
| ducat Fixed                 |   28 |              0 |     0 |     0 |   0 |
| dnum 2.18.1                 |   21 |              0 |     0 |     0 |   7 |
| ethers FixedNumber 6.17.0   |   18 |              3 |     0 |     0 |   7 |
| js-big-decimal 2.2.0        |   28 |              0 |     0 |     0 |   0 |
| bigdecimal.js 1.7.2         |   28 |              0 |     0 |     0 |   0 |
| @formatjs/bigdecimal 0.2.10 |    8 |              0 |     0 |     0 |  20 |
| bigint-money 2.0.1          |   28 |              0 |     0 |     0 |   0 |

ducat is not alone here: js-big-decimal, bigdecimal.js and bigint-money pass all 28, and dnum and @formatjs/bigdecimal
pass every vector they support. Both ducat rows pass all 28: `Money` with a currency, and `Fixed` without one.

### Bundle size (fixed point)

The ducat rows measure the same program with `Money` and with `Fixed`. `@ducatjs/money/fixed` loads neither the Money
class nor the ISO table, so the `Fixed` program is the smaller one.

| library                                   | program, min | program, gzip | whole package, min | whole package, gzip |
| ----------------------------------------- | -----------: | ------------: | -----------------: | ------------------: |
| dnum                                      |      3.4 KiB |       1.5 KiB |            7.2 KiB |             2.8 KiB |
| bigint-money                              |      3.7 KiB |       1.5 KiB |            3.7 KiB |             1.5 KiB |
| @formatjs/bigdecimal                      |      8.9 KiB |       2.3 KiB |            8.9 KiB |             2.3 KiB |
| js-big-decimal                            |      9.3 KiB |       3.0 KiB |            9.2 KiB |             3.0 KiB |
| ethers FixedNumber (import from 'ethers') |      8.5 KiB |       3.2 KiB |          376.4 KiB |           140.8 KiB |
| ducat Fixed                               |      9.3 KiB |       3.5 KiB |            9.6 KiB |             3.5 KiB |
| ducat Money                               |     12.0 KiB |       4.5 KiB |           14.7 KiB |             5.5 KiB |
| bigdecimal.js                             |     45.9 KiB |      11.6 KiB |           45.9 KiB |            11.6 KiB |

### Speed (fixed point)

Same machine and method as above; multiply by 1.075 and divide by 3, rounded half away from zero (`halfExpand`) to 2 decimals. Node 24.22.2
shown; Bun and Deno are in `compare/RESULTS.md`.

| ns/op                       |  parse |    add | multiply |  divide | compare | toString |
| --------------------------- | -----: | -----: | -------: | ------: | ------: | -------: |
| ducat Money                 |    123 |   9.98 |     79.4 |    26.2 |    7.01 |     30.3 |
| ducat Fixed                 |   29.6 |   10.9 |     26.6 |    28.0 |    7.43 |     29.7 |
| dnum 2.18.1                 |    340 |   23.7 |      313 |     253 |    20.0 |      267 |
| ethers FixedNumber 6.17.0   | 2.2 µs | 1.6 µs |   5.5 µs |  5.3 µs |    8.99 |     5.00 |
| js-big-decimal 2.2.0        |   58.9 | 1.7 µs |   1.5 µs | 34.8 µs |     653 |     4.56 |
| bigdecimal.js 1.7.2         |   44.9 |   15.2 |     72.4 |    56.8 |    8.92 |     39.2 |
| @formatjs/bigdecimal 0.2.10 |    120 |   32.8 |      n/a |     n/a |    22.1 |     48.2 |
| bigint-money 2.0.1          |    532 |   46.4 |   2.8 µs |  2.6 µs |    13.6 |      472 |

**`Fixed` is the fastest fixed-point library on parse, multiply, divide and compare on every runtime**, and on add on
Node and Deno. Every cell where another library measured faster than `Fixed`, or level with it:

- **add on Bun:** bigdecimal.js is 3% faster (11.9 against 12.3 ns).
- **toString:** js-big-decimal and ethers are fastest everywhere (about 4.4–5.2 ns), against `Fixed`'s 30 on Node, 31
  on Deno and 56 on Bun.

`Fixed` divides by 3 in 28, 28 and 25 ns on Node, Bun and Deno, against bigdecimal.js's 57, 35 and 49, using the same
integer-divisor fast path as `Money` (26, 25 and 23 ns).

The `Money` row parses currency amounts, so it also checks the currency's scale: bigdecimal.js and js-big-decimal
parse faster than it on every runtime (Node 45 and 59 ns against 123), and @formatjs/bigdecimal on Deno (122 against
134; on Node they are level, 120 and 123). bigdecimal.js also multiplies faster than `Money` on every runtime (Node 72
against 79 ns, Bun 50 against 53, Deno 58 against 79), and compares faster on Bun (8.30 against 8.53, 3%).
js-big-decimal and ethers also print faster than `Money` on every runtime (4.4–5.2 ns against 30.3 on Node, 60.7 on
Bun and 31.1 on Deno).

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
