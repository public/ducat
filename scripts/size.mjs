#!/usr/bin/env node
// Bundles every package entry point and a set of representative snippets with esbuild (minified
// ESM), gzips each bundle at level 9, and fails if any is over its budget in
// scripts/size-budgets.json.
//
//   node scripts/size.mjs            check the budgets
//   node scripts/size.mjs --report   print the sizes without failing
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const budgets = JSON.parse(readFileSync(join(root, 'scripts/size-budgets.json'), 'utf8'));
const reportOnly = process.argv.includes('--report');

// Resolves '@ducatjs/money/allocate' to src/plugins/allocate.ts through package.json "exports"
// (./dist/X.js -> src/X.ts), so the sizes are measured from source without a build.
const resolveFromSource = {
  name: 'resolve-from-source',
  setup(builder) {
    const packageName = packageJson.name;
    const pattern = new RegExp(`^${packageName.replace('/', '\\/')}(\\/.*)?$`);
    builder.onResolve({ filter: pattern }, (args) => {
      const exportKey = '.' + args.path.slice(packageName.length);
      const target = packageJson.exports[exportKey]?.default;
      if (target === undefined) {
        return { errors: [{ text: `${args.path} is not in package.json "exports"` }] };
      }
      const sourcePath = target.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
      return { path: join(root, sourcePath) };
    });
  },
};

async function measure(contents) {
  const result = await build({
    stdin: { contents, resolveDir: root, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    write: false,
    plugins: [resolveFromSource],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].contents;
  return { minified: code.length, gzipped: gzipSync(code, { level: 9 }).length };
}

const cases = [];
for (const [exportKey, target] of Object.entries(packageJson.exports)) {
  if (typeof target !== 'object') {
    continue;
  }
  const specifier = packageJson.name + exportKey.slice(1);
  cases.push({
    name: specifier,
    code: `export * from '${specifier}';`,
    budget: budgets.entries[specifier],
  });
}
for (const [name, snippet] of Object.entries(budgets.snippets)) {
  cases.push({ name, code: snippet.code, budget: snippet.gzipped });
}

const kilobytes = (bytes) => (bytes / 1000).toFixed(2) + ' kB';
const rows = [['bundle', 'minified', 'gzipped', 'budget', '']];
let failures = 0;

for (const testCase of cases) {
  const { minified, gzipped } = await measure(testCase.code);
  const hasBudget = testCase.budget !== undefined;
  const isOver = !hasBudget || gzipped > testCase.budget * 1000;
  if (isOver && !reportOnly) {
    failures++;
  }
  rows.push([
    testCase.name,
    kilobytes(minified),
    kilobytes(gzipped),
    hasBudget ? `${testCase.budget} kB` : 'none',
    isOver ? 'OVER' : 'ok',
  ]);
}

const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
for (const row of rows) {
  const cells = row.map((cell, column) =>
    column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]),
  );
  console.log(cells.join('  '));
}

if (failures > 0) {
  console.error(
    `\n${failures} bundle(s) over budget or without one: see scripts/size-budgets.json`,
  );
  process.exit(1);
}
