# Benchmark results: AMD EPYC Genoa, ducat 0.1.1, 2026-11-08

Raw output of the money benchmark (`compare/bench/bench.ts`) and the fixed-point benchmark
(`compare/fixed/bench.ts`), one runtime per run, run back to back on the same machine against
ducat at commit 69d7fe9 (0.1.0 plus faster parsing, two-bigint ratios and cash-rule lookup).
`pnpm tables` renders them. The 0.1.0 release-candidate run is kept in `../genoa-2026-11-07-rc/`.

## Machine

- One Vultr `vhp-1c-2gb-amd` virtual machine in Frankfurt: 1 vCPU, AMD EPYC Genoa, 2 GB RAM.
- Linux kernel 6.8; CPU steal during the runs was 0.01–0.02%.
- Each runtime was installed by the clean-machine runner (`compare/runner/`), pinned and checked by
  SHA-256: Node 24.22.2, Bun 1.4.4, Deno 2.9.8. Nothing else ran on the machine.

## Method

The same as `../genoa-2026-11-07-rc/`: 150 ms warm-up per (library, operation) cell, 5 rounds, the
library order shuffled each round with a fixed seed. Each cell is the median over rounds of the
per-round median of 5 samples, in nanoseconds per operation over 1,000 values. `env.txt` records the
settings, CPU, core count, kernel, and the SHA-256 of the exact benchmark bundles that ran.
