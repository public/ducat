// Markdown for the battery results: the full matrix, every non-pass with the value returned, and a
// per-library summary for embedding in documentation.
import type { BatteryResults } from './run.ts';
import type { Outcome } from './vectors.ts';

const SYMBOLS: Record<Outcome, string> = {
  pass: '✓',
  fail: '✗',
  lossy: '~',
  error: '!',
  unsupported: '·',
};

export const LEGEND =
  'Legend: ✓ pass, ✗ wrong value returned silently, ~ accepted but lossy (see note), ' +
  '! threw where a value was expected, · not supported by the library.';

/** "dinero.js 2.0.2 bigint" -> "dinero.js bigint", for narrow column headers */
function shortName(library: string): string {
  return library.replace(/ \d[\d.]*( bigint)?$/, '$1');
}

function rowFor(results: BatteryResults, library: string, id: string) {
  const row = results.rows.find((candidate) => candidate.library === library && candidate.id === id);
  if (!row) {
    throw new Error(`no result for ${library} ${id}`);
  }
  return row;
}

export function renderMatrix(results: BatteryResults): string {
  const header = `| vector | ${results.libraries.map(shortName).join(' | ')} |`;
  const divider = `|---|${results.libraries.map(() => ':-:').join('|')}|`;
  const lines = [header, divider];

  for (const vector of results.vectors) {
    const cells = results.libraries.map((library) => SYMBOLS[rowFor(results, library, vector.id).outcome]);
    lines.push(`| \`${vector.id}\` ${vector.description} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

export function renderNonPasses(results: BatteryResults): string {
  const sections: string[] = [];
  for (const library of results.libraries) {
    const misses = results.rows.filter(
      (row) => row.library === library && row.outcome !== 'pass' && row.outcome !== 'unsupported',
    );
    if (misses.length === 0) {
      continue;
    }

    const items = misses.map((row) => {
      const description = results.vectors.find((vector) => vector.id === row.id)!.description;
      const got = row.got.replaceAll('`', "'");
      const note = row.note ? ` (${row.note})` : '';
      return `- \`${row.id}\` ${SYMBOLS[row.outcome]} ${description}: got \`${got}\`${note}`;
    });
    sections.push(`**${library}**\n\n${items.join('\n')}\n`);
  }
  return sections.join('\n');
}

export function renderSummary(results: BatteryResults): string {
  // values without a currency cannot detect a currency mismatch; that is by design, not an error
  const isByDesign = (row: BatteryResults['rows'][number]) => row.note === 'by design';
  const hasByDesign = results.rows.some(isByDesign);

  const header = ['library', 'pass', 'wrong (silent)', 'lossy', 'threw', 'n/a'];
  if (hasByDesign) {
    header.push('no currency (by design)');
  }
  const lines = [
    `| ${header.join(' | ')} |`,
    `|---|${header
      .slice(1)
      .map(() => '--:')
      .join('|')}|`,
  ];

  for (const library of results.libraries) {
    const rows = results.rows.filter((row) => row.library === library);
    const count = (outcome: Outcome) => rows.filter((row) => row.outcome === outcome && !isByDesign(row)).length;
    const counts = [count('pass'), count('fail'), count('lossy'), count('error'), count('unsupported')];
    if (hasByDesign) {
      counts.push(rows.filter(isByDesign).length);
    }
    lines.push(`| ${library} | ${counts.join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}
