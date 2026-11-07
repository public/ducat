#!/usr/bin/env node
// Bundles the benchmarks once with esbuild and runs the same JS on every engine available:
// Node (V8), Deno (V8), Bun (JSC), and the SpiderMonkey / JavaScriptCore shells installed by jsvu.
// Writes bench/RESULTS.md. Override engine paths with BUN, DENO, SM, JSC env vars.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir, cpus } from 'node:os';
import { join } from 'node:path';

const home = homedir();
const engines = [
  ['node', process.execPath, []],
  ['deno', process.env.DENO ?? join(home, '.deno/bin/deno'), ['run']],
  ['bun', process.env.BUN ?? join(home, '.bun/bin/bun'), []],
  ['spidermonkey', process.env.SM ?? join(home, '.jsvu/bin/sm'), ['-m']],
  ['jsc', process.env.JSC ?? join(home, '.jsvu/bin/jsc'), ['-m']],
].filter(([, bin]) => bin === process.execPath || existsSync(bin));

const build = (entry, out) =>
  execFileSync(
    'npx',
    [
      'esbuild',
      entry,
      '--bundle',
      '--format=esm',
      '--platform=neutral',
      '--main-fields=module,main',
      `--outfile=${out}`,
      '--log-level=warning',
    ],
    { stdio: 'inherit' },
  );
build('bench/designs.ts', 'bench/out/designs.mjs');
build('bench/libs.ts', 'bench/out/libs.mjs');

let md =
  `# Benchmark results\n\n**Indicative only.** Machine: ${cpus().length} vCPU ${cpus()[0]?.model.trim()} (shared, noisy VPS). ` +
  `Each figure is the median of 5 short samples after a short warm-up; run-to-run variation on this box is often ±20-30% and ` +
  `occasionally 2x, so compare orders of magnitude and relative positions, not exact numbers. ` +
  `Generated ${new Date().toISOString().slice(0, 10)} by \`pnpm bench\`.\n\n`;
for (const [section, file] of [
  ['Library comparison', 'bench/out/libs.mjs'],
  ['Representation choice', 'bench/out/designs.mjs'],
]) {
  md += `## ${section}\n\n`;
  for (const [name, bin, args] of engines) {
    process.stderr.write(`running ${file} on ${name}...\n`);
    try {
      md += execFileSync(bin, [...args, file], { encoding: 'utf8', timeout: 900_000 }) + '\n';
    } catch (error) {
      md += `(${name} failed: ${String(error.message).split('\n')[0]})\n\n`;
    }
  }
}
writeFileSync('bench/RESULTS.md', md);
console.log('wrote bench/RESULTS.md');
