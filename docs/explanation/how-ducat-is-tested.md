# How ducat is tested

This page describes the suites that keep ducat correct, fast and small: what each runs and what it covers. What is proved rather than tested is in [What is proved](proofs.md), and how ducat compares with other libraries is in [How ducat compares](comparison.md).

## Tests

`pnpm test` runs the vitest suite.

- Unit tests use real-world vectors:
  - the `java.math.RoundingMode` table for all modes
  - UK VAT 1/6 extraction, German 19% and 7% VAT
  - the HMRC 9.99 case, the classic `2.675` float trap
  - the allocation splits from Fowler and dinero
  - Stripe and Adyen doc examples, the statutory cash-rounding thresholds for SE, NO, DK, HU and CA
  - Intl output for de, fr, ja, ar and en-IN
- fast-check property tests cover:
  - `divideAndRound` against an independent floor-based bigint oracle over the full safe range, including float-quotient edge cases
  - rounding-mode invariants (floor ≤ x ≤ ceil, half modes within ½)
  - add associativity, commutativity and identity, and agreement with bigint arithmetic
  - the number-iff-safe representation invariant
  - decimal, JSON and minor-unit round trips
  - multiply against exact rationals
  - allocation: sums are exact, each part is within one unit of its ideal share, results are deterministic, and largest-remainder order holds
  - instalment sums, tax breakdowns that add up
  - `parse(format(x))` across 14 locales
  - the Intl hand-off being bit-identical
- Independent oracles, generated offline and committed as vectors of the conformance suite (below):
  - The Lean models whose properties are proved: allocation, instalments, chunks, schedules, rounding to an increment, XNPV and XIRR (`proofs/Oracle.lean`, written by `pnpm gen:kernel`; `pnpm gen:check` checks the files match the proofs).
  - Python's `decimal` for rounding and `fractions` for `/finance`, every function in `/excel`, exact amounts (`/exact`) and exchange rates (`scripts/gen-pydecimal-vectors.py`, `scripts/gen-finance-vectors.py`, `scripts/gen-exact-vectors.py`; `pnpm vectors:check` checks the files are current). Where an Excel value is irrational (NPER, RATE, XNPV, XIRR), the oracle bounds it from Python's correctly rounded `ln` and `exp`, widened well past their rounding, and raises the precision until the bounds settle every value it writes.
  - LibreOffice Calc's results for the Excel functions (`scripts/gen-calc-vectors.py`), on random and edge cases. That needs LibreOffice, so CI doesn't rerun it: the JSON file is the record. They are compared with the exact values, and the cases where Calc's doubles differ are listed in the test with the reason.
  - Microsoft's worked examples from the Excel function pages, copied as printed.
  - ICU's spell-out of numbers in every language ducat ships, for the RBNF interpreter behind `amountInWords` (`scripts/gen-rbnf-vectors.mjs` with `scripts/rbnf-oracle.cpp`).
  - The General Decimal Arithmetic test cases (decTest) are IBM's copyright, so `pnpm fetch:dectest` downloads them and `test/dectest.test.ts` runs them when they are present.
- `pnpm typecheck` compiles `test/types.ts`. Its `@ts-expect-error` lines prove that currency mismatch, readonly fields and unknown rounding modes are compile errors.
- `pnpm test:runtimes` runs:
  - the **full suite on Node 24, Bun 1.4 (via `bun test`) and Deno 2.9**: all pass
  - a bundled smoke test on Node 24, Node 18, Bun, Deno and the **SpiderMonkey and JavaScriptCore shells** (installed with jsvu): all pass. On Node 18, `format()` of amounts above 2^53 is lossy (no Intl string input).
- `pnpm test:db` runs the SQL helpers against real databases: SQLite through Node's built-in `node:sqlite`, and Postgres and MySQL when `DUCAT_PG_URL` and `DUCAT_MYSQL_URL` point at a server (CI runs both as service containers, and sets `DUCAT_REQUIRE_DB=1` so a missing URL fails instead of skipping). It covers BIGINT minor units beyond 2^53 and at the BIGINT limits, `NUMERIC(19,4)` and `NUMERIC(38,4)` columns, Money as JSON/JSONB, values a column rounded silently (rejected on read), NaN and Infinity, and driver defaults that lose precision.
- `pnpm test:browser` runs a smoke and property subset in Chromium, Firefox and WebKit through Playwright, including `parse(format())` round trips in 18 locales; `DUCAT_BROWSER_RUNS` sets the cases per property (default 300) and `DUCAT_SEED` the seed.
- `pnpm test:mutation` runs Stryker over `src/` with property counts capped, on the unit tests and the SQLite part of the database tests (`vitest.mutation.config.ts`); CI runs it nightly and keeps the report.

## The conformance suite

ducat's test vectors are a language-neutral conformance suite, the private workspace package `@ducatjs/money-spec` in [`spec/`](https://github.com/public/ducat/tree/main/spec). It holds the cross-library battery, the fixed-point battery and every oracle above (about 21,000 cases in JSON), with a JSON Schema and [a README](https://github.com/public/ducat/blob/main/spec/README.md) that defines each operation and how its results are judged.

- **Nothing in a file needs JavaScript to read.** Amounts are exact decimal strings with a currency and a scale. Rounding modes have their ECMA-402 names, errors are neutral kinds (`rounding`, `currency-mismatch`, `range`, `syntax`, `type`), and irrational results are exact bounds.
- **Every file says where its expected values come from**: worked out by hand, a Lean model, Python's `decimal` or `fractions`, LibreOffice Calc, Microsoft's documentation, or ICU. It also names the generator and its version, and the version of any data the values depend on (the ISO 4217 publication date, the CLDR and ICU releases). No expected value comes from ducat's own output: the generators are second implementations, and a vector ducat fails is investigated, not regenerated.
- **`test/spec.test.ts` is ducat's runner.**
  - It validates every file against the schema, and fails on an operation it doesn't know.
  - It runs each case through ducat's API and judges it as the README says: money by amount, currency and scale.
  - It counts the cases in each area, so a lost vector fails the build.
  - It changes one expected value in every table it checks, to show the check can fail.
  - The finance and Excel tables are run by their own test files (`test/finance.oracle.test.ts`, `test/excel.oracle.test.ts`, `test/excel.test.ts`), which the runner names and checks.
- **`compare/` reads the same battery** from the package, so the cross-library comparison and ducat's own tests can't drift apart.
- **Each file records `checkedAgainst`**, the ducat version it was last checked against. The spec's version follows ducat's major and minor, and a changed expected value is a spec change that comes with a ducat release.

The suite is groundwork for implementations in other languages; ducat's TypeScript is the only one so far. The README's [How a port uses the suite](https://github.com/public/ducat/blob/main/spec/README.md#how-a-port-uses-the-suite) shows how another would run it.

## Mutation testing

`pnpm test:mutation` runs [Stryker](https://stryker-mutator.io) over `src/`: it changes the code one small edit at a time (a `<` for a `<=`, a condition for `true`, a block emptied, a message blanked) and runs the tests against each change, called a mutant. A mutant the tests fail on is killed; one they pass on survived. CI runs it nightly and keeps the report as the `mutation-report` artifact.

Every surviving mutant is either killed by a test that would catch a real bug of that shape, or is equivalent: no input can tell it from the original. Most equivalent mutants are in fast paths, where a guard sends a call to a safe-integer `number` path and otherwise to the general `bigint` path. Breaking the guard only sends more calls down the general path, which gives the same answer more slowly. Error messages are tested where they name the problem or the fix; elsewhere a test checks the error class and the key phrase.

Equivalent mutants are recorded in one of two places:

- At the site, as `// Stryker disable next-line <mutator>: <reason>`, when every mutant of that kind on that line is equivalent. Stryker then reports them as ignored.
- In [Equivalent mutants](equivalent-mutants.md), when the same line also has mutants of that kind that the tests kill. Stryker can't disable a single mutant, so these stay "survived" in the report; the page says why each one can't change the result.

On 2026-11-11, before the triage, the nightly report had these survivors in the core files (survived / no coverage): money.ts 164 / 5, parse.ts 129 / 26, fixed.ts 118 / 18, decimal.ts 101 / 8, allocate.ts 95 / 17, rate.ts 70 / 0, rounding.ts 32 / 12, exact.ts 16 / 0, currency.ts 9 / 4, convert.ts 2 / 0. The latest numbers are in the newest `mutation-report`.

## Benchmarks

- Clean-machine numbers against the other money and fixed-point libraries are in [How it compares](https://github.com/public/ducat#how-it-compares) and
  [How ducat compares](comparison.md), generated from [compare/](https://github.com/public/ducat/tree/main/compare) on one quiet AMD EPYC Genoa vCPU under
  Node, Bun and Deno.
- CodSpeed measures every pull request by instruction count, so speed regressions show up even on noisy CI machines.
- The benchmarks in `bench/` are for quick local comparisons; on a shared machine their run-to-run variation is often
  ±20–30%.
- Bundle size (esbuild, minified + gzip; `pnpm size` checks every entry point and snippet against `scripts/size-budgets.json`):
  - `money('1.00', 'EUR').add(…).multiply('1.075', 'halfEven').toDecimal()`: **4.6 KiB**, of which about 0.55 KiB is the ISO table. 0.3 grew it from 4.0 KiB, and the core from 4.9: stricter input validation and clearer errors (the port-test fixes), and the root entry installing the methods and currencies so that `/fn` programs can leave them out
  - the core entry point: 5.5 KiB; everything (`@ducatjs/money/all`): 57.8 KiB
  - `Fixed` alone (`fixed('1.00')`, add, multiply, toString): 3.5 KiB
  - the same snippet with dinero.js (EUR only): 1.8 KiB
  - the same snippet through `/fn`, with `import '@ducatjs/money/iso/EUR'`: 3.0 KiB; create, add and print only: 1.3 KiB
