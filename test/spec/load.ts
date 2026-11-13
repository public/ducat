// Every vector file of @ducatjs/money-spec (the workspace's spec/), found by package name the way a
// consumer of the package would find it. ducat's own package.json doesn't depend on the private
// package: vitest resolves the name through its alias (vitest.config.ts), and Bun through
// tsconfig.json's paths.
import schemaFile from '@ducatjs/money-spec/schema/vectors.schema.json' with { type: 'json' };
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

declare global {
  interface ImportMeta {
    /** Vite's glob import: every matching module, eagerly, by its path from the project root. */
    glob(pattern: string, options: { eager: true; import: 'default' }): Record<string, unknown>;
  }
}

/** The JSON Schema every vector file follows. */
export const vectorSchema: object = schemaFile;

function jsonFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return jsonFilesUnder(path);
    }
    return entry.name.endsWith('.json') ? [path] : [];
  });
}

/** Under Bun: the files in the package's directory, which import.meta.resolve finds by name. */
function filesFromPackageDirectory(): Map<string, unknown> {
  const packageJson = fileURLToPath(import.meta.resolve('@ducatjs/money-spec/package.json'));
  const vectors = join(dirname(packageJson), 'vectors');
  const files = new Map<string, unknown>();
  for (const path of jsonFilesUnder(vectors)) {
    const name = relative(vectors, path).split(sep).join('/');
    files.set(name, JSON.parse(readFileSync(path, 'utf8')));
  }
  return files;
}

/** Under vitest (on Node and Deno), which has no import.meta.resolve: a glob import by name. */
function filesFromGlob(): Map<string, unknown> {
  const modules = import.meta.glob('@ducatjs/money-spec/vectors/**/*.json', {
    eager: true,
    import: 'default',
  });
  const files = new Map<string, unknown>();
  for (const [path, contents] of Object.entries(modules)) {
    const match = /\/vectors\/(.+)$/.exec(path);
    if (!match) {
      throw new Error(`unexpected vector path ${path}`);
    }
    files.set(match[1]!, contents);
  }
  return files;
}

/** Every vector file in the package, by its path under vectors/ ("core/battery.json"), sorted. */
export function loadVectorFiles(): Map<string, unknown> {
  const files = process.versions['bun'] ? filesFromPackageDirectory() : filesFromGlob();
  return new Map([...files].toSorted(([first], [second]) => first.localeCompare(second)));
}

/**
 * A table file's rows by operation name without its prefix: sectionsOf('excel/fractions.json')
 * gives { annuities: [...], nper: [...], ... } for the tables excel.annuities, excel.nper, ...
 */
export function sectionsOf(path: string): Record<string, Record<string, unknown>[]> {
  const file = loadVectorFiles().get(path) as
    | { tables?: { op: string; rows: Record<string, unknown>[] }[] }
    | undefined;
  if (!file?.tables) {
    throw new Error(`no table file ${path} in @ducatjs/money-spec`);
  }
  return Object.fromEntries(
    file.tables.map((table) => [table.op.slice(table.op.indexOf('.') + 1), table.rows]),
  );
}
