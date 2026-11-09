#!/usr/bin/env node
// Bundles every package entry point and a set of representative snippets with esbuild (minified
// ESM), gzips each bundle at level 9, and fails if any is over its budget in
// scripts/size-budgets.json.
//
// Every entry except the root is budgeted by what it adds over the core: the gzipped size of the
// root and the entry bundled together, minus the root's alone. A core change then edits only the
// root's budget, and a module's pull request only its own line. gzip sizes don't add exactly, so a
// core change still moves those differences by a few bytes; `overCoreTolerance` (in kB) absorbs
// that. Snippets keep absolute budgets: they are what a user ships.
//
// /fn and /all re-export every module, so a tight budget on them would change with every new
// module and make every open pull request conflict. They get a loose absolute ceiling instead,
// which only catches a blow-up; each module's own budget is what holds its size.
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

// The "default" target of an export key, through a pattern key (`./iso/*`) where one matches.
function targetOf(exportKey) {
  const exact = packageJson.exports[exportKey]?.default;
  if (exact !== undefined) {
    return exact;
  }
  for (const [key, target] of Object.entries(packageJson.exports)) {
    const [prefix, suffix] = key.split('*');
    if (
      suffix !== undefined &&
      exportKey.startsWith(prefix) &&
      exportKey.endsWith(suffix) &&
      exportKey.length > prefix.length + suffix.length
    ) {
      return target.default.replace(
        '*',
        exportKey.slice(prefix.length, exportKey.length - suffix.length),
      );
    }
  }
  return undefined;
}

// Resolves '@ducatjs/money/allocate' to src/plugins/allocate.ts through package.json "exports"
// (./dist/X.js -> src/X.ts), so the sizes are measured from source without a build.
const resolveFromSource = {
  name: 'resolve-from-source',
  setup(builder) {
    const packageName = packageJson.name;
    const pattern = new RegExp(`^${packageName.replace('/', '\\/')}(\\/.*)?$`);
    builder.onResolve({ filter: pattern }, (args) => {
      const exportKey = '.' + args.path.slice(packageName.length);
      const target = targetOf(exportKey);
      if (target === undefined) {
        return { errors: [{ text: `${args.path} is not in package.json "exports"` }] };
      }
      const sourcePath = target.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
      return { path: join(root, sourcePath) };
    });
  },
};

// Optional peer dependencies (drizzle-orm, ...) are the user's own: measure only ducat's code.
const peerDependencies = Object.keys(packageJson.peerDependencies ?? {});
const external = peerDependencies.flatMap((name) => [name, `${name}/*`]);

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
    external,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].contents;
  return { minified: code.length, gzipped: gzipSync(code, { level: 9 }).length };
}

const rootName = packageJson.name;
// A namespace re-export keeps every root export, and can't clash with an entry's own names.
const withCore = (code) => `export * as core from '${rootName}';\n${code}`;
const coreAlone = await measure(withCore(''));

const cases = [];
for (const [exportKey, target] of Object.entries(packageJson.exports)) {
  if (typeof target !== 'object') {
    continue;
  }
  // a pattern entry (one module per ISO code) is measured for one code
  const specifier = rootName + exportKey.slice(1).replace('*', 'EUR');
  if (specifier === rootName) {
    cases.push({ name: specifier, code: `export * from '${specifier}';`, budget: budgets.core });
  } else if (specifier in budgets.aggregateCeilings) {
    cases.push({
      name: specifier,
      code: `export * from '${specifier}';`,
      budget: budgets.aggregateCeilings[specifier],
      isCeiling: true,
    });
  } else {
    cases.push({
      name: specifier,
      code: `export * from '${specifier}';`,
      budget: budgets.overCore[specifier],
      isOverCore: true,
    });
  }
}
for (const [name, snippet] of Object.entries(budgets.snippets)) {
  cases.push({ name, code: snippet.code, budget: snippet.gzipped });
}
for (const name of Object.keys(budgets.overCore)) {
  if (!cases.some((testCase) => testCase.name === name)) {
    console.error(`${name} has a budget but is not in package.json "exports"`);
    process.exitCode = 1;
  }
}

const kilobytes = (bytes) => (bytes / 1000).toFixed(2) + ' kB';
const rows = [['bundle', 'minified', 'gzipped', 'over core', 'budget', '']];
let failures = 0;

for (const testCase of cases) {
  const { minified, gzipped } = await measure(testCase.code);
  const hasBudget = testCase.budget !== undefined;
  let overCore = '';
  let measured = gzipped;
  let allowed = hasBudget ? testCase.budget * 1000 : 0;
  let budgetText = hasBudget ? `${testCase.budget} kB` : 'none';
  if (testCase.isOverCore) {
    const combined = await measure(withCore(testCase.code));
    measured = combined.gzipped - coreAlone.gzipped;
    overCore = kilobytes(measured);
    allowed += budgets.overCoreTolerance * 1000;
    budgetText = hasBudget ? `+${testCase.budget} kB` : 'none';
  } else if (testCase.isCeiling) {
    budgetText += ' (ceiling)';
  }
  const isOver = !hasBudget || measured > allowed;
  if (isOver && !reportOnly) {
    failures++;
  }
  rows.push([
    testCase.name,
    kilobytes(minified),
    kilobytes(gzipped),
    overCore,
    budgetText,
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
