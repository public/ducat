// The timing machinery shared by the money benchmark (bench/bench.ts) and the fixed-point
// benchmark (fixed/bench.ts). Runs unchanged on Node, Bun and Deno once bundled by build.mjs.
//
// Method: ROUNDS rounds. In each round the library order is shuffled (seeded, so every run uses the
// same orders) and every (library, operation) cell gets a warm-up of BENCH_MS milliseconds and then
// SAMPLES timed samples. Reported: the median over rounds of the per-round median, plus the min and
// max across rounds, in nanoseconds per single operation.
//
//   BENCH_MS      warm-up per cell in ms (default 40)
//   BENCH_ROUNDS  rounds (default 3)
//   BENCH_ONLY    comma-separated library names to run (default: all)

export interface Cell {
  med: number;
  min: number;
  max: number;
}

const runtimeGlobals = globalThis as unknown as {
  process?: { env?: Record<string, string | undefined>; versions: { node: string; v8: string } };
  Deno?: { env: { get(name: string): string | undefined }; version: { deno: string; v8: string } };
  Bun?: { version: string };
};

export function readEnv(name: string, fallback: string): string {
  const fromProcess = runtimeGlobals.process?.env?.[name];
  if (fromProcess !== undefined) {
    return fromProcess;
  }
  const fromDeno = runtimeGlobals.Deno?.env.get(name);
  if (fromDeno !== undefined) {
    return fromDeno;
  }
  return fallback;
}

export const WARM_UP_MS = Number(readEnv('BENCH_MS', '40'));
export const ROUNDS = Number(readEnv('BENCH_ROUNDS', '3'));
export const SAMPLES = 5;

const onlyList = readEnv('BENCH_ONLY', '');
export const ONLY: string[] | null = onlyList === '' ? null : onlyList.split(',');

// results go here so the engine cannot drop the measured work as dead code
let sink: unknown;

export function median(values: number[]): number {
  const sorted = values.toSorted((first, second) => first - second);
  return sorted[sorted.length >> 1]!;
}

/** Median ns per inner operation of `body`, which performs `innerCount` operations per call. */
export function measureCell(body: () => unknown, innerCount: number): number {
  let start = performance.now();
  while (performance.now() - start < WARM_UP_MS) {
    sink = body();
  }

  // double the iteration count until one sample takes at least WARM_UP_MS / SAMPLES
  let iterations = 1;
  for (;;) {
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
      sink = body();
    }
    if (performance.now() - start > WARM_UP_MS / SAMPLES) {
      break;
    }
    iterations *= 2;
  }

  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
      sink = body();
    }
    const elapsedNs = (performance.now() - start) * 1e6;
    samples.push(elapsedNs / (iterations * innerCount));
  }
  return median(samples);
}

export function runtimeName(): string {
  if (runtimeGlobals.Bun) {
    return `bun ${runtimeGlobals.Bun.version}`;
  }
  if (runtimeGlobals.Deno) {
    const { deno, v8 } = runtimeGlobals.Deno.version;
    return `deno ${deno} (V8 ${v8})`;
  }
  const { node, v8 } = runtimeGlobals.process!.versions;
  return `node ${node} (V8 ${v8})`;
}

/**
 * The seeded generator the published runs used for their library orders. It computes in doubles,
 * where the product can exceed 2^53, so it is not an exact LCG; it is kept as is so that orders
 * stay reproducible against the committed results.
 */
function seededRandom(): () => number {
  let seed = 42;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

function summarize(roundValues: number[] | null): Cell | null {
  if (roundValues === null) {
    return null;
  }
  return { med: median(roundValues), min: Math.min(...roundValues), max: Math.max(...roundValues) };
}

export interface BenchmarkOptions<Operation extends string> {
  /** library names, in their reporting order */
  readonly libraries: string[];
  readonly operations: readonly Operation[];
  /**
   * The timed bodies for one library, built fresh each round. A null body means the library cannot
   * do that operation; its cell is reported as null.
   */
  bodiesFor(library: string): Record<Operation, (() => unknown) | null>;
  /** operations performed per call of an operation's body */
  innerCount(operation: Operation): number;
  /** extra top-level fields for the JSON line, e.g. { kind: 'fixed' } */
  readonly extraFields?: Record<string, unknown>;
}

/** Runs every (library, operation) cell for ROUNDS shuffled rounds and prints one JSON line. */
export function runBenchmark<Operation extends string>(options: BenchmarkOptions<Operation>): void {
  const { libraries, operations, bodiesFor, innerCount, extraFields = {} } = options;
  const names = libraries.filter((name) => !ONLY || ONLY.includes(name));
  const random = seededRandom();

  // prototype-free maps: operation names such as `toString` must not resolve to Object.prototype members
  const perRound: Record<string, Record<string, number[] | null>> = Object.create(null);
  for (let round = 0; round < ROUNDS; round++) {
    const order = names.toSorted(() => random() - 0.5);

    for (const name of order) {
      const bodies = bodiesFor(name);
      perRound[name] ??= Object.create(null);

      for (const operation of operations) {
        const body = bodies[operation];
        if (body === null) {
          perRound[name][operation] = null;
          continue;
        }
        const timings = perRound[name][operation] ?? [];
        timings.push(measureCell(body, innerCount(operation)));
        perRound[name][operation] = timings;
      }
    }
  }

  const ns = Object.fromEntries(
    names.map((name) => {
      const cells = operations.map((operation) => [
        operation,
        summarize(perRound[name]![operation]!),
      ]);
      return [name, Object.fromEntries(cells)];
    }),
  );

  void sink;
  console.log(
    JSON.stringify({
      ...extraFields,
      runtime: runtimeName(),
      ms: WARM_UP_MS,
      rounds: ROUNDS,
      libs: names,
      ops: operations,
      ns,
    }),
  );
}
