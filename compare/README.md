# Comparison with other money and decimal libraries

Everything needed to reproduce how ducat compares with other JavaScript money and decimal
libraries: a correctness battery, a benchmark and bundle sizes. The results are committed in
`results/`, and `RESULTS.md` is generated from them.

This is a private workspace package (`@ducatjs/compare`). Its dependencies (the other libraries)
never become dependencies of ducat itself.

## Libraries

Pinned to exact versions in `package.json`.

| Kind | Library | Version |
|---|---|---|
| ducat | this repository's `src/` | |
| Money | dinero.js (number and bigint calculators) | 2.0.2 |
| Money | dinero.js | 1.9.1 |
| Money | currency.js | 2.0.4 |
| Money | js-money | 0.6.3 |
| Money | ts-money | 0.4.8 |
| Money | @screeny05/ts-money | 1.2.0 |
| Money | money-math | 2.6.3 |
| Money | monetra | 2.3.0 |
| Money | bigint-money | 2.0.1 |
| Decimal | big.js | 7.0.1 |
| Decimal | bignumber.js | 11.1.5 |
| Decimal | decimal.js | 10.6.0 |
| Decimal | decimal.js-light | 2.5.1 |
| Decimal | Prisma.Decimal (@prisma/client) | 7.10.1 |

Each library is driven through an adapter (`battery/libraries.ts`) that uses its own API the way
its README teaches. A capability a library lacks is reported as not supported, never emulated.
Decimal libraries carry no currency, so where one needs a scale the adapter supplies the ISO 4217
exponent, and the library gets no credit for knowing it.

## Correctness battery

`battery/vectors.ts` holds 41 vectors: currency exponents, allocation, tax, rounding at .5
boundaries, float traps, amounts beyond 2^53, negatives, float input and currency mismatches.
The ducat test suite (`test/battery.test.ts`) runs the same vectors, so the two cannot drift.

```sh
pnpm compare          # run the battery, write results/battery.json, regenerate the tables
pnpm compare:check    # what CI runs: fails on any change in outcomes or a stale table
```

CI runs the bundled battery on Node, Bun and Deno and requires identical outcomes on all three,
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

### On a clean Linux x64 machine

The runner installs its own runtime, pinned and checked by SHA-256, and runs one runtime per
archive, so runtimes never share a process or a warm cache:

```sh
runner/make.sh node 150 5 bench-node.zip    # also: bun, deno
# copy bench-node.zip to the machine, then there:
unzip bench-node.zip -d bench && cd bench && ./run.sh
```

It writes `out/bench.json` (one JSON line: per library and operation, the median, min and max ns per
operation over rounds) and `out/env.txt` (settings, CPU model, core count, kernel, and the SHA-256 of
the bundle). Commit both under `results/<machine>-<date>/<runtime>/` with a README describing the
machine, as in `results/genoa-2026-11-07/`.

## Bundle sizes

`sizes/sizes.sh` bundles the same small program (create, add, multiply, toDecimal) with each
library, and each library's whole package, using esbuild (minified ESM, browser platform), and
writes raw and gzip -9 byte counts to `results/sizes.tsv`.

## Tables

`pnpm tables` (`tables.ts`) renders `RESULTS.md` and the standalone tables in `results/tables/`
(battery summary, speed headline, sizes) from the committed results; `--check` fails if any of
them is stale.
