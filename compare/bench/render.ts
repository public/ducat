// Markdown tables from a benchmark results directory such as compare/results/genoa-2026-11-08-v020-final/,
// which holds one sub-directory per runtime with the runner's bench.json and env.txt. Pure: reads
// files, returns strings; compare/tables.ts decides where they go.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Cell {
  med: number;
  min: number;
  max: number;
}

interface BenchRun {
  runtime: string;
  ms: number;
  rounds: number;
  libs: string[];
  ops: string[];
  ns: Record<string, Record<string, Cell>>;
}

/** never shown: an unpublished build that appears in some raw results */
const HIDDEN_LIBRARIES = new Set(['prototype']);

/** decimal arithmetic libraries without a currency concept; not counted as money libraries */
const DECIMAL_LIBRARIES = new Set([
  'big.js',
  'bignumber.js',
  'decimal.js',
  'decimal.js-light',
  'Prisma.Decimal',
]);

const RUNTIME_ORDER = ['node', 'bun', 'deno'];

const DUCAT = 'ducat methods';
const DINERO = 'dinero.js 2';

function loadRuns(directory: string): BenchRun[] {
  const runs: BenchRun[] = [];
  for (const runtime of RUNTIME_ORDER) {
    const path = join(directory, runtime, 'bench.json');
    if (existsSync(path)) {
      runs.push(JSON.parse(readFileSync(path, 'utf8')) as BenchRun);
    }
  }
  if (runs.length === 0) {
    throw new Error(`no node/, bun/ or deno/ bench.json under ${directory}`);
  }
  return runs;
}

function visibleLibraries(run: BenchRun): string[] {
  return run.libs.filter((library) => !HIDDEN_LIBRARIES.has(library));
}

/** ns per operation, with a precision that suits its size */
export function formatNanoseconds(ns: number): string {
  if (ns >= 1000) {
    return `${(ns / 1000).toFixed(1)} µs`;
  }
  if (ns >= 100) {
    return ns.toFixed(0);
  }
  if (ns >= 10) {
    return ns.toFixed(1);
  }
  return ns.toFixed(2);
}

function tableHeader(firstColumn: string, columns: string[]): string {
  const header = `| ${firstColumn} | ${columns.join(' | ')} |`;
  const alignment = `|---|${columns.map(() => '--:').join('|')}|`;
  return `${header}\n${alignment}\n`;
}

/** Runtime name without the engine details: "node 22.11.0 (V8 ...)" -> "node 22.11.0". */
function shortRuntime(run: BenchRun): string {
  return run.runtime.split(' (')[0]!;
}

/**
 * One section per runtime: median ns per operation for every library, then the round-to-round
 * spread (min to max of the round medians).
 */
export function renderBenchTables(directory: string): string {
  let markdown = '';

  for (const run of loadRuns(directory)) {
    const libraries = visibleLibraries(run);
    markdown += `### ${run.runtime}\n\n`;
    markdown += `Median ns per operation over ${run.rounds} rounds (${run.ms} ms warm-up per cell).\n\n`;

    markdown += tableHeader('ns/op', run.ops);
    for (const library of libraries) {
      const cells = run.ops.map((op) => formatNanoseconds(run.ns[library]![op]!.med));
      markdown += `| ${library} | ${cells.join(' | ')} |\n`;
    }

    markdown += `\nRound-to-round range (min–max of the ${run.rounds} round medians):\n\n`;
    markdown += tableHeader('range', run.ops);
    for (const library of libraries) {
      const cells = run.ops.map((op) => {
        const cell = run.ns[library]![op]!;
        return `${formatNanoseconds(cell.min)}–${formatNanoseconds(cell.max)}`;
      });
      markdown += `| ${library} | ${cells.join(' | ')} |\n`;
    }
    markdown += '\n';
  }
  return markdown;
}

function fastestOtherMoneyLibrary(run: BenchRun, op: string): { library: string; ns: number } {
  const candidates = visibleLibraries(run).filter(
    (library) => !library.startsWith('ducat') && !DECIMAL_LIBRARIES.has(library),
  );

  let fastest = { library: candidates[0]!, ns: run.ns[candidates[0]!]![op]!.med };
  for (const library of candidates) {
    const ns = run.ns[library]![op]!.med;
    if (ns < fastest.ns) {
      fastest = { library, ns };
    }
  }
  return fastest;
}

/**
 * The headline: per operation and runtime, ducat (methods API) next to the fastest other money
 * library and dinero.js 2. Decimal libraries are left out of "fastest other": they carry no
 * currency, so they skip work a money library must do.
 */
/** Shown with every speed table built from the latest Genoa runs. */
export const GENOA_CAVEAT =
  'Measured on 2026-11-08 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, ' +
  'on ducat 0.2.0 (commit 7c9455a). Lower is better; the faster of ducat and the fastest ' +
  'other money library is in bold.';

export function renderSpeedHeadline(directory: string): string {
  const runs = loadRuns(directory);
  const columns = runs.map((run) => shortRuntime(run));
  let markdown = tableHeader('ns/op', columns);

  for (const op of runs[0]!.ops) {
    const cells = runs.map((run) => {
      const ducatNs = run.ns[DUCAT]![op]!.med;
      const fastest = fastestOtherMoneyLibrary(run, op);
      const ducatText = formatNanoseconds(ducatNs);
      const fastestText = `${fastest.library} ${formatNanoseconds(fastest.ns)}`;

      // bold whichever is faster, so the table never claims a win it does not show
      const ducatCell = ducatNs <= fastest.ns ? `**${ducatText}**` : ducatText;
      const fastestCell = fastest.ns < ducatNs ? `**${fastestText}**` : fastestText;

      // dinero.js 2 is the usual reference point; it is named once even when it is the fastest
      if (fastest.library === DINERO) {
        return `${ducatCell} (fastest other: ${fastestCell})`;
      }
      const dinero = formatNanoseconds(run.ns[DINERO]![op]!.med);
      return `${ducatCell} (fastest other: ${fastestCell}; dinero.js 2 ${dinero})`;
    });
    markdown += `| ${op} | ${cells.join(' | ')} |\n`;
  }
  return `${markdown}\n${GENOA_CAVEAT}\n`;
}
