# How ducat compares

ducat (`@ducatjs/money`) measured against the money and decimal libraries JavaScript developers actually use, then
compared on design with the best-known money libraries in other languages.

Everything in the JavaScript section is reproducible with the harness in [`compare/`](../compare): the same
correctness vectors, the same benchmark operations and the same bundle snippet for every library. Versions and
dates are listed with each table. Where another library does something ducat doesn't, or does it better, this
document says so.

> **Note.** These numbers were measured on ducat's pre-release code (November 2026). The size figures in particular
> are being reduced; the tables are regenerated from `compare/results` for each release.

## JavaScript and TypeScript libraries

Libraries tested (npm weekly downloads in parentheses, November 2026):

| library | version | what it is |
|---|---|---|
| [dinero.js](https://github.com/dinerojs/dinero.js) | 2.0.2, 1.9.1 | immutable money with a functional API; number or bigint calculators (943k) |
| [currency.js](https://github.com/scurker/currency.js) | 2.0.4 | float-based amounts with a precision; no currency codes (949k) |
| [js-money](https://github.com/davidkalosi/js-money), [ts-money](https://github.com/macor161/ts-money), [@screeny05/ts-money](https://github.com/screeny05/ts-money) | 0.6.3, 0.4.8, 1.2.0 | Fowler's Money pattern, number minor units (9k, 31k, <1k) |
| [monetra](https://github.com/zugobite/monetra) | 2.3.0 | bigint money plus ledger and finance functions (new) |
| [bigint-money](https://github.com/evert/bigint-money) | 2.0.1 | bigint with 20 fixed fractional digits (4k) |
| [money-math](https://github.com/ikr/money-math) | 2.6.3 | arithmetic on `"x.yy"` strings (12k) |
| [decimal.js](https://github.com/MikeMcl/decimal.js), Prisma's `Decimal`, [big.js](https://github.com/MikeMcl/big.js), [bignumber.js](https://github.com/MikeMcl/bignumber.js), [decimal.js-light](https://github.com/MikeMcl/decimal.js-light) | 10.6.0, 7.10.1, 7.0.1, 11.1.5, 2.5.1 | arbitrary-precision decimals, the usual building blocks for money (tens of millions) |

### Features

| | ducat | dinero.js 2 | currency.js | ts-money family | monetra | bigint-money | decimal libraries |
|---|---|---|---|---|---|---|---|
| **Representation** | integer minor units; JS number while safe, bigint beyond | integer + scale | float | number minor units | bigint minor units | bigint × 10²⁰ | arbitrary decimal |
| **Currency table** | ISO 4217 (2026-09), generated and checked | ISO | none | own table | ISO, no 4-decimal codes | none | none |
| **Amounts beyond 2⁵³ minor units** | exact | bigint calculator only | wrong | wrong | exact | exact | exact |
| **Rounding modes** | 10, or throw | 8 | 1 | caller-supplied function | 6 | 4 | 4–9 |
| **Exact allocation and splits** | yes, 5 remainder strategies, instalments, tranche schedules | yes | `distribute` | yes | yes (see bugs) | `allocate(n)` | hand-rolled |
| **VAT / tax helpers** | net + tax = gross, exactly | no | no | no | percentages | no | hand-rolled |
| **Cash rounding by jurisdiction** | 35 rules, each sourced | no | no | no | no | no | no |
| **Payment processor amounts** | Stripe, Adyen, Checkout.com, PayPal, Braintree, Klarna | no | no | no | no | no | no |
| **Currency conversion** | exact decimal-string rates, typed pairs | scaled rates | no | no | number rates | no | hand-rolled |
| **Mixing currencies** | compile-time *and* runtime error | runtime error | not detectable | runtime error | runtime error | runtime error | not detectable |
| **Formatting / parsing** | Intl; locale-aware parsing | via a transformer; no parser | own; lenient | basic | Intl; strings | basic | `toFixed` |
| **Default JSON** | `{"amount":"12.34","currency":"EUR"}` | minor units + currency object | number | minor units, no exponent | minor units + precision | `["12.34","EUR"]` | `"12.34"` |
| **Database helpers** | BIGINT, NUMERIC and JSON helpers; Prisma extension | no | no | no | no | no | Prisma uses decimal.js |
| **Module format** | ESM; one package, opt-in subpath modules | ESM | ESM + CJS | CJS | ESM + CJS | ESM | ESM + CJS |

### Correctness: one test battery for every library

41 test vectors, run through a small adapter per library that uses the library's own API as its documentation
shows. A capability the library doesn't have counts as "n/a", never as a failure. Results are identical on Node 22,
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

| library | pass | wrong value returned silently | accepted but lossy | threw unexpectedly | n/a |
|---|--:|--:|--:|--:|--:|
| **ducat** | **41** | 0 | 0 | 0 | 0 |
| dinero.js 2 (bigint calculator) | 34 | 0 | 1 | 0 | 6 |
| monetra | 34 | 3 | 2 | 0 | 2 |
| js-money | 31 | 6 | 0 | 1 | 3 |
| ts-money | 31 | 7 | 0 | 0 | 3 |
| @screeny05/ts-money | 31 | 7 | 0 | 1 | 2 |
| dinero.js 2 (number calculator) | 30 | 4 | 1 | 0 | 6 |
| bigint-money | 30 | 0 | 0 | 0 | 11 |
| dinero.js 1 | 28 | 4 | 0 | 0 | 9 |
| big.js, bignumber.js, decimal.js, decimal.js-light, Prisma `Decimal` | 21 | 3 | 2 | 0 | 15 |
| currency.js | 16 | 9 | 2 | 0 | 14 |
| money-math | 9 | 3 | 2 | 0 | 27 |

The decimal libraries' three "wrong" results are the currency-mismatch vectors: they have no notion of currency, so
EUR + USD simply adds.

**Issues found in other libraries** (reported here neutrally; each has a regression test in ducat's suite):
- **monetra 2.3.0:** allocating a negative amount loses minor units: −100.00 split three ways gives −33.33 × 3.
- **@screeny05/ts-money 1.2.0:** `allocate` throws when the amount is smaller than the number of parts (1 or 2 cents
  split three ways).
- **js-money 0.6.3:** `Money.fromDecimal(1.15, 'EUR')` throws, because 1.15 × 100 is 114.99999999999999 in floating
  point.
- **Float-based multiplication** (js-money, ts-money, currency.js, dinero.js 1): 0.50 × 1.15 rounds to 0.57 instead
  of 0.58, even when a correct rounding function is supplied.
- **Number-based libraries above 2⁵³ minor units** (90 trillion in a 2-decimal currency): amounts are silently
  corrupted (e.g. 90,071,992,547,409.93 becomes …409.94).

### Speed

One quiet AMD EPYC Genoa machine (Vultr, Frankfurt; kernel 6.8; CPU steal 0.02%). Each runtime was a separate run
on the same machine. Each cell is nanoseconds per operation over 1,000 values: the median of 5 rounds, with library
order shuffled each round. Lower is better.

| ns/op | ducat (Node 22 / Bun 1.4 / Deno 2.9) | fastest other library (Node) | dinero.js 2 (Node) |
|---|--:|---|--:|
| create from minor units | 8.3 / 8.6 / 7.9 | dinero.js 2: 16 | 16 |
| parse `"12345.67"` | 43 / 30 / 30 | dinero.js 2: 63 (no parser; minor units passed in) | 63 |
| add | 12 / 13 / 10 | monetra: 15 | 250 |
| multiply by 1.075, half-even | 20 / 30 / 21 | @screeny05/ts-money: 164 (float) | 621 |
| allocate into 3 | 51 / 66 / 43 | bigint-money: 495 | 1,200 |
| to decimal string | 33 / 63 / 36 | ts-money: 80 | 477 |
| format with Intl (en-US) | 407 / 284 / 440 | currency.js: 372 (float) | 1,200 |
| compare | 7.7 / 10 / 7.3 | @screeny05/ts-money: 8.0 | 247 |

ducat is fastest on every operation except formatting, where all libraries spend most of their time inside
`Intl.NumberFormat` and currency.js (formatting a float) is within 10%. On Bun, currency.js also compares slightly
faster (7.2 ns), because it compares floats.

### Bundle size

The same program in every library (create an amount, add, multiply, print a decimal string), bundled with esbuild,
minified and gzipped.

| library | gzipped |
|---|--:|
| currency.js | 1.4 kB |
| bigint-money | 1.6 kB |
| dinero.js 2 | 1.9 kB |
| @screeny05/ts-money | 2.2 kB |
| big.js | 3.0 kB |
| dinero.js 1 | 3.3 kB |
| **ducat** | **3.7 kB** (being reduced; target ≤ 2 kB) |
| monetra | 4.6 kB |
| decimal.js-light | 6.0 kB |
| bignumber.js | 8.7 kB |
| js-money | 9.0 kB |
| decimal.js | 12.9 kB |
| ts-money | 31.4 kB (bundles lodash) |

ducat's figure includes exact decimal-string parsing, which dinero.js and currency.js leave to the caller.
Everything beyond the core (allocation, tax, conversion, formatting, processors, database helpers) is an opt-in
import and costs nothing unless used.

## Notable money libraries in other languages

Speed and bundle size don't carry across languages, so this is a design comparison: what each library does
particularly well, and where ducat stands.

| library | language | noted for | ducat |
|---|---|---|---|
| [Moneta](https://github.com/JavaMoney/jsr354-ri) (JSR 354, `javax.money`) | Java | the standard API: pluggable rounding providers, exchange-rate provider chains with rate metadata, composable operators | rounding modes and cash rounding built in; rate providers and rate metadata planned in `@ducatjs/money/convert` |
| [Joda-Money](https://github.com/JodaOrg/joda-money) | Java | separates `Money` (always at the currency's scale) from `BigMoney` (any scale) | one type with an explicit scale; `round()` returns to the currency scale |
| [brick/money](https://github.com/brick/money) | PHP | *contexts* (default, cash, custom scale), exact `RationalMoney` intermediates, `MoneyBag` for mixed currencies | exact fractions for factors and rates; exact intermediates (`@ducatjs/money/exact`) and a money bag planned |
| [moneyphp/money](https://github.com/moneyphp/money) | PHP | wide adoption; pluggable calculators; reversed and indirect currency exchanges | ducat chooses number or bigint itself; indirect conversion planned |
| [money](https://github.com/RubyMoney/money) + money-rails | Ruby | Rails integration and a long track record | Prisma and SQL helpers |
| [py-moneyed](https://github.com/py-moneyed/py-moneyed) / django-money | Python | Django integration on top of Python's `decimal` | Prisma and SQL helpers |
| [ex_money](https://github.com/kipcole9/money) | Elixir | CLDR-driven formatting and parsing, a Postgres composite type with SQL aggregates | Intl formatting and parsing; Postgres composite type planned |
| [bojanz/currency](https://github.com/bojanz/currency), [Rhymond/go-money](https://github.com/Rhymond/go-money) | Go | CLDR data, a locale-aware formatter and parser | Intl formatting and parsing |
| [rusty-money](https://github.com/varunsrin/rusty_money) | Rust | typed currencies at compile time | typed currencies at compile time (TypeScript) |
| [NodaMoney](https://github.com/RemyDuijkeren/NodaMoney) | .NET | money context and formatting integration | explicit rounding on every operation, no ambient context |
| [decNumber / libmpdec](https://speleotrove.com/decimal/) (Python's `decimal`) | C | the General Decimal Arithmetic specification: contexts, and *signals* (Inexact, Rounded) that can be trapped or recorded | the `'unnecessary'` rounding mode behaves like a trapped Inexact signal; reporting the rounding residual is planned |
| [ICU4C](https://icu.unicode.org/) / CLDR | C/C++ | per-currency cash digits and rounding increments | 35 jurisdiction-specific cash rules; CLDR's data is used as a cross-check |
| [GnuCash `gnc-numeric`](https://github.com/Gnucash/gnucash) | C | money as exact numerator/denominator pairs | exact fractions for factors; exact intermediates planned |

Ideas ducat has deliberately not adopted:
- **An ambient or global rounding context** (Python's `decimal`, NodaMoney): JavaScript's async code has no safe
  equivalent, so ducat passes rounding explicitly.
- **Types that round silently after every operation:** drift becomes invisible.
- **IEEE 754 decimal floating point** (Intel's decimal library, C23 `_Decimal`): JavaScript has no native decimal
  type, and a software implementation is slower than integers.

## Reproducing

`compare/` contains the adapters, the battery, the benchmark, the bundle-size snippets and the result files, with
its own `package.json` (the other libraries are never dependencies of ducat):

```sh
cd compare
pnpm install --frozen-lockfile
pnpm battery      # correctness, on Node; also runs under bun and deno
pnpm bench        # speed (indicative on a laptop; see payload/ for the clean-machine runner)
pnpm sizes        # bundle sizes
pnpm tables       # regenerates the tables in this document from results/
```
