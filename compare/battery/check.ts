// Checks fresh battery runs against the committed results, and that ducat passes every vector:
//   node compare/battery/check.ts results/battery.json out/battery-node.json out/battery-bun.json
//   node compare/battery/check.ts results/fixed-battery.json out/fixed-battery-node.json
// A difference means a library changed behaviour (or a vector changed): regenerate with
// `pnpm compare` and review the diff of the committed results.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BatteryResults } from './run.ts';

function readResults(path: string): BatteryResults {
  return JSON.parse(readFileSync(path, 'utf8')) as BatteryResults;
}

const [committedArgument, ...freshPaths] = process.argv.slice(2);
if (!committedArgument || freshPaths.length === 0) {
  throw new Error('usage: node battery/check.ts <committed.json> <fresh-run.json>...');
}

// paths are relative to compare/, where the scripts run
const COMPARE_DIRECTORY = join(import.meta.dirname, '..');
const committedPath = join(COMPARE_DIRECTORY, committedArgument);
const committed = readResults(committedPath);
const problems: string[] = [];

for (const freshPath of freshPaths) {
  const fresh = readResults(join(COMPARE_DIRECTORY, freshPath));
  // an error's wording is the engine's own (V8 and JavaScriptCore phrase the same TypeError
  // differently), so errors compare by outcome only; everything else compares exactly
  const comparable = (row: BatteryResults['rows'][number]) => (row.outcome === 'error' ? { ...row, got: '' } : row);
  const changed = fresh.rows.filter((row, index) => {
    const before = committed.rows[index];
    return !before || JSON.stringify(comparable(row)) !== JSON.stringify(comparable(before));
  });
  const sameShape =
    JSON.stringify(fresh.libraries) === JSON.stringify(committed.libraries) &&
    JSON.stringify(fresh.vectors) === JSON.stringify(committed.vectors) &&
    fresh.rows.length === committed.rows.length;

  if (!sameShape || changed.length > 0) {
    const sample = changed.slice(0, 5).map((row) => `${row.library} ${row.id}: ${row.outcome} (${row.got})`);
    const reason = sameShape ? sample.join('\n  ') : 'libraries or vectors changed';
    problems.push(`${freshPath} differs from ${committedArgument}:\n  ${reason}`);
  }

  const ducatMisses = fresh.rows.filter((row) => row.library.startsWith('ducat') && row.outcome !== 'pass');
  for (const miss of ducatMisses) {
    problems.push(`ducat misses ${miss.id} in ${freshPath}: ${miss.outcome} (${miss.got})`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${committedArgument}: ${freshPaths.length} run(s) match; ducat passes every vector`);
