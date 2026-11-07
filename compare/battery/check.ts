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
  if (JSON.stringify(fresh) !== JSON.stringify(committed)) {
    const changed = fresh.rows.filter((row, index) => {
      const before = committed.rows[index];
      return JSON.stringify(row) !== JSON.stringify(before);
    });
    const sample = changed.slice(0, 5).map((row) => `${row.library} ${row.id}: ${row.outcome} (${row.got})`);
    problems.push(`${freshPath} differs from ${committedArgument}:\n  ${sample.join('\n  ')}`);
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
