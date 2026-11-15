#!/usr/bin/env node
/**
 * Checks that rust/docs/parity.md has one row for every public API item of ducat's TypeScript, and
 * no row for an item that no longer exists. Run it after `pnpm build` (`pnpm parity:check` does
 * both): it reads the built declarations in dist/ through TypeScript's compiler API, entry by entry
 * as package.json's `exports` maps them (a `*` entry is every file its pattern matches).
 *
 * What is tracked, each as a row keyed by the entry's section and the row's first cell:
 * - Every export of an entry, by its exported name: `money`, `Money`, `RoundingMode`.
 * - Public members of every exported class, and of every exported interface that declares a
 *   method: `Money#add` (instance), `Rate.lookup` (static). Members declared outside dist/ (an
 *   Error's `message` and `stack`) and `#private`, `private` and `protected` ones aren't.
 * - The fields of every exported options type, an interface or type alias whose name ends in
 *   `Options` (or `Option`): `FormatOptions#currencyDisplay`. A union's fields are those of each
 *   of its members; fields it extends from the platform count (`FormatOptions` extends
 *   `Intl.NumberFormatOptions`, read with tsconfig.json's `lib`).
 * - An entry that exports nothing (it is imported for its side effects, as `./iso`) has one row,
 *   `(import)`.
 *
 * Where a row lives: an item many entries export (the same declaration) has its row once, under
 * its home entry, the first entry in `exports` order that exports it, the aggregators `./fn` and
 * `./all` coming last; the other entries' sections say what they re-export. A member declared in an
 * entry's own declaration file (a plugin's `declare module` adding `Money#allocate`) lives in that
 * entry; any other member, and every options field, lives with its type.
 *
 * Also checked: every row's status is `same`, `divergent: [..](design.md#..)`, `not ported: by
 * design` with a reason, or `missing`; no row appears twice; every `missing` row is named in the
 * "Missing, in proposed order" section as `entry` `name`; every link to a design.md section
 * resolves.
 *
 * Usage: node scripts/check-rust-parity.mjs [--list]   (--list prints the tracked rows and exits)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARITY = 'rust/docs/parity.md';
const AGGREGATORS = new Set(['./fn', './all']);
const IMPORT_ROW = '(import)';

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** The declaration files of each entry, in `exports` order. */
function entries() {
  const out = [];
  for (const [entry, target] of Object.entries(pkg.exports)) {
    if (typeof target !== 'object' || !target.types) {
      continue;
    }
    const pattern = target.types.replace(/^\.\//, '');
    let files;
    if (pattern.includes('*')) {
      const [dir, rest] = [path.dirname(pattern), path.basename(pattern)];
      const [prefix, suffix] = rest.split('*');
      const abs = path.join(root, dir);
      if (!fs.existsSync(abs)) {
        fail([`${dir} doesn't exist: run pnpm build first`]);
      }
      files = fs
        .readdirSync(abs)
        .filter(
          (file) => file.startsWith(prefix) && file.endsWith(suffix) && !file.endsWith('.map'),
        )
        .sort()
        .map((file) => path.join(abs, file));
    } else {
      files = [path.join(root, pattern)];
    }
    for (const file of files) {
      if (!fs.existsSync(file)) {
        fail([`${file} doesn't exist: run pnpm build first`]);
      }
    }
    out.push({ entry, files });
  }
  return out;
}

function fail(lines) {
  console.error(`check-rust-parity: ${PARITY} is out of date with dist/*.d.ts\n`);
  for (const msg of lines) {
    console.error(`  ${msg}`);
  }
  console.error('\nAdd, rename or remove the rows (see the top of scripts/check-rust-parity.mjs).');
  process.exit(1);
}

/** The tracked rows, as Map<entry, Set<name>>. */
function trackedRows() {
  const list = entries();
  // the repo's compiler options (its lib decides Intl.NumberFormatOptions' fields)
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config;
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const program = ts.createProgram(
    list.flatMap((item) => item.files),
    {
      ...options,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
  );
  const checker = program.getTypeChecker();
  const entryOfFile = new Map();
  for (const { entry, files } of list) {
    for (const file of files) {
      entryOfFile.set(path.normalize(file), entry);
    }
  }
  const inDist = (decl) =>
    path.normalize(decl.getSourceFile().fileName).startsWith(path.join(root, 'dist') + path.sep);

  // home entry of each exported symbol: exports order, aggregators last
  const ordered = [
    ...list.filter((item) => !AGGREGATORS.has(item.entry)),
    ...list.filter((item) => AGGREGATORS.has(item.entry)),
  ];
  const home = new Map(); // symbol -> { entry, name }
  const exportsOf = new Map();
  for (const { entry, files } of ordered) {
    const syms = [];
    for (const file of files) {
      const sf = program.getSourceFile(file);
      const mod = sf && checker.getSymbolAtLocation(sf);
      if (mod) {
        syms.push(...checker.getExportsOfModule(mod));
      }
    }
    exportsOf.set(entry, syms);
    for (const sym of syms) {
      const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      if (!home.has(target)) {
        home.set(target, { entry, name: sym.name });
      }
    }
  }

  const rows = new Map(list.map((item) => [item.entry, new Set()]));
  for (const { entry } of list) {
    if (exportsOf.get(entry).length === 0) {
      rows.get(entry).add(IMPORT_ROW);
    }
  }
  for (const [target, { entry, name }] of home) {
    rows.get(entry).add(name);
    for (const match of membersOf(target, name)) {
      const file = path.normalize(match.decl.getSourceFile().fileName);
      const own = entryOfFile.get(file);
      const at =
        own && !AGGREGATORS.has(own) && own !== entry && match.declaredByAugmentation ? own : entry;
      rows.get(at).add(match.row);
    }
  }
  return rows;

  function membersOf(symbol, name) {
    const out = [];
    const isClass = symbol.flags & ts.SymbolFlags.Class;
    const isInterface = symbol.flags & ts.SymbolFlags.Interface;
    const isAlias = symbol.flags & ts.SymbolFlags.TypeAlias;
    const isOptions = /Options?$/.test(name) && (isInterface || isAlias);
    if (!isClass && !isInterface && !isOptions) {
      return out;
    }
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    const props = type.isUnion()
      ? type.types.flatMap((member) => checker.getPropertiesOfType(member))
      : checker.getPropertiesOfType(type);
    const hasMethod = props.some((prop) => prop.flags & ts.SymbolFlags.Method);
    if (!isClass && !isOptions && !hasMethod) {
      return out;
    }
    const add = (prop, sep) => {
      for (const decl of prop.declarations ?? []) {
        // an options type's fields include those it extends from the platform (Intl's)
        if (!inDist(decl) && !isOptions) {
          continue;
        }
        if (prop.name.startsWith('#') || prop.name.startsWith('__')) {
          continue;
        }
        const mods = ts.getCombinedModifierFlags(decl);
        if (mods & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) {
          continue;
        }
        if (ts.isConstructorDeclaration(decl)) {
          continue;
        }
        const inModule = (rowName) => {
          for (let node = rowName.parent; node; node = node.parent) {
            if (ts.isModuleDeclaration(node)) {
              return true;
            }
          }
          return false;
        };
        out.push({
          row: `${name}${sep}${prop.name}`,
          decl,
          declaredByAugmentation: inModule(decl),
        });
      }
    };
    for (const prop of props) {
      add(prop, '#');
    }
    if (isClass) {
      const ctor = checker.getTypeOfSymbol(symbol);
      for (const prop of checker.getPropertiesOfType(ctor)) {
        if (prop.name !== 'prototype') {
          add(prop, '.');
        }
      }
    }
    // one row per member name, attributed to its first declaration
    const seen = new Set();
    return out.filter((match) => !seen.has(match.row) && seen.add(match.row));
  }
}

/** The rows of parity.md, as Map<entry, Map<name, {status, line}>>, and the missing-order text. */
function documentedRows() {
  const text = fs.readFileSync(path.join(root, PARITY), 'utf8');
  const lines = text.split('\n');
  const rows = new Map();
  const problems = [];
  let entry = null;
  let order = null;
  for (const [index, line] of lines.entries()) {
    const heading = /^#{2,3} /.test(line);
    if (heading) {
      const match = /^### `(\.[^`]*)`/.exec(line);
      entry = match ? match[1] : null;
      if (entry) {
        if (rows.has(entry)) {
          problems.push(`${PARITY}:${index + 1}: section ${entry} appears twice`);
        }
        rows.set(entry, new Map());
      }
      // the order section runs to the end of the file
      if (/^## Missing, in proposed order/.test(line)) {
        order = '';
      }
      if (order !== null) {
        order += line + '\n';
      }
      continue;
    }
    if (order !== null) {
      order += line + '\n';
    }
    if (!entry || !line.startsWith('| `')) {
      continue;
    }
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim());
    const name = /^`([^`]+)`$/.exec(cells[0])?.[1];
    if (!name) {
      problems.push(`${PARITY}:${index + 1}: first cell isn't one backticked name: ${cells[0]}`);
      continue;
    }
    const status = cells[2] ?? '';
    if (
      !/^(same|missing|divergent: \[[^\]]+\]\(design\.md#[a-z0-9-]+\)|not ported: by design\b.+)/.test(
        status,
      )
    ) {
      problems.push(`${PARITY}:${index + 1}: ${entry} ${name}: bad status: ${status}`);
    }
    const sec = rows.get(entry);
    if (sec.has(name)) {
      problems.push(`${PARITY}:${index + 1}: ${entry} ${name} appears twice`);
    }
    sec.set(name, { status, line: index + 1 });
  }
  if (order === null) {
    problems.push(`${PARITY}: no "## Missing, in proposed order" section`);
  }
  return { rows, problems, order: order ?? '' };
}

const tracked = trackedRows();
if (process.argv.includes('--list')) {
  for (const [entry, names] of tracked) {
    for (const rowName of [...names].sort()) {
      console.log(`${entry}\t${rowName}`);
    }
  }
  process.exit(0);
}
const { rows: documented, problems, order } = documentedRows();
const lacking = [];
const stale = [];
for (const [entry, names] of tracked) {
  const sec = documented.get(entry);
  if (!sec) {
    lacking.push(`${entry}: no section (### \`${entry}\`)`);
    continue;
  }
  for (const rowName of [...names].sort()) {
    if (!sec.has(rowName)) {
      lacking.push(`${entry} ${rowName}: no row`);
    }
  }
}
for (const [entry, sec] of documented) {
  const names = tracked.get(entry);
  if (!names) {
    stale.push(`${entry}: section for an entry package.json doesn't export`);
    continue;
  }
  for (const [rowName, { line }] of sec) {
    if (!names.has(rowName)) {
      stale.push(`${PARITY}:${line}: ${entry} ${rowName}: no such export or member`);
    }
  }
}
const unordered = [];
for (const [entry, sec] of documented) {
  for (const [rowName, { status, line }] of sec) {
    if (status.startsWith('missing') && !order.includes(`\`${entry}\` \`${rowName}\``)) {
      unordered.push(
        `${PARITY}:${line}: ${entry} ${rowName} is missing but not in "Missing, in proposed order"`,
      );
    }
  }
}
// links to design.md's sections must resolve (GitHub's anchors, as test/docs-links.test.ts makes them)
const design = fs
  .readFileSync(path.join(root, 'rust/docs/design.md'), 'utf8')
  .replace(/^```[\s\S]*?^```/gm, '');
const anchors = new Set();
const counts = new Map();
for (const match of design.matchAll(/^#{1,6} (.+)$/gm)) {
  const base = match[1]
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
  const seen = counts.get(base) ?? 0;
  anchors.add(seen === 0 ? base : `${base}-${seen}`);
  counts.set(base, seen + 1);
}
const parity = fs.readFileSync(path.join(root, PARITY), 'utf8');
for (const [index, line] of parity.split('\n').entries()) {
  for (const match of line.matchAll(/\(design\.md#([^)]+)\)/g)) {
    if (!anchors.has(match[1])) {
      problems.push(`${PARITY}:${index + 1}: design.md has no section #${match[1]}`);
    }
  }
}
const all = [...problems, ...lacking, ...stale, ...unordered];
if (all.length) {
  fail(all);
}
let count = 0;
for (const names of tracked.values()) {
  count += names.size;
}
console.log(`check-rust-parity: ${count} rows in ${tracked.size} entries, all in ${PARITY}`);
