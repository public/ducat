// Property-test budget. `pnpm test` keeps small counts; `pnpm test:deep` sets DUCAT_DEEP=1 and
// runs at least DUCAT_DEEP_RUNS (default 100,000) cases per property. Every run uses one seed
// (vitest.config.ts chooses a fresh one for deep runs), printed at start, so a failure reproduces
// with DUCAT_SEED=<seed>; fast-check also prints the seed and the shrunk counterexample.

function readEnv(name: string): string | undefined {
  // Bun and Deno have `process` too; a browser bundle does not
  if (typeof process === 'undefined') {
    return undefined;
  }
  return process.env[name];
}

export const DEEP = readEnv('DUCAT_DEEP') === '1';

/**
 * Set by `pnpm test:mutation`. Stryker runs the suite on instrumented sources, which don't
 * type-check, so the tests that type-check src/ skip themselves (a type check can't kill a mutant).
 */
export const MUTATION = readEnv('DUCAT_MUTATION') === '1';

const DEEP_RUNS = readNumber('DUCAT_DEEP_RUNS', 100_000);

// DUCAT_MAX_RUNS caps every property: mutation testing reruns the suite once per mutant
const MAX_RUNS = readNumber('DUCAT_MAX_RUNS', Infinity);

function readNumber(name: string, fallback: number): number {
  const text = readEnv(name);
  if (text === undefined || text === '') {
    return fallback;
  }
  const value = Number(text);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be a number, got "${text}"`);
  }
  return value;
}

function chooseSeed(): number {
  // a fixed seed keeps `pnpm test` deterministic; deep runs get theirs from vitest.config.ts
  // (Bun and Deno runs without it fall back to a fresh one)
  const fallback = DEEP ? (Date.now() ^ (Math.random() * 2 ** 31)) | 0 : 42;
  return readNumber('DUCAT_SEED', fallback);
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
