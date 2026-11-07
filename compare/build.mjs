#!/usr/bin/env node
// Bundles a comparison entry point (with ducat's source and every library) into one runtime-neutral
// ESM file, so Node, Bun and Deno all run exactly the same code:
//   node compare/build.mjs battery/run.ts out/battery.mjs
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

const [entry, output] = process.argv.slice(2);
if (!entry || !output) {
  throw new Error('usage: node compare/build.mjs <entry.ts> <output.mjs>');
}

const NODE_BUILTINS = new Set(builtinModules);

/**
 * Some libraries import Node built-ins they never use here (ethers for its network providers,
 * monetra for randomUUID). They stay external, written with the node: prefix, which Node, Bun and
 * Deno all resolve.
 */
const nodeBuiltinsExternal = {
  name: 'node-builtins-external',
  setup(builder) {
    builder.onResolve({ filter: /^[a-z_/:]+$/ }, (args) => {
      const name = args.path.replace(/^node:/, '');
      if (!NODE_BUILTINS.has(name)) {
        return undefined;
      }
      return { path: `node:${name}`, external: true };
    });
  },
};

await build({
  entryPoints: [join(import.meta.dirname, entry)],
  outfile: join(import.meta.dirname, output),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  plugins: [nodeBuiltinsExternal],
  logLevel: 'error',
});
