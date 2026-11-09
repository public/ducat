# Benchmark results: AMD EPYC Genoa, ducat at 01753e5 (the 0.3.0 release candidate), 2026-11-09

Raw output of the money benchmark (`compare/bench/bench.ts`) and the fixed-point benchmark
(`compare/fixed/bench.ts`), one runtime per run, run back to back on the same machine against ducat
at commit 01753e5: the 0.3.0 release candidate, after the port-test wave (#225–#242), `/fn`
tree-shaking (#231), per-module ISO currencies for `/fn` (#243) and the currency-lookup fix (#244).
`pnpm tables` renders them. The earlier 0.3 run at f927311 is kept in `../genoa-2026-11-08-v030/`,
and the 0.2.0 run at 7c9455a in `../genoa-2026-11-08-v020-final/`.

The cross-library parse row is decimal-string construction (`money('12.34', 'EUR')`), not the locale
`parse()`.

## Machine

- One Vultr `vhp-1c-2gb-amd` virtual machine in Frankfurt: 1 vCPU, AMD EPYC Genoa, 2 GB RAM.
- Linux kernel 6.8; CPU steal during the runs was 0.01%.
- Each payload carried its runtime (Node 24.22.2, Bun 1.4.4, Deno 2.9.8), checked by SHA-256 by the
  clean-machine runner (`compare/runner/`), so nothing was downloaded on the machine. Nothing else ran
  on it.

## Method

The same as `../genoa-2026-11-08/`: 150 ms warm-up per (library, operation) cell, 5 rounds, the
library order shuffled each round with a fixed seed. Each cell is the median over rounds of the
per-round median of 5 samples, in nanoseconds per operation over 1,000 values. `env.txt` records the
settings, CPU, core count, kernel, and the SHA-256 of the exact benchmark bundles that ran.

## dinero.js 2 on Deno

dinero.js 2's Deno cells are several times slower here than in the runs of 2026-11-08 (`fromMinor`
89 against 12 ns, `add` 335 against 179, `allocate3` 2.0 against 1.1 µs), while every other
library's Deno cells, ducat's included, and dinero.js 2's own Node and Bun cells match those runs.
It doesn't come from ducat: the 2026-11-08 payload (m020, at f927311) gives dinero.js 2 the slow
numbers too when run on another machine, and the 41a566a run (m026, on a third machine) agrees with
this one. V8 in Deno 2.9.8 appears to optimize dinero.js 2's code differently from machine to
machine. The README's range against dinero.js 2 is therefore taken from Node and Bun only.
