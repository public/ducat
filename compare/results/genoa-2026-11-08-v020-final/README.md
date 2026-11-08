# Benchmark results: AMD EPYC Genoa, ducat 0.2.0, 2026-11-08

Raw output of the money benchmark (`compare/bench/bench.ts`) and the fixed-point benchmark
(`compare/fixed/bench.ts`), one runtime per run, run back to back on the same machine against ducat
at commit 7c9455a: the 0.2.0 code. `pnpm tables` renders them. The release-candidate run at ea9160b is kept in `../genoa-2026-11-08-v020/`.

The benchmark bundles are byte-identical to the `../genoa-2026-11-08-v020/` run's (same SHA-256 in
`env.txt`): nothing the benchmarks import changed between ea9160b and 7c9455a. The cross-library parse
row is decimal-string construction (`money('12.34', 'EUR')`), not the locale `parse()` that #138 changed.

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
