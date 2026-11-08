// Every data file the package ships is credited in NOTICE: its source, and its licence where it
// has one. A new file under data/ fails this test until NOTICE names it (a directory such as
// data/rbnf/ may be named once for all its files).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

it('NOTICE names every file under data/', () => {
  const notice = readFileSync(join(root, 'NOTICE'), 'utf8');
  const missing = readdirSync(join(root, 'data'))
    .map((name) =>
      statSync(join(root, 'data', name)).isDirectory() ? `data/${name}/` : `data/${name}`,
    )
    .filter((path) => !notice.includes(path));
  expect(missing).toEqual([]);
});
