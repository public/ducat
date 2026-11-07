#!/usr/bin/env node
// Builds the Lean proofs in proofs/ and regenerates what is printed from them:
//   src/generated/kernel.ts             the proved rounding kernels (`lake exe gen`)
//   test/fixtures/allocate.oracle.json  the proved allocation model evaluated on generated cases (`lake exe oracle`)
//
//   node scripts/gen-kernel.mjs           regenerate both
//   node scripts/gen-kernel.mjs --check   exit 1 if either is stale or any proof uses `sorry`
//
// Needs the Lean toolchain (elan) and the Mathlib cache in proofs/.lake (`cd proofs && lake exe cache get`).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const proofs = join(root, 'proofs');
const check = process.argv.includes('--check');

// 1. No proof may be left open.
const leanFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? leanFiles(join(dir, e.name)) : e.name.endsWith('.lean') ? [join(dir, e.name)] : [],
  );
const open = [];
for (const f of [...leanFiles(join(proofs, 'Ducat')), join(proofs, 'Gen.lean')]) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/\b(sorry|admit)\b/.test(line.replace(/--.*$/, ''))) open.push(`${f.slice(root.length + 1)}:${i + 1}`);
    });
}
if (open.length) {
  console.error(`unfinished proofs:\n  ${open.join('\n  ')}`);
  process.exit(1);
}

// 2. Build the proofs (fails if any theorem does not check), then print the generated files.
const lake = process.env.LAKE ?? (process.env.ELAN_HOME ?? join(homedir(), '.elan')) + '/bin/lake';
const env = { ...process.env, LEAN_NUM_THREADS: process.env.LEAN_NUM_THREADS ?? '1' };
execFileSync(lake, ['build'], { cwd: proofs, env, stdio: ['ignore', 'inherit', 'inherit'] });
const outputs = [
  ['gen', 'src/generated/kernel.ts'],
  ['oracle', 'test/fixtures/allocate.oracle.json'],
];
let stale = false;
for (const [exe, file] of outputs) {
  const text = execFileSync(lake, ['exe', exe], { cwd: proofs, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  const path = join(root, file);
  if (!check) {
    writeFileSync(path, text);
    console.log(`wrote ${file}`);
  } else if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
    console.error(`${file} is stale: run \`npm run gen:kernel\``);
    stale = true;
  }
}
if (stale) process.exit(1);
if (check) console.log('proofs check, no sorry, generated files up to date');
