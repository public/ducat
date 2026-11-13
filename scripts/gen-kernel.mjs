#!/usr/bin/env node
// The files printed from the Lean proofs in proofs/:
//   src/generated/kernel.ts             the proved rounding kernels (proofs/Gen.lean,
//                                       formatted with oxfmt)
//   spec/vectors/<area>/<model>-lean.json   each proved model (allocate, instalments, chunk,
//                                       schedule, increment, xnpv, xirr) evaluated on generated
//                                       cases (proofs/Oracle.lean <model>), as a table in
//                                       @ducatjs/money-spec's format
//
//   node scripts/gen-kernel.mjs           build the proofs and regenerate all of them
//                                         (pnpm gen:kernel)
//   node scripts/gen-kernel.mjs --check   build the proofs and fail if any differs
//                                         (pnpm gen:kernel:check)
//   node scripts/gen-kernel.mjs --verify  without Lean: fail if a proof uses `sorry` (or
//                                         `axiom`, `native_decide`, ...), or if any file
//                                         was edited by hand or not regenerated after a
//                                         change to proofs/ (part of gen:check)
//   node scripts/gen-kernel.mjs --restamp without Lean: rewrite each oracle's envelope (its
//                                         description, provenance and so on) around the
//                                         unchanged rows, after a change to ORACLES below
//
// --verify works from a stamp in each file: the SHA-256 of the Lean sources it was generated from,
// and of its own content. In an oracle the envelope must also be exactly what this script writes. Regenerating needs the Lean toolchain (elan) and the Mathlib cache
// (`cd proofs && lake exe cache get`).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const proofsDir = join(root, 'proofs');
const mode = process.argv[2] ?? '--write';

const KERNEL_FILE = 'src/generated/kernel.ts';
// one vector file per proved model that the TypeScript is checked against (proofs/Oracle.lean
// <model>): its spec area, its table operation (spec/README.md) and the Lean model it evaluates
const ORACLES = {
  allocate: { area: 'allocate', op: 'allocate.byRemainder', model: 'Ducat/Allocate.lean' },
  instalments: { area: 'allocate', op: 'instalments.byRemainder', model: 'Ducat/Schedule.lean' },
  chunk: { area: 'allocate', op: 'chunk', model: 'Ducat/Schedule.lean' },
  schedule: { area: 'allocate', op: 'schedule', model: 'Ducat/Schedule.lean' },
  increment: { area: 'cash', op: 'roundToIncrement.byMode', model: 'Ducat/Cash.lean' },
  xnpv: { area: 'excel', op: 'xnpv.scaled', model: 'Ducat/XnpvModel.lean', iso4217: true },
  xirr: { area: 'excel', op: 'xirr.floor', model: 'Ducat/XnpvModel.lean', iso4217: true },
};
// the ISO 4217 List One whose exponents the currency-carrying oracles' rows are in
// (data/iso4217-list-one.xml), recorded as their data version
const ISO4217_PUBLISHED = '2026-09-17';
const ORACLE_MODELS = Object.keys(ORACLES);
const oracleFile = (model) => `spec/vectors/${ORACLES[model].area}/${model}-lean.json`;
const ducatVersion = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

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

/**
 * An oracle file: the envelope of a @ducatjs/money-spec vector file, then the rows exactly as
 * Oracle.lean printed them. checkedAgainst is the ducat version when the rows last changed.
 */
function stampOracle(model, content, sources, checkedAgainst) {
  const { area, op, model: leanModel, iso4217 } = ORACLES[model];
  const envelope = {
    $schema: '../../schema/vectors.schema.json',
    format: 1,
    area,
    name: `${model}-lean`,
    description: `The proved Lean model in proofs/${leanModel} evaluated on generated cases.`,
    provenance: {
      source: 'lean',
      generator: { name: 'proofs/Oracle.lean', version: `lean-sources sha256:${sources}` },
      method: `lake env lean --run Oracle.lean ${model}, written by scripts/gen-kernel.mjs. The model's properties are proved in proofs/${leanModel}.`,
      ...(iso4217 ? { data: { iso4217: ISO4217_PUBLISHED } } : {}),
    },
    checkedAgainst,
    contentSha256: sha256(content),
  };
  const header = JSON.stringify(envelope).slice(0, -1);
  return `${header},"tables":[{"op":"${op}","rows":\n${content}}]}\n`;
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
  const start = text.indexOf('"rows":\n');
  if (start === -1 || !text.endsWith('}]}\n')) {
    return null;
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return null;
  }
  const version = /^lean-sources sha256:([0-9a-f]{64})$/.exec(
    envelope.provenance?.generator?.version ?? '',
  );
  if (!version) {
    return null;
  }
  return {
    sources: version[1],
    contentHash: envelope.contentSha256,
    checkedAgainst: envelope.checkedAgainst,
    content: text.slice(start + '"rows":\n'.length, -'}]}\n'.length),
  };
}

/** The version an oracle's rows were last checked against: kept while the rows don't change. */
function checkedAgainstFor(model, content) {
  try {
    const stamp = readStamp(oracleFile(model), readFileSync(join(root, oracleFile(model)), 'utf8'));
    if (stamp && stamp.contentHash === sha256(content)) {
      return stamp.checkedAgainst;
    }
  } catch {
    // no file yet
  }
  return ducatVersion();
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
  const files = {
    [KERNEL_FILE]: stampKernel(
      formatTypeScript(run(['env', 'lean', '--run', 'Gen.lean'])),
      sources,
    ),
  };
  // one Oracle run writes every model's cases, so Mathlib is loaded once for all of them
  const oracleDir = mkdtempSync(join(tmpdir(), 'ducat-oracle-'));
  try {
    run(['env', 'lean', '--run', 'Oracle.lean', oracleDir]);
    for (const model of ORACLE_MODELS) {
      const cases = readFileSync(join(oracleDir, `${model}.json`), 'utf8');
      files[oracleFile(model)] = stampOracle(
        model,
        cases,
        sources,
        checkedAgainstFor(model, cases),
      );
    }
  } finally {
    rmSync(oracleDir, { recursive: true, force: true });
  }
  return files;
}

const unsound = findUnsound();
if (unsound.length > 0) {
  console.error(`unfinished or unchecked proofs:\n  ${unsound.join('\n  ')}`);
  process.exit(1);
}

if (mode === '--verify') {
  const sources = leanSourcesHash();
  let ok = true;
  for (const file of [KERNEL_FILE, ...ORACLE_MODELS.map(oracleFile)]) {
    const text = readFileSync(join(root, file), 'utf8');
    const stamp = readStamp(file, text);
    const model = ORACLE_MODELS.find((name) => oracleFile(name) === file);
    const envelopeIsOurs =
      !model ||
      (stamp && text === stampOracle(model, stamp.content, stamp.sources, stamp.checkedAgainst));
    if (!stamp || stamp.contentHash !== sha256(stamp.content) || !envelopeIsOurs) {
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
  // DUCAT_GENERATED_DIR: where to write the generated files when they differ (CI uploads them, so
  // the files can be committed from a machine without Lean)
  const out = process.env.DUCAT_GENERATED_DIR;
  for (const [file, text] of Object.entries(regenerate())) {
    if (readFileSync(join(root, file), 'utf8') !== text) {
      console.error(`${file} differs from what the proofs generate: run \`pnpm gen:kernel\``);
      ok = false;
      if (out) {
        mkdirSync(dirname(join(out, file)), { recursive: true });
        writeFileSync(join(out, file), text);
      }
    }
  }
  if (!ok) {
    process.exit(1);
  }
  console.log('proofs check, standard axioms only; generated files are up to date');
} else if (mode === '--restamp') {
  for (const model of ORACLE_MODELS) {
    const file = oracleFile(model);
    const stamp = readStamp(file, readFileSync(join(root, file), 'utf8'));
    if (!stamp || stamp.contentHash !== sha256(stamp.content)) {
      console.error(`${file}: its rows don't match their stamp, so only Lean can rewrite it`);
      process.exit(1);
    }
    writeFileSync(
      join(root, file),
      stampOracle(model, stamp.content, stamp.sources, stamp.checkedAgainst),
    );
    console.log(`restamped ${file}`);
  }
} else if (mode === '--write') {
  for (const [file, text] of Object.entries(regenerate())) {
    writeFileSync(join(root, file), text);
    console.log(`wrote ${file}`);
  }
} else {
  console.error(`unknown option ${mode}`);
  process.exit(2);
}
