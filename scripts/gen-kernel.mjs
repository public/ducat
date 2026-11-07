#!/usr/bin/env node
// The files printed from the Lean proofs in proofs/: src/generated/kernel.ts             the proved
// rounding kernels (proofs/Gen.lean, formatted with oxfmt) test/fixtures/allocate.oracle.json  the
// proved allocation model evaluated on generated cases (proofs/Oracle.lean)
//
// node scripts/gen-kernel.mjs           build the proofs and regenerate both files       (pnpm
// gen:kernel) node scripts/gen-kernel.mjs --check   build the proofs and fail if either file
// differs (pnpm gen:kernel:check) node scripts/gen-kernel.mjs --verify  without Lean: fail if a
// proof uses `sorry` (or `axiom`, `native_decide`, ...), or if either file was edited
//                                         by hand or not regenerated after a change to proofs/   (part of gen:check)
//
// --verify works from a stamp in each file: the SHA-256 of the Lean sources it was generated from,
// and of its own content. Regenerating needs the Lean toolchain (elan) and the Mathlib cache (`cd
// proofs && lake exe cache get`).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const proofsDir = join(root, 'proofs');
const mode = process.argv[2] ?? '--write';

const KERNEL_FILE = 'src/generated/kernel.ts';
const ORACLE_FILE = 'test/fixtures/allocate.oracle.json';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function leanFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.lake') {
      return [];
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return leanFiles(path);
    }
    return entry.name.endsWith('.lean') ? [path] : [];
  });
}

/**
 * Everything the generated files depend on: the Lean sources and the pinned toolchain and packages.
 */
function leanSourcesHash() {
  const files = [
    ...leanFiles(proofsDir),
    ...['lakefile.toml', 'lean-toolchain', 'lake-manifest.json'].map((name) =>
      join(proofsDir, name),
    ),
  ];
  const hash = createHash('sha256');
  for (const file of files.map((path) => relative(root, path)).sort()) {
    hash.update(`${file}\0${readFileSync(join(root, file), 'utf8')}\0`);
  }
  return hash.digest('hex');
}

/**
 * Lean keywords that would let a proof skip or weaken checking. Comments and strings are ignored.
 */
const UNSOUND = /\b(sorry|admit|axiom|native_decide|implemented_by|extern|unsafe)\b/;

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/-[\s\S]*?-\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/--.*$/gm, '');
}

function findUnsound() {
  const found = [];
  for (const file of leanFiles(proofsDir)) {
    const lines = stripCommentsAndStrings(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      const match = UNSOUND.exec(line);
      if (match) {
        found.push(`${relative(root, file)}:${index + 1}: ${match[1]}`);
      }
    });
  }
  return found;
}

/**
 * `#print axioms` on the headline theorems (proofs/CheckAxioms.lean): only Lean's standard axioms
 * are allowed.
 */
function checkAxioms(run) {
  const allowed = new Set(['propext', 'Classical.choice', 'Quot.sound']);
  const output = run(['env', 'lean', 'CheckAxioms.lean']);
  const reports = [
    ...output.matchAll(
      /'([^']+)' (?:depends on axioms: \[([^\]]*)\]|does not depend on any axioms)/g,
    ),
  ];
  const expected = (
    readFileSync(join(proofsDir, 'CheckAxioms.lean'), 'utf8').match(/^#print axioms /gm) ?? []
  ).length;
  if (reports.length !== expected) {
    throw new Error(
      `expected ${expected} axiom reports from CheckAxioms.lean, got ${reports.length}:\n${output}`,
    );
  }
  for (const [, theorem, list] of reports) {
    const extra = (list ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name && !allowed.has(name));
    if (extra.length > 0) {
      throw new Error(`${theorem} depends on non-standard axioms: ${extra.join(', ')}`);
    }
  }
}

// The stamp is the first line of kernel.ts, and the first two fields of the oracle fixture.
function stampKernel(content, sources) {
  return `// lean-sources sha256:${sources} content sha256:${sha256(content)}\n${content}`;
}

function stampOracle(content, sources) {
  return `{"leanSources":"${sources}","contentSha256":"${sha256(content)}","cases":\n${content}}\n`;
}

/**
 * Splits a stamped file into its recorded hashes and its content; null if it has no valid stamp.
 */
function readStamp(file, text) {
  if (file === KERNEL_FILE) {
    const match = /^\/\/ lean-sources sha256:([0-9a-f]{64}) content sha256:([0-9a-f]{64})\n/.exec(
      text,
    );
    return (
      match && { sources: match[1], contentHash: match[2], content: text.slice(match[0].length) }
    );
  }
  const match =
    /^\{"leanSources":"([0-9a-f]{64})","contentSha256":"([0-9a-f]{64})","cases":\n/.exec(text);
  if (!match || !text.endsWith('}\n')) {
    return null;
  }
  return { sources: match[1], contentHash: match[2], content: text.slice(match[0].length, -2) };
}

function formatTypeScript(source) {
  const oxfmt = process.env.OXFMT ?? join(root, 'node_modules/.bin/oxfmt');
  // src/generated is excluded from `pnpm fmt`, so format a copy outside the tree with the repo's
  // settings.
  const dir = mkdtempSync(join(tmpdir(), 'ducat-kernel-'));
  try {
    const file = join(dir, 'kernel.ts');
    writeFileSync(file, source);
    const config = JSON.parse(readFileSync(join(root, '.oxfmtrc.json'), 'utf8'));
    delete config.ignorePatterns;
    delete config.$schema;
    writeFileSync(join(dir, '.oxfmtrc.json'), JSON.stringify(config));
    execFileSync(oxfmt, ['-c', join(dir, '.oxfmtrc.json'), file], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function regenerate() {
  const lake =
    process.env.LAKE ?? join(process.env.ELAN_HOME ?? join(homedir(), '.elan'), 'bin/lake');
  const env = { ...process.env, LEAN_NUM_THREADS: process.env.LEAN_NUM_THREADS ?? '1' };
  const run = (args) =>
    execFileSync(lake, args, { cwd: proofsDir, env, encoding: 'utf8', maxBuffer: 64 << 20 });

  // `lake build` checks every theorem; it fails if any proof does not go through.
  execFileSync(lake, ['build', 'Ducat'], {
    cwd: proofsDir,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  checkAxioms(run);

  const sources = leanSourcesHash();
  return {
    [KERNEL_FILE]: stampKernel(
      formatTypeScript(run(['env', 'lean', '--run', 'Gen.lean'])),
      sources,
    ),
    [ORACLE_FILE]: stampOracle(run(['env', 'lean', '--run', 'Oracle.lean']), sources),
  };
}

const unsound = findUnsound();
if (unsound.length > 0) {
  console.error(`unfinished or unchecked proofs:\n  ${unsound.join('\n  ')}`);
  process.exit(1);
}

if (mode === '--verify') {
  const sources = leanSourcesHash();
  let ok = true;
  for (const file of [KERNEL_FILE, ORACLE_FILE]) {
    const stamp = readStamp(file, readFileSync(join(root, file), 'utf8'));
    if (!stamp || stamp.contentHash !== sha256(stamp.content)) {
      console.error(`${file} was edited by hand: run \`pnpm gen:kernel\``);
      ok = false;
    } else if (stamp.sources !== sources) {
      console.error(`${file} is stale (proofs/ changed): run \`pnpm gen:kernel\``);
      ok = false;
    }
  }
  if (!ok) {
    process.exit(1);
  }
  console.log('no sorry or axiom in proofs/; generated files match the Lean sources');
} else if (mode === '--check') {
  let ok = true;
  for (const [file, text] of Object.entries(regenerate())) {
    if (readFileSync(join(root, file), 'utf8') !== text) {
      console.error(`${file} differs from what the proofs generate: run \`pnpm gen:kernel\``);
      ok = false;
    }
  }
  if (!ok) {
    process.exit(1);
  }
  console.log('proofs check, standard axioms only; generated files are up to date');
} else if (mode === '--write') {
  for (const [file, text] of Object.entries(regenerate())) {
    writeFileSync(join(root, file), text);
    console.log(`wrote ${file}`);
  }
} else {
  console.error(`unknown option ${mode}`);
  process.exit(2);
}
