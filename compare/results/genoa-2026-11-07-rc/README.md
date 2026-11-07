# Benchmark results: AMD EPYC Genoa, 0.1.0 release candidate, 2026-11-07

Raw output of the money benchmark (`compare/bench/bench.ts`) and the fixed-point benchmark
(`compare/fixed/bench.ts`), one runtime per run, run back to back on the same machine against the
ducat 0.1.0 release candidate. `pnpm tables` renders them. The earlier pre-release run is kept in
`../genoa-2026-11-07/` for reference.

## Machine

- One Vultr `vhp-1c-2gb-amd` virtual machine in Frankfurt: 1 vCPU, AMD EPYC Genoa, 2 GB RAM.
- Linux kernel 6.8; CPU steal during the runs was 0.03–0.04%.
- Each runtime was installed by the clean-machine runner (`compare/runner/`), pinned and checked by
  SHA-256: Node 24.22.2, Bun 1.4.4, Deno 2.9.8. Nothing else ran on the machine.

## Method

- 150 ms warm-up per (library, operation) cell, 5 rounds, the library order shuffled each round
  with a fixed seed.
- Each cell is the median over rounds of the per-round median of 5 samples, in nanoseconds per
  operation over 1,000 values. `min` and `max` are the spread of the round medians.
- `env.txt` records the settings, CPU, core count, kernel, and the SHA-256 of the exact benchmark
  bundles that ran.
