// Every vector file of @ducatjs/money-spec (the workspace's spec/), imported by package name the way
// a consumer of the package would import it. vitest resolves the name through its alias
// (vitest.config.ts), since ducat's own package.json doesn't depend on the private package.
import schemaFile from '@ducatjs/money-spec/schema/vectors.schema.json' with { type: 'json' };

declare global {
  interface ImportMeta {
    /** Vite's glob import: every matching module, eagerly, by its path from the project root. */
    glob(pattern: string, options: { eager: true; import: 'default' }): Record<string, unknown>;
  }
}

const VECTORS_PREFIX = '/spec/vectors/';

/** The JSON Schema every vector file follows. */
export const vectorSchema: object = schemaFile;

/** Every vector file in the package, by its path under vectors/ ("core/battery.json"). */
export function loadVectorFiles(): Map<string, unknown> {
  const modules = import.meta.glob('@ducatjs/money-spec/vectors/**/*.json', {
    eager: true,
    import: 'default',
  });
  const files = new Map<string, unknown>();
  for (const path of Object.keys(modules).toSorted()) {
    if (!path.startsWith(VECTORS_PREFIX)) {
      throw new Error(`unexpected vector path ${path}`);
    }
    files.set(path.slice(VECTORS_PREFIX.length), modules[path]);
  }
  return files;
}
