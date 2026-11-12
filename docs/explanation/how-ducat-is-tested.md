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
- `pnpm typecheck` compiles `test/types.ts`. Its `@ts-expect-error` lines prove that currency mismatch, readonly fields and unknown rounding modes are compile errors.
- `pnpm test:runtimes` runs:
  - the **full suite on Node 24, Bun 1.4 (via `bun test`) and Deno 2.9**: all pass
  - a bundled smoke test on Node 24, Node 18, Bun, Deno and the **SpiderMonkey and JavaScriptCore shells** (installed with jsvu): all pass. On Node 18, `format()` of amounts above 2^53 is lossy (no Intl string input).
- `pnpm test:db` runs the SQL helpers against real databases: SQLite through Node's built-in `node:sqlite`, and Postgres and MySQL when `DUCAT_PG_URL` and `DUCAT_MYSQL_URL` point at a server (CI runs both as service containers, and sets `DUCAT_REQUIRE_DB=1` so a missing URL fails instead of skipping). It covers BIGINT minor units beyond 2^53 and at the BIGINT limits, `NUMERIC(19,4)` and `NUMERIC(38,4)` columns, Money as JSON/JSONB, values a column rounded silently (rejected on read), NaN and Infinity, and driver defaults that lose precision.
- `pnpm test:browser` runs a smoke and property subset in Chromium, Firefox and WebKit through Playwright, including `parse(format())` round trips in 18 locales; `DUCAT_BROWSER_RUNS` sets the cases per property (default 300) and `DUCAT_SEED` the seed.
- `pnpm test:mutation` runs Stryker over `src/` with property counts capped; CI runs it nightly and keeps the report.

## Benchmarks

- Clean-machine numbers against the other money and fixed-point libraries are in [How it compares](https://github.com/public/ducat#how-it-compares) and
  [How ducat compares](comparison.md), generated from [compare/](https://github.com/public/ducat/tree/main/compare) on one quiet AMD EPYC Genoa vCPU under
  Node, Bun and Deno.
- CodSpeed measures every pull request by instruction count, so speed regressions show up even on noisy CI machines.
- The benchmarks in `bench/` are for quick local comparisons; on a shared machine their run-to-run variation is often
  ±20–30%.
- Bundle size (esbuild, minified + gzip; `pnpm size` checks every entry point and snippet against `scripts/size-budgets.json`):
  - `money('1.00', 'EUR').add(…).multiply('1.075', 'halfEven').toDecimal()`: **4.5 KiB**, of which about 0.55 KiB is the ISO table. 0.3 grew it from 4.0 KiB, and the core from 4.9: stricter input validation and clearer errors (the port-test fixes), and the root entry installing the methods and currencies so that `/fn` programs can leave them out
  - the core entry point: 5.5 KiB; everything (`@ducatjs/money/all`): 50.5 KiB
  - `Fixed` alone (`fixed('1.00')`, add, multiply, toString): 3.5 KiB
  - the same snippet with dinero.js (EUR only): 1.8 KiB
  - the same snippet through `/fn`, with `import '@ducatjs/money/iso/EUR'`: 3.0 KiB; create, add and print only: 1.3 KiB
