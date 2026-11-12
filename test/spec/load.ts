// Finds every vector file through the @ducatjs/money-spec package (the workspace's spec/), the
// way any installed copy of the package would be found.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

/** The directory of the installed @ducatjs/money-spec package (the workspace's spec/). */
export function specDirectory(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve('@ducatjs/money-spec/package.json'));
}

function jsonFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return jsonFilesUnder(path);
    }
    return entry.name.endsWith('.json') ? [path] : [];
  });
}

/** Every vector file in the package, by its path under vectors/ ("core/battery.json"). */
export function loadVectorFiles(): Map<string, unknown> {
  const vectors = join(specDirectory(), 'vectors');
  const files = new Map<string, unknown>();
  for (const path of jsonFilesUnder(vectors).toSorted()) {
    files.set(relative(vectors, path), JSON.parse(readFileSync(path, 'utf8')));
  }
  return files;
}
