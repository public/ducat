// Runs every vector against every library and prints the outcomes as one JSON document. Bundled by
// compare/build.mjs so the same file runs unchanged on Node, Bun and Deno:
//   node compare/out/battery.mjs > compare/results/battery.json
import { LIBRARIES } from './libraries.ts';
import { runVector, VECTORS, type Outcome } from './vectors.ts';

export interface BatteryResults {
  readonly libraries: string[];
  readonly vectors: { id: string; group: string; description: string }[];
  /** one row per library and vector, in library-major order */
  readonly rows: { library: string; id: string; outcome: Outcome; got: string; note?: string }[];
}

function runBattery(): BatteryResults {
  const rows: BatteryResults['rows'][number][] = [];
  for (const library of LIBRARIES) {
    for (const vector of VECTORS) {
      const result = runVector(vector, library);
      rows.push({ library: library.name, id: vector.id, ...result });
    }
  }

  return {
    libraries: LIBRARIES.map((library) => library.name),
    vectors: VECTORS.map(({ id, group, description }) => ({ id, group, description })),
    rows,
  };
}

console.log(JSON.stringify(runBattery(), null, 1));
