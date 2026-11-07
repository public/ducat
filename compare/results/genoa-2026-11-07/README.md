# Benchmark results: AMD EPYC Genoa, 2026-11-07

Raw output of the cross-library benchmark (`compare/bench/bench.ts`), one runtime per run, run
back to back on the same machine. `pnpm tables` renders them.

## Machine

- One Vultr `vhp-1c-2gb-amd` virtual machine in Frankfurt: 1 vCPU, AMD EPYC Genoa, 2 GB RAM.
- Linux kernel 6.8; CPU steal during the runs was 0.02%.
- Each runtime was installed by the clean-machine runner (`compare/runner/`), pinned and checked by
  SHA-256; nothing else ran on the machine.

## Method

- 150 ms warm-up per (library, operation) cell, 5 rounds, the library order shuffled each round
  with a fixed seed.
- Each cell is the median over rounds of the per-round median of 5 samples, in nanoseconds per
  operation over 1,000 values. `min` and `max` are the spread of the round medians.
- `env.txt` records the settings, CPU, core count, kernel, and the SHA-256 of the exact benchmark
  bundle that ran.

| runtime      | directory |
| ------------ | --------- |
| Node 22.11.0 | `node/`   |
| Bun 1.4.4    | `bun/`    |
| Deno 2.9.8   | `deno/`   |

## Caveats

- These runs measured an earlier ducat build, bundled from the methods API branch before it was
  merged (bundle SHA-256 `fdf79e901eab5c98c33e73d36cac43ccadb332fd1140ba9fbd1c6df51f8d3e1a`, the
  same bundle on all three runtimes). Numbers for the current code need a new run.
- Node was 22.11, from before ducat required Node 24; the runner now pins Node 24.22.2.
- The raw `bench.json` files include an internal prototype that was never published; the rendered
  tables omit it.
