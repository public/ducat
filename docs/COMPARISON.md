# How ducat compares

ducat (`@ducatjs/money`) measured against the money and decimal libraries JavaScript developers actually use, then
compared on design with the best-known money libraries in other languages.

Everything in the JavaScript section is reproducible with the harness in `compare/`: the same correctness vectors,
the same benchmark operations and the same bundle snippet for every library. Library versions are listed below. Where
another library does something ducat doesn't, or does it better, this document says so.

> **Note.** These numbers were measured on the ducat 0.2.0 release candidate (commit ea9160b) in November 2026. The tables come from
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

Quiet AMD EPYC Genoa machines (Vultr, Frankfurt; kernel 6.8; CPU steal 0.02%). Each runtime was a separate run; Node
and Bun ran on the same machine and Deno on a second one of the same plan. Each cell is nanoseconds per operation over 1,000 values: the median of 5 rounds, with library
order shuffled each round.

| ns/op     |                                                       node 24.22.2 |                                                             bun 1.4.4 |                                                            deno 2.9.8 |
| --------- | -----------------------------------------------------------------: | --------------------------------------------------------------------: | --------------------------------------------------------------------: |
| fromMinor |                         **9.29** (fastest other: dinero.js 2 14.5) |              **9.22** (fastest other: monetra 24.4; dinero.js 2 35.6) |              **8.42** (fastest other: monetra 26.4; dinero.js 2 86.6) |
| parse     |                         **30.9** (fastest other: dinero.js 2 62.1) |     **34.8** (fastest other: dinero.js 2 bigint 135; dinero.js 2 150) |                             **29.3** (fastest other: dinero.js 2 134) |
| add       |            **11.5** (fastest other: monetra 14.6; dinero.js 2 200) |               **11.1** (fastest other: monetra 19.6; dinero.js 2 308) |               **9.44** (fastest other: monetra 12.3; dinero.js 2 321) |
| mulRatio  | **24.0** (fastest other: @screeny05/ts-money 151; dinero.js 2 497) |   **29.0** (fastest other: @screeny05/ts-money 68.0; dinero.js 2 757) | **20.8** (fastest other: @screeny05/ts-money 155; dinero.js 2 1.1 µs) |
| allocate3 |     **48.6** (fastest other: bigint-money 457; dinero.js 2 1.3 µs) | **65.4** (fastest other: @screeny05/ts-money 274; dinero.js 2 1.6 µs) |        **41.3** (fastest other: bigint-money 270; dinero.js 2 2.0 µs) |
| toDecimal |           **34.7** (fastest other: ts-money 58.6; dinero.js 2 429) |              **55.5** (fastest other: ts-money 74.3; dinero.js 2 580) |   **30.6** (fastest other: @screeny05/ts-money 63.5; dinero.js 2 370) |
| format    |       413 (fastest other: **currency.js 379**; dinero.js 2 1.1 µs) |          **268** (fastest other: currency.js 274; dinero.js 2 1.2 µs) |          398 (fastest other: **currency.js 386**; dinero.js 2 1.0 µs) |
| compare   |           **7.49** (fastest other: ts-money 8.06; dinero.js 2 202) |           10.3 (fastest other: **currency.js 6.68**; dinero.js 2 324) |   **6.88** (fastest other: @screeny05/ts-money 7.49; dinero.js 2 171) |

Measured on 2026-11-08 on one-vCPU AMD EPYC Genoa machines (Node 24.22.2 and Bun 1.4.4 on one, Deno 2.9.8 on a second of the same plan), on the ducat 0.2.0 release candidate (commit ea9160b). Lower is better; the faster of ducat and the fastest other money library is in bold.

The ducat column measures its methods API. Where ducat is not fastest (every cell where another library measured
faster):

- **Formatting:** every library spends most of its time inside `Intl.NumberFormat`. currency.js (formatting a float)
  and dinero.js 1 are faster on Node (379 and 397 ns against 413, 8% and 4%), and currency.js on Deno (386 against 398,
  3%). On Bun, ducat and currency.js are level (268 and 274 ns, 2.1%).
- **Comparing on Bun:** libraries that compare plain numbers are faster: currency.js 6.7, js-money 8.0, ts-money 8.1,
  @screeny05/ts-money 8.5 and monetra 8.6 ns, against ducat's 10.3. On Node and Deno ducat is ahead (7.49 against
  ts-money's 8.06, and 6.88 against @screeny05/ts-money's 7.49).

dinero.js 2 has measured unexpectedly slow on Deno in the last two runs, up to 6× slower than in the 0.1.0
release-candidate run while the other libraries got about 12% faster on average; its Deno cells are shown but not used
in the README's ranges. Differences within 2.5% are called level. The parse row was measured before `parse` started checking where group separators are.

### Bundle size

The same program in every library (create an amount, add, multiply, print a decimal string), bundled with esbuild and
minified, then gzipped; sizes in KiB. "Whole package" bundles each library's root entry; for ducat that is the core,
and everything (`@ducatjs/money/all`) is about 27.6 KiB gzipped.

| library             | program, min | program, gzip | whole package, min | whole package, gzip |
| ------------------- | -----------: | ------------: | -----------------: | ------------------: |
| currency.js         |      2.8 KiB |       1.3 KiB |            2.8 KiB |             1.3 KiB |
| bigint-money        |      3.7 KiB |       1.5 KiB |            3.7 KiB |             1.5 KiB |
| dinero.js 2         |      4.6 KiB |       1.8 KiB |           18.5 KiB |             5.0 KiB |
| @screeny05/ts-money |      6.0 KiB |       2.2 KiB |            5.9 KiB |             2.2 KiB |
| big.js              |      6.8 KiB |       2.9 KiB |            6.7 KiB |             2.9 KiB |
| dinero.js 1         |     10.1 KiB |       3.2 KiB |           10.0 KiB |             3.2 KiB |
| ducat               |     10.4 KiB |       4.0 KiB |           12.9 KiB |             4.9 KiB |
| monetra             |     13.7 KiB |       4.5 KiB |           37.3 KiB |            11.2 KiB |
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

The ducat rows measure the same program with `Money` and with `Fixed`. `Fixed` is larger because it currently loads
Money's internals and the ISO table too.

| library                                   | program, min | program, gzip | whole package, min | whole package, gzip |
| ----------------------------------------- | -----------: | ------------: | -----------------: | ------------------: |
| dnum                                      |      3.4 KiB |       1.5 KiB |            7.2 KiB |             2.8 KiB |
| bigint-money                              |      3.7 KiB |       1.5 KiB |            3.7 KiB |             1.5 KiB |
| @formatjs/bigdecimal                      |      8.9 KiB |       2.3 KiB |            8.9 KiB |             2.3 KiB |
| js-big-decimal                            |      9.3 KiB |       3.0 KiB |            9.2 KiB |             3.0 KiB |
| ethers FixedNumber (import from 'ethers') |      8.5 KiB |       3.2 KiB |          376.4 KiB |           140.8 KiB |
| ducat Money                               |     10.4 KiB |       4.0 KiB |           12.9 KiB |             4.9 KiB |
| ducat Fixed                               |     14.8 KiB |       5.2 KiB |           15.1 KiB |             5.2 KiB |
| bigdecimal.js                             |     45.9 KiB |      11.6 KiB |           45.9 KiB |            11.6 KiB |

### Speed (fixed point)

Same machines and method as above; multiply by 1.075 and divide by 3, rounded half away from zero (`halfExpand`) to 2 decimals. Node 24.22.2
shown; Bun and Deno are in `compare/RESULTS.md`.

| ns/op                       |  parse |    add | multiply |  divide | compare | toString |
| --------------------------- | -----: | -----: | -------: | ------: | ------: | -------: |
| ducat Money                 |    133 |   10.2 |     78.3 |    29.9 |    7.14 |     31.1 |
| ducat Fixed                 |   32.0 |   11.5 |     30.1 |    72.3 |    7.71 |     30.9 |
| dnum 2.18.1                 |    339 |   26.0 |      297 |     253 |    21.5 |      273 |
| ethers FixedNumber 6.17.0   | 2.3 µs | 1.7 µs |   5.8 µs |  5.5 µs |    9.15 |     5.10 |
| js-big-decimal 2.2.0        |   63.3 | 1.8 µs |   1.6 µs | 37.7 µs |     671 |     4.90 |
| bigdecimal.js 1.7.2         |   46.3 |   15.6 |     77.8 |    59.7 |    10.0 |     40.2 |
| @formatjs/bigdecimal 0.2.10 |    122 |   33.5 |      n/a |     n/a |    24.4 |     52.6 |
| bigint-money 2.0.1          |    545 |   46.7 |   3.0 µs |  2.8 µs |    14.3 |      508 |

**`Fixed` is the fastest fixed-point library on parse and multiply on every runtime**, and ahead of every other
library on add and compare (on Bun, level with bigdecimal.js on add: 13.4 against 13.3 ns). Every cell where another
library measured faster than `Fixed`:

- **divide by 3:** bigdecimal.js on every runtime (Node 60 against 72 ns; Bun 39 against 154; Deno 46 against 62).
  `Money` divides faster than both (Node 30, Bun 27, Deno 25 ns): its integer-divisor fast path is not yet used by
  `Fixed`.
- **toString:** js-big-decimal and ethers are fastest everywhere (about 5 ns), against `Fixed`'s 31 on Node and Deno
  and 81 on Bun.

The `Money` row parses currency amounts, so it also checks the currency's scale: bigdecimal.js and js-big-decimal
parse faster than it on every runtime (Node 46 and 63 ns against 133), and @formatjs/bigdecimal on Node and Deno (122
against 133, 115 against 127). bigdecimal.js also multiplies faster than `Money` on Bun (59 against 71 ns) and Deno
(58 against 83), and they are level on Node (78 and 78). js-big-decimal and ethers also print faster than `Money` on
every runtime (4.6–5.1 ns against 31.1 on Node, 73.7 on Bun and 31.1 on Deno). The `Money` parse numbers were
measured before `parse` started checking where group separators are; `Fixed`'s parse (`fixed('…')`) is not affected.

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
