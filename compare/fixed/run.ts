// Runs every fixed-point vector against every fixed-point library and prints the outcomes as one
// JSON document, in the same shape as the money battery (battery/run.ts). Bundled by
// compare/build.mjs so Node, Bun and Deno run the same code:
//   node compare/out/fixed-battery.mjs > compare/results/fixed-battery.json
import type { BatteryResults } from '../battery/run.ts';
import { FIXED_LIBRARIES } from './libraries.ts';
import { FIXED_VECTORS, runFixedVector } from './vectors.ts';

function runFixedBattery(): BatteryResults {
  const rows: BatteryResults['rows'][number][] = [];
  for (const library of FIXED_LIBRARIES) {
    for (const vector of FIXED_VECTORS) {
      rows.push({ library: library.name, id: vector.id, ...runFixedVector(vector, library) });
    }
  }

  return {
    libraries: FIXED_LIBRARIES.map((library) => library.name),
    vectors: FIXED_VECTORS.map(({ id, group, description }) => ({ id, group, description })),
    rows,
  };
}

console.log(JSON.stringify(runFixedBattery(), null, 1));
