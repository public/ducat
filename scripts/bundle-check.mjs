#!/usr/bin/env node
// Bundles small consumer programs against the built package (dist/, through package.json "exports"
// and "sideEffects", as an app would import it) with esbuild and with Rollup, runs each bundle, and
// checks that the Money methods are there exactly when the program imports an entry that installs
// them. A wrong "sideEffects" list lets a bundler drop the import that installs the methods, which no
// source-level test sees. Run after `pnpm build`.
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rollup } from 'rollup';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Each program prints whether a Money value has its methods, or fails with an error.
const PROBE = "console.log(typeof m.add === 'function' ? 'methods' : 'no methods');";
const programs = [
  {
    name: 'root entry',
    expect: 'methods',
    code: `import { money } from '@ducatjs/money'; const m = money('1', 'EUR'); ${PROBE}`,
  },
  {
    name: 'root entry for its side effect, then /fn',
    expect: 'methods',
    code: `import '@ducatjs/money'; import { money } from '@ducatjs/money/fn'; const m = money('1', 'EUR'); ${PROBE}`,
  },
  {
    name: '/all for its side effect, then /fn',
    expect: 'methods',
    code: `import '@ducatjs/money/all'; import { money } from '@ducatjs/money/fn'; const m = money('1', 'EUR'); ${PROBE}`,
  },
  {
    name: 'an opt-in module and the root entry',
    expect: 'methods',
    code: `import { money } from '@ducatjs/money'; import '@ducatjs/money/tax'; const m = money('1', 'EUR'); if (typeof m.addTax !== 'function') throw new Error('no addTax'); ${PROBE}`,
  },
  {
    name: 'a named import from /all',
    expect: 'methods',
    code: `import { money } from '@ducatjs/money/all'; const m = money('1', 'EUR'); ${PROBE}`,
  },
  {
    name: '/fn and an opt-in module, without the root entry',
    expect: 'no methods',
    code: `import { money } from '@ducatjs/money/fn'; import { EUR } from '@ducatjs/money/iso'; import '@ducatjs/money/tax'; const m = money('1', EUR); if (typeof m.addTax !== 'function') throw new Error('no addTax'); ${PROBE}`,
  },
  {
    name: '/fn alone',
    expect: 'no methods',
    code: `import { money, add, toDecimal } from '@ducatjs/money/fn'; import { EUR } from '@ducatjs/money/iso'; const m = money('1', EUR); toDecimal(add(m, m)); ${PROBE}`,
  },
  {
    // the ISO table is registered by the root entry or /iso/all, not by /fn
    name: '/fn alone with a code as a string',
    throws: true,
    expect: 'Unknown currency "EUR"',
    code: `import { money } from '@ducatjs/money/fn'; const m = money('1', 'EUR'); ${PROBE}`,
  },
  {
    name: '/iso/all, then /fn with a code as a string',
    expect: 'no methods',
    code: `import '@ducatjs/money/iso/all'; import { money } from '@ducatjs/money/fn'; const m = money('1', 'EUR'); ${PROBE}`,
  },
];

// A throwaway app whose node_modules/@ducatjs/money is this package, so resolution goes through
// package.json exactly as for a user.
const app = mkdtempSync(join(tmpdir(), 'ducat-bundle-check-'));
mkdirSync(join(app, 'node_modules', '@ducatjs'), { recursive: true });
symlinkSync(root, join(app, 'node_modules', '@ducatjs', 'money'), 'dir');

let failures = 0;
try {
  for (const program of programs) {
    const entry = join(app, `${program.name.replace(/\W+/g, '-')}.mjs`);
    writeFileSync(entry, program.code);

    const esbuildOut = join(app, 'esbuild-out.mjs');
    await build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: esbuildOut,
      logLevel: 'silent',
      preserveSymlinks: true,
    });

    const bundle = await rollup({
      input: entry,
      plugins: [nodeResolve({ preserveSymlinks: true })],
      onwarn: () => {},
    });
    const rollupOut = join(app, 'rollup-out.mjs');
    await bundle.write({ file: rollupOut, format: 'es' });
    await bundle.close();

    for (const [bundler, file] of [
      ['esbuild', esbuildOut],
      ['rollup', rollupOut],
    ]) {
      const lines = [];
      const original = console.log;
      console.log = (line) => lines.push(String(line));
      try {
        await import(`${pathToFileURL(file).href}?${bundler}-${program.name}`);
      } catch (error) {
        lines.push(String(error.message));
      } finally {
        console.log = original;
      }
      const got = lines.join('\n');
      // a program expected to fail passes when the error message starts with `expect`
      const ok = program.throws ? got.startsWith(program.expect) : got === program.expect;
      if (!ok) {
        failures++;
      }
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${bundler.padEnd(8)} ${program.name}: ${got}`);
    }
  }
} finally {
  rmSync(app, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(
    `\n${failures} bundle(s) got the methods or currencies wrong: check "sideEffects" in package.json`,
  );
  process.exit(1);
}
