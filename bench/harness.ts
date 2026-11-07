// Minimal, dependency-free benchmark harness that runs unchanged on Node, Bun, Deno
// and the SpiderMonkey / JSC shells (it only needs `performance.now` or `Date.now`).
declare const print: ((s: string) => void) | undefined;
const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

export const log: (s: string) => void =
  typeof print !== 'function' && typeof console !== 'undefined' && typeof console.log === 'function'
    ? (s) => console.log(s)
    : (s) => (print as (s: string) => void)(s);

// A sink that the optimiser cannot see through.
export let sink: unknown = 0;
export function consume(x: unknown): void {
  sink = x;
}

export interface Result {
  name: string;
  nsPerOp: number;
  opsPerSec: number;
}

/**
 * Runs `fn` (which performs `inner` operations per call) for ~`ms` milliseconds after warm-up,
 * in 7 samples, and reports the median ns/op.
 */
export function bench(name: string, fn: () => unknown, inner = 1, ms = 150): Result {
  // warm-up: let the JIT tier up
  let t0 = now();
  while (now() - t0 < ms) consume(fn());
  // calibrate iterations per sample
  let iters = 1;
  for (;;) {
    t0 = now();
    for (let i = 0; i < iters; i++) consume(fn());
    if (now() - t0 > ms / 7) break;
    iters *= 2;
  }
  const samples: number[] = [];
  for (let s = 0; s < 7; s++) {
    t0 = now();
    for (let i = 0; i < iters; i++) consume(fn());
    samples.push(((now() - t0) * 1e6) / (iters * inner));
  }
  samples.sort((a, b) => a - b);
  const nsPerOp = samples[3]!;
  return { name, nsPerOp, opsPerSec: 1e9 / nsPerOp };
}

export function runtimeName(): string {
  const g = globalThis as any;
  if (g.Bun) return `bun ${g.Bun.version} (JSC)`;
  if (g.Deno) return `deno ${g.Deno.version.deno} (V8 ${g.Deno.version.v8})`;
  if (g.process?.versions?.node) return `node ${g.process.versions.node} (V8 ${g.process.versions.v8})`;
  if (typeof g.inIon === 'function') return 'SpiderMonkey shell (jsvu)';
  if (typeof g.jscOptions === 'function') return 'JavaScriptCore shell (jsvu)';
  return 'unknown';
}
