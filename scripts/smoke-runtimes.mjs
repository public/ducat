#!/usr/bin/env node
// Runs the full vitest suite on Node, Bun (bun test) and Deno, then the bundled smoke test on every
// engine found, including old Node (/usr/bin/node) and the jsvu SpiderMonkey / JSC shells.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = homedir();
const BUN = process.env.BUN ?? join(home, '.bun/bin/bun');
const DENO = process.env.DENO ?? join(home, '.deno/bin/deno');
const run = (bin, args) => execFileSync(bin, args, { stdio: 'inherit' });

const suites = [
  ['node', process.execPath, ['node_modules/vitest/vitest.mjs', 'run']],
  ['bun', BUN, ['test']],
  ['deno', DENO, ['run', '-A', 'node_modules/vitest/vitest.mjs', 'run']],
];
for (const [name, bin, args] of suites) {
  if (bin !== process.execPath && !existsSync(bin)) { console.log(`skip ${name} (not installed)`); continue; }
  console.log(`\n== full suite on ${name}`);
  run(bin, args);
}

execFileSync('npx', ['esbuild', 'test/smoke.ts', '--bundle', '--format=esm', '--platform=neutral', '--outfile=bench/out/smoke.mjs', '--log-level=warning'], { stdio: 'inherit' });
const smoke = [
  [process.execPath, ['bench/out/smoke.mjs']],
  ['/usr/bin/node', ['bench/out/smoke.mjs']],
  [BUN, ['bench/out/smoke.mjs']],
  [DENO, ['run', 'bench/out/smoke.mjs']],
  [join(home, '.jsvu/bin/sm'), ['-m', 'bench/out/smoke.mjs']],
  [join(home, '.jsvu/bin/jsc'), ['-m', 'bench/out/smoke.mjs']],
];
console.log('\n== smoke test per engine');
for (const [bin, args] of smoke) if (bin === process.execPath || existsSync(bin)) run(bin, args);
