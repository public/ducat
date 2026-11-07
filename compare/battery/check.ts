// Checks a fresh battery run against the committed results, and that ducat passes every vector:
//   node compare/battery/check.ts compare/out/battery-node.json
// A difference means a library changed behaviour (or a vector changed): regenerate with
// `pnpm compare` and review the diff of compare/results/battery.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BatteryResults } from './run.ts';

const COMMITTED_PATH = join(import.meta.dirname, '..', 'results', 'battery.json');

function readResults(path: string): BatteryResults {
  return JSON.parse(readFileSync(path, 'utf8')) as BatteryResults;
}

const freshPaths = process.argv.slice(2);
if (freshPaths.length === 0) {
  throw new Error('usage: node compare/battery/check.ts <fresh-run.json>...');
}

const committed = readResults(COMMITTED_PATH);
const problems: string[] = [];

for (const freshPath of freshPaths) {
  const fresh = readResults(freshPath);
  if (JSON.stringify(fresh) !== JSON.stringify(committed)) {
    const changed = fresh.rows.filter((row, index) => {
      const before = committed.rows[index];
      return JSON.stringify(row) !== JSON.stringify(before);
    });
    const sample = changed.slice(0, 5).map((row) => `${row.library} ${row.id}: ${row.outcome} (${row.got})`);
    problems.push(`${freshPath} differs from compare/results/battery.json:\n  ${sample.join('\n  ')}`);
  }

  const ducatMisses = fresh.rows.filter((row) => row.library === 'ducat' && row.outcome !== 'pass');
  for (const miss of ducatMisses) {
    problems.push(`ducat misses ${miss.id} in ${freshPath}: ${miss.outcome} (${miss.got})`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`battery: ${freshPaths.length} run(s) match the committed results; ducat passes every vector`);
