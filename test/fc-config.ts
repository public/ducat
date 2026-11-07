// Property-test budget. `npm test` keeps small counts; `npm run test:deep` sets DUCAT_DEEP=1 and
// runs at least DUCAT_DEEP_RUNS (default 100,000) cases per property. Every run uses one seed,
// printed at start, so a failure reproduces with DUCAT_SEED=<seed> (fast-check also prints the
// seed and the shrunk counterexample on failure).

function readEnv(name: string): string | undefined {
  // Bun and Deno have `process` too; a browser bundle does not
  if (typeof process === 'undefined') {
    return undefined;
  }
  return process.env[name];
}

export const DEEP = readEnv('DUCAT_DEEP') === '1';

const DEEP_RUNS = Number(readEnv('DUCAT_DEEP_RUNS') ?? 100_000);

// DUCAT_MAX_RUNS caps every property: mutation testing reruns the suite once per mutant
const MAX_RUNS = Number(readEnv('DUCAT_MAX_RUNS') ?? Infinity);

function chooseSeed(): number {
  const fromEnv = readEnv('DUCAT_SEED');
  if (fromEnv) {
    return Number(fromEnv);
  }
  if (DEEP) {
    // a fresh seed each deep run, so nightly runs explore new inputs
    return (Date.now() ^ (Math.random() * 2 ** 31)) | 0;
  }
  // a fixed seed keeps `npm test` deterministic
  return 42;
}

export const SEED = chooseSeed();

/**
 * Cases for one property: `count` normally, at least DUCAT_DEEP_RUNS in deep mode, and never more
 * than DUCAT_MAX_RUNS.
 */
export function runs(count: number): number {
  const budget = DEEP ? Math.max(count, DEEP_RUNS) : count;
  return Math.min(budget, MAX_RUNS);
}
