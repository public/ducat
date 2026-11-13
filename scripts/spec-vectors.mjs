// Writes a vector file of @ducatjs/money-spec (spec/README.md): the envelope, then tables of rows,
// one row per line so a regeneration diff shows exactly which vectors changed. The JavaScript twin
// of scripts/spec_vectors.py, for the generators written in JavaScript; both write the same layout.
//
// checkedAgainst is the ducat version when the rows last changed: it is kept while the rows stay the
// same, so a version bump doesn't make --check fail.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** The path of spec/vectors/<area>/<name>.json. */
export function vectorPath(area, name) {
  return join(ROOT, 'spec', 'vectors', area, `${name}.json`);
}

function rowsText(tables) {
  const parts = tables.map(({ rows, ...head }) => {
    const headText = JSON.stringify(head).slice(0, -1);
    const body = rows.map((row) => JSON.stringify(row)).join(',\n');
    return `${headText},"rows":[\n${body}\n]}`;
  });
  return `[\n${parts.join(',\n')}\n]`;
}

function checkedAgainst(path, contentHash) {
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, 'utf8'));
    if (existing.contentSha256 === contentHash) {
      return existing.checkedAgainst;
    }
  }
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

/** The file's text. Each table is { op, rows } plus optional fields. */
export function fileText(area, name, description, provenance, tables) {
  const rows = rowsText(tables);
  const contentHash = createHash('sha256').update(rows).digest('hex');
  const envelope = {
    $schema: '../../schema/vectors.schema.json',
    format: 1,
    area,
    name,
    description,
    provenance,
    checkedAgainst: checkedAgainst(vectorPath(area, name), contentHash),
    contentSha256: contentHash,
  };
  return `${JSON.stringify(envelope).slice(0, -1)},"tables":${rows}}\n`;
}
