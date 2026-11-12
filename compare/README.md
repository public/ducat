# Comparison with other money and decimal libraries

Everything needed to reproduce how ducat compares with other JavaScript money and decimal
libraries: a correctness battery, a benchmark and bundle sizes. The results are committed in
`results/`, and `RESULTS.md` is generated from them.

This is a private workspace package (`@ducatjs/compare`). Its dependencies (the other libraries)
never become dependencies of ducat itself.

## Libraries

Pinned to exact versions in `package.json`.

| Kind    | Library                                   | Version |
| ------- | ----------------------------------------- | ------- |
| ducat   | this repository's `src/`                  |         |
| Money   | dinero.js (number and bigint calculators) | 2.0.2   |
| Money   | dinero.js                                 | 1.9.1   |
| Money   | currency.js                               | 2.0.4   |
| Money   | js-money                                  | 0.6.3   |
| Money   | ts-money                                  | 0.4.8   |
| Money   | @screeny05/ts-money                       | 1.2.0   |
| Money   | money-math                                | 2.6.3   |
| Money   | monetra                                   | 2.3.0   |
| Money   | bigint-money                              | 2.0.1   |
| Decimal | big.js                                    | 7.0.1   |
| Decimal | bignumber.js                              | 11.1.5  |
| Decimal | decimal.js                                | 10.6.0  |
| Decimal | decimal.js-light                          | 2.5.1   |
| Decimal | Prisma.Decimal (@prisma/client)           | 7.10.1  |

Each library is driven through an adapter (`battery/libraries.ts`) that uses its own API the way
its README teaches. A capability a library lacks is reported as not supported, never emulated.
Decimal libraries carry no currency, so where one needs a scale the adapter supplies the ISO 4217
exponent, and the library gets no credit for knowing it.

## Fixed-point decimal libraries

A second, currency-free comparison against fixed-point decimal libraries, with its own battery,
benchmark and size tables (under "Fixed-point decimal libraries" in `RESULTS.md`):

| Library                                    | Version         |
| ------------------------------------------ | --------------- |
| ducat `Money` (EUR with an explicit scale) | this repository |
| dnum                                       | 2.18.1          |
| ethers `FixedNumber`                       | 6.17.0          |
| js-big-decimal                             | 2.2.0           |
| bigdecimal.js                              | 1.7.2           |
| @formatjs/bigdecimal                       | 0.2.10          |
| bigint-money                               | 2.0.1           |

Only operations every library supports are compared: parse a decimal string, add, multiply and
divide rounded to a scale, round, compare and toString, each with an explicit rounding mode
(half-even or half-up). A library without a given mode shows n/a; dnum and ethers have no
half-even, and @formatjs/bigdecimal cannot round to a number of decimals. The 28 vectors are
`vectors/fixed/battery.json` in @ducatjs/money-spec (the repository's `spec/`), and
`fixed/vectors.ts` runs them: the money battery's ties, float traps, amounts beyond 2^53, division and scale
changes, without currencies. CI runs it on Node, Bun and Deno like the money battery.

ethers' `FixedNumber.round()` is its only rounding, so the adapter uses it for half-up. It rounds
negative values toward +infinity rather than to the nearest value (-2 ÷ 3 gives -0.66, and
-0.125 gives -0.12), and the battery reports those as wrong values, which is what a caller asking
for half-up would get.

## Correctness battery

The battery holds 41 vectors: currency exponents, allocation, tax, rounding at .5
boundaries, float traps, amounts beyond 2^53, negatives, float input and currency mismatches.
They are language-neutral data, `vectors/core/battery.json` in @ducatjs/money-spec (the
repository's `spec/`). `battery/vectors.ts` maps each operation to the adapters and holds the
comparison's own reading of other libraries' answers (lossy, or wrong by design). The ducat test
suite runs the same vectors (`test/battery.test.ts` and `test/spec.test.ts`), so the two cannot
drift.

```sh
pnpm compare          # run both batteries, write results/*battery.json, regenerate the tables
pnpm compare:check    # the same checks locally: fails on any change in outcomes or a stale table
```

CI runs its own steps with the same scripts: the bundled batteries on Node, Bun and Deno, and requires identical outcomes on all three,
that ducat passes every vector, and that `results/battery.json` and the tables are current. A
change in any library's behaviour therefore shows up as a reviewed diff.

## Benchmark

`bench/bench.ts` times eight operations (fromMinor, parse, add, multiply by a ratio, allocate in
three, toDecimal, Intl format, compare) in every library, on 1,000 values each. Numbers from a
shared or laptop machine are indicative only; publishable numbers come from a clean machine.

Quick local run (Node 24, from `compare/`):

```sh
node build.mjs bench/bench.ts out/bench.mjs
BENCH_MS=40 BENCH_ROUNDS=3 node out/bench.mjs
BENCH_ONLY='ducat methods,dinero.js 2' node out/bench.mjs   # a subset
```

`fixed/bench.ts` times the fixed-point decimal libraries with the same harness
(`bench/harness.ts`) and shuffled rounds: parse, add, multiply by 1.075 and divide by 3 (each
rounded half-up to 2 decimals), compare and toString. A library that cannot round that way shows
n/a; nothing is emulated.

```sh
node build.mjs fixed/bench.ts out/fixed-bench.mjs
BENCH_MS=40 BENCH_ROUNDS=3 node out/fixed-bench.mjs
```

### On a clean Linux x64 machine

The runner installs its own runtime, pinned and checked by SHA-256, and runs one runtime per
archive, so runtimes never share a process or a warm cache:

```sh
runner/make.sh node 150 5 bench-node.zip    # also: bun, deno
# copy bench-node.zip to the machine, then there:
unzip bench-node.zip -d bench && cd bench && ./run.sh
```

It runs the money benchmark and then the fixed-point benchmark, and writes `out/bench.json` and
`out/fixed-bench.json` (one JSON line each: per library and operation, the median, min and max ns
per operation over rounds) and `out/env.txt` (settings, CPU model, core count, kernel, and the
SHA-256 of both bundles). Commit them under `results/<machine>-<date>/<runtime>/` with a README describing the
machine, as in `results/genoa-2026-11-08/` (the earlier runs are in `results/genoa-2026-11-07-rc/` and
`results/genoa-2026-11-07/`).

## Bundle sizes

`sizes/sizes.sh` bundles the same small program (create, add, multiply, toDecimal) with each
money library, and each library's whole package, using esbuild (minified ESM, browser platform), and
writes raw and gzip -9 byte counts to `results/sizes.tsv`.

It does the same for the fixed-point decimal libraries (parse "1.00", add it to itself, multiply by
"1.075" rounding to 2 decimals half-up, toString) into `results/sizes-fixed.tsv`.
@formatjs/bigdecimal cannot round to a number of decimals, so its program stops at the exact
product. ethers is measured importing `FixedNumber` from both `ethers` and `ethers/utils`, and the
smaller is reported, with the import named in the row.

Sizes (`sizes/sizes.sh`) and the benchmark (`compare/runner`, on a clean machine) are rerun by
hand, not in CI: their committed results change only when someone regenerates them.

## Tables

`pnpm tables` (`tables.ts`) renders `RESULTS.md` and the standalone tables in `results/tables/`
(battery summary, speed headline, sizes) from the committed results; `--check` fails if any of
them is stale.
