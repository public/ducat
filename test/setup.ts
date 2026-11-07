// Loaded by vitest before every test file: one seed and default budget for all fast-check properties.
import fc from 'fast-check';
import { DEEP, runs, SEED } from './fc-config.js';

fc.configureGlobal({ seed: SEED, numRuns: runs(100) });

if (DEEP) {
  const minimumRuns = runs(1);
  console.log(
    `fast-check: deep mode, seed ${SEED}, at least ${minimumRuns} runs per property ` +
      `(reproduce with DUCAT_SEED=${SEED})`,
  );
}
