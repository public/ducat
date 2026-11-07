#!/usr/bin/env node
// Bundles a comparison entry point (with ducat's source and every library) into one runtime-neutral
// ESM file, so Node, Bun and Deno all run exactly the same code:
//   node compare/build.mjs battery/run.ts out/battery.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [entry, output] = process.argv.slice(2);
if (!entry || !output) {
  throw new Error('usage: node compare/build.mjs <entry.ts> <output.mjs>');
}

const outputPath = join(import.meta.dirname, output);
await build({
  entryPoints: [join(import.meta.dirname, entry)],
  outfile: outputPath,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  // monetra imports the bare 'crypto' module (randomUUID, for its ledger)
  external: ['crypto', 'node:crypto'],
  logLevel: 'error',
});

// Deno resolves Node built-ins only with the node: prefix
const bundled = readFileSync(outputPath, 'utf8');
writeFileSync(outputPath, bundled.replaceAll(/from\s*["']crypto["']/g, 'from "node:crypto"'));
