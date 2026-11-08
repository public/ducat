// A Markdown table from compare/results/sizes.tsv (written by sizes.sh). Pure: reads the file,
// returns a string.
import { existsSync, readFileSync } from 'node:fs';

/** never shown: an unpublished build that appears in some raw results */
const HIDDEN_LIBRARIES = new Set(['prototype']);

function kilobytes(bytes: string): string {
  return `${(Number(bytes) / 1024).toFixed(1)} KiB`;
}

function renderRows(tsvPath: string): string {
  const lines = readFileSync(tsvPath, 'utf8').trim().split('\n');
  const rows = lines.slice(1).map((line) => line.split('\t'));
  const visibleRows = rows.filter(([library]) => !HIDDEN_LIBRARIES.has(library!));
  const sortedRows = visibleRows.toSorted((first, second) => Number(first[2]) - Number(second[2]));

  let markdown =
    '| library | program, min | program, gzip | whole package, min | whole package, gzip |\n';
  markdown += '|---|--:|--:|--:|--:|\n';
  for (const [library, snippetMin, snippetGzip, fullMin, fullGzip] of sortedRows) {
    const cells = [snippetMin, snippetGzip, fullMin, fullGzip].map((bytes) => kilobytes(bytes!));
    markdown += `| ${library} | ${cells.join(' | ')} |\n`;
  }
  return markdown;
}

/**
 * Per money library: the same small program (create, add, multiply, toDecimal) and the whole
 * package, minified and gzipped, smallest program first.
 */
export function renderSizeTable(tsvPath: string): string {
  return renderRows(tsvPath);
}

/**
 * Per fixed-point decimal library: the same small program (parse, add, multiply rounding to 2
 * decimals, toString) and the whole package, smallest program first. Tolerates a missing file, for
 * checkouts where sizes.sh has not covered the fixed-point libraries yet.
 */
export function renderFixedSizeTable(tsvPath: string): string {
  if (!existsSync(tsvPath)) {
    return 'No size run yet; the next run of compare/sizes/sizes.sh covers it.\n';
  }
  return renderRows(tsvPath);
}
