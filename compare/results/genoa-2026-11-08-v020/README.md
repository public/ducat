# Benchmark results: AMD EPYC Genoa, ducat 0.2.0 release candidate, 2026-11-08

Raw output of the money benchmark (`compare/bench/bench.ts`) and the fixed-point benchmark
(`compare/fixed/bench.ts`), one runtime per run, against ducat at commit ea9160b, the 0.2.0 release
candidate. The fixed-point benchmark measures ducat's `Fixed` for the first time, next to `Money`.
`pnpm tables` renders them. The 0.1.0 run is kept in `../genoa-2026-11-08/`.

## Machine

- One Vultr `vhp-1c-2gb-amd` virtual machine in Frankfurt per run: 1 vCPU, AMD EPYC Genoa, 2 GB RAM.
- Linux kernel 6.8; CPU steal during the runs was 0.02%.
- Each runtime was installed by the clean-machine runner (`compare/runner/`), pinned and checked by
  SHA-256: Node 24.22.2, Bun 1.4.4, Deno 2.9.8. Nothing else ran on the machine.
- Node and Bun ran back to back on one machine. Deno ran on a second machine of the same plan: two
  earlier attempts failed while downloading Deno (GitHub returned 504 for the release file), so the
  third run carried the SHA-256-checked Deno archive with it. Compare Deno's numbers with each other,
  not with Node's or Bun's to the nanosecond.

## Method

The same as `../genoa-2026-11-08/`: 150 ms warm-up per (library, operation) cell, 5 rounds, the
library order shuffled each round with a fixed seed. Each cell is the median over rounds of the
per-round median of 5 samples, in nanoseconds per operation over 1,000 values. `env.txt` records the
settings, CPU, core count, kernel, and the SHA-256 of the exact benchmark bundles that ran.
