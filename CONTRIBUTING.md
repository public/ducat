# Contributing to ducat

## Setup

ducat uses [pnpm](https://pnpm.io) (the version is pinned in `package.json`'s `packageManager`
field; `corepack enable` gives you the right one) and Node 24 or later.

```sh
pnpm install --frozen-lockfile
pnpm check        # lint, format check, type checks, size budgets, tests
```

Other scripts: `pnpm test`, `pnpm typecheck`, `pnpm size` (`node scripts/size.mjs --report` prints
sizes without failing), `pnpm gen` (the currency tables), `pnpm gen:check` (checks the currency
tables, and that `src/generated/kernel.ts` matches its Lean sources), `pnpm bench` and `pnpm
bench:vitest`, `pnpm test:runtimes` (Bun, Deno and the engine shells).

`pnpm install` also points git at `.githooks/` (`git config core.hooksPath .githooks`, replacing `.git/hooks`; `git config --unset core.hooksPath` undoes it): a pre-commit hook lints (warnings fail) and
format-checks the staged files, and a commit-msg hook checks the subject is a
[Conventional Commit](https://www.conventionalcommits.org/) of at most 100 characters. CI runs the
same checks on the whole repo, and checks the pull request title, which becomes the squash commit's
subject.

## What a change needs

- `pnpm check` passes.
- **No behaviour change without a test**, and no correctness trade-off for speed or size.
- **No speed regression.** Run the benchmarks before and after for anything on a hot path
  (construction, parsing, arithmetic, rounding, formatting). CodSpeed runs on every pull request.
- **No size regression beyond the budget.** `scripts/size-budgets.json` holds a gzip budget for
  every package export and a few representative snippets. The root entry has an absolute budget
  (`core`); every other entry is budgeted by what it adds over the core (`overCore`: the root and
  the entry bundled together, minus the root alone), so a core change edits only `core` and a
  module's pull request only its own line. `overCoreTolerance` absorbs the few bytes a core change
  moves those differences, since gzip sizes don't add exactly. Snippets keep absolute budgets. A
  new export needs a budget; raising one needs a reason in the pull request. `/fn` and `/all`
  re-export everything, so they have only a loose ceiling (`aggregateCeilings`), a guard against
  blow-ups; raise the ceiling only when a new module pushes past it, and say so in the PR.
- A new entry point needs its `exports` entry and the matching `typesVersions` line, which is what
  TypeScript projects on `node10` resolution (CommonJS) read; `test/exports.test.ts` checks the
  two agree, and `pnpm check:consumers` type-checks the packed package from CommonJS, nodenext and
  bundler projects.
- Never edit `src/generated/` by hand. The currency tables come from the snapshots in `data/`
  through `pnpm gen`; `src/generated/kernel.ts` is printed from the Lean proofs in `proofs/` by
  `pnpm gen:kernel`, which needs the Lean toolchain.

## The Rust port

`rust/` is a Rust port of ducat, checked against `spec/` by `rust/crates/ducat/tests/spec.rs` (the
`Rust` workflow; locally, `cargo test` in `rust/`). A pull request that changes `spec/` or `data/`
keeps it green:

- a new operation goes in the runner's `NOT_YET` list (or gets a Rust implementation), and new cases
  raise its `CASES_PER_AREA` count;
- a change to `data/iso4217-list-one.xml` needs `DUCAT_REGENERATE=1 cargo test -p ducat --test
  iso_table` in `rust/`, which rewrites `rust/crates/ducat/src/iso_table.rs`.

## Code style

The code is meant to be read by people. The minifier renames everything, so readable code costs
nothing in bundle size.

- **Descriptive names.** Single letters only for loop indices (`i`, `j`, `k`) and type parameters
  (`C`, `T`). Prefer `money` and `other`, `sum`, `quotient`, `remainder` to `a`, `b`, `x`, `r`. Name
  helpers for what they do: `normalizeMinor`, `multiplyByRatio`, `divideAndRound`.
- **One statement per line.** No `const x = a, y = b;`, braces on every `if`, and no nested
  ternaries.
- **Blank lines between logical steps**, for example validation, then the fast path, then the slow
  path.
- **Comments say why**, for example why a fast path is exact or why a check is needed. Every
  exported function, class, type and constant has a JSDoc comment.
- **Line width 100** (`printWidth` in `.oxfmtrc.json`). `pnpm fmt` formats, and `pnpm lint` enforces
  `curly`, `no-nested-ternary` and identifier length in `src/` and `scripts/`.
- **Speed and size are not traded for style.** Keep the hot-path structure: no extra allocations, no
  `Math.abs` where two comparisons will do, no imported constants inside tight loops (V8 reads an
  imported binding through an extra indirection). Check with the benchmarks.
- **Generated code follows the same rules**, and goes through the formatter.

## Documentation

The docs follow [Diátaxis](https://diataxis.fr): [tutorials](docs/tutorials), [how-to guides](docs/how-to), [reference](docs/reference) and [explanation](docs/explanation), indexed from [docs/README.md](docs/README.md). The README is the front door and the npm page: what ducat is, the module table and links into the docs. Its links to files outside the package must be absolute GitHub URLs (`test/readme-links.test.ts`).

A change that adds or changes an API updates:

- **the reference page** of its entry (`docs/reference/`, mapped in `PAGES` in `test/docs-reference.test.ts`): the signature, what it returns, how it rounds and what it throws. `test/docs-reference.test.ts` fails, naming the page, for any export, type or method of `Money`, `Fixed`, `ExactMoney`, `Rate` or `MoneyBag` that the reference doesn't mention;
- **the README module table**, for a new entry;
- **a how-to guide**, when the change makes a task possible (`docs/how-to/`, titled "How to …");
- **[docs/explanation/decisions.md](docs/explanation/decisions.md)**, for a product decision, as plain prose with its reasons.

The TypeScript examples in the README and in every file under `docs/` are tests (`test/docs.test.ts`, like Python's doctest). Each block runs as its own module, so it needs its own imports, and the blocks are type-checked. Write a result as `// → value`, the way `show()` in `test/doctest.ts` prints it: `25.00 EUR` for Money, `'text'` for strings, `[...]` and `{ key: value }`, with any note after it. `// throws ClassName` (with an optional note, as in `// throws RoundingError: whole HUF only`) checks that the line throws an instance of that class; the class must be one `test/doctest.ts` knows. `// compile error` is checked as well. A comment without an arrow is a note. On the line before a block, `<!-- doctest: skip (reason) -->` skips it, `<!-- doctest: setup CODE -->` adds hidden setup code, and `<!-- doctest: continue -->` runs it after the previous block in the same file, as one module (for tutorials). Code that isn't TypeScript for ducat (shell commands, another library's API) goes in a `sh` or `js` fence. `test/docs-links.test.ts` checks that every relative link and `#anchor` in the docs resolves.

## Pull requests

Keep them small and focused, with a description that says what changes and why, and the before and
after numbers for anything that touches speed or size. Product decisions are recorded as plain prose
in [docs/explanation/decisions.md](docs/explanation/decisions.md).
