// Markdown for the fixed-point benchmark: one table per runtime from the runner's fixed-bench.json
// files under a results directory such as compare/results/genoa-2026-11-08-v030/. Pure: reads files,
// returns a string; compare/tables.ts decides where it goes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatNanoseconds } from '../bench/render.ts';

interface Cell {
  med: number;
  min: number;
  max: number;
}

interface FixedBenchRun {
  kind: 'fixed';
  runtime: string;
  ms: number;
  rounds: number;
  libs: string[];
  ops: string[];
  /** null: the library cannot do the operation in the benchmark's rounding mode */
  ns: Record<string, Record<string, Cell | null>>;
  factor: string;
  divisor: string;
  scale: number;
  mode: string;
}

const RUNTIME_ORDER = ['node', 'bun', 'deno'];

export const NO_FIXED_RUN_YET =
  'No clean-machine run yet; the next run of compare/runner covers it.\n';

function loadRuns(directory: string): FixedBenchRun[] {
  const runs: FixedBenchRun[] = [];
  for (const runtime of RUNTIME_ORDER) {
    const path = join(directory, runtime, 'fixed-bench.json');
    if (existsSync(path)) {
      runs.push(JSON.parse(readFileSync(path, 'utf8')) as FixedBenchRun);
    }
  }
  return runs;
}

function cellText(cell: Cell | null | undefined): string {
  if (!cell) {
    return 'n/a';
  }
  return formatNanoseconds(cell.med);
}

/**
 * Per runtime: median ns per operation for every fixed-point library, n/a where the library cannot
 * round the way the benchmark asks. `libraries` is the current list (the battery's): one added
 * since the run gets "not measured" cells and a footnote. Returns an explanatory line when there is
 * no run yet.
 */
export function renderFixedSpeedTable(directory: string, libraries: readonly string[]): string {
  const runs = loadRuns(directory);
  if (runs.length === 0) {
    return NO_FIXED_RUN_YET;
  }

  const sections: string[] = [];
  let hasUnmeasured = false;
  for (const run of runs) {
    const header = `| ns/op | ${run.ops.join(' | ')} |`;
    const divider = `|---|${run.ops.map(() => '--:').join('|')}|`;
    const unmeasured = libraries.filter((library) => !run.libs.includes(library));
    hasUnmeasured ||= unmeasured.length > 0;
    const rows = [...run.libs, ...unmeasured].map((library) => {
      if (!run.libs.includes(library)) {
        return `| ${library} | ${run.ops.map(() => 'not measured¹').join(' | ')} |`;
      }
      const cells = run.ops.map((operation) => cellText(run.ns[library]?.[operation]));
      return `| ${library} | ${cells.join(' | ')} |`;
    });

    const settings =
      `multiply by ${run.factor} and divide by ${run.divisor}, rounded ${run.mode} to ${run.scale} ` +
      `decimals; median of ${run.rounds} rounds, ${run.ms} ms warm-up per cell`;
    sections.push(`**${run.runtime}** (${settings})\n\n${[header, divider, ...rows].join('\n')}\n`);
  }
  if (hasUnmeasured) {
    sections.push(
      '¹ Added to the benchmark after this run; the next clean-machine run of compare/runner ' +
        'measures it.\n',
    );
  }
  return sections.join('\n');
}
