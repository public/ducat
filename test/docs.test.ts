// Runs the TypeScript examples in README.md and docs/**/*.md, like Python's doctest, so the documentation
// can't drift from the code.
//
// Every ```ts block is a module of its own, with `@ducatjs/money` imports pointed at src/. A statement on one
// line whose comment starts with an arrow is checked against what it returns:
//
//   total.multiply('1.075'); // → 26.88 EUR (anything after the value is a note)
//   toStripeAmount(money('10.45', 'HUF'), { payout: true }); // throws RoundingError: whole HUF only
//
// `// throws` names the error class, which the error must be an instance of (a subclass counts).
// `// compile error` means the line must fail to type-check and throw at run time.
// `const name = …; // → value` checks `name`. Values are written as `show()` prints them: Money as
// `12.34 EUR`, Fixed as `12.34`, strings in single quotes, arrays in brackets and objects as `{ key: value }`.
// Comments without an arrow are notes and aren't checked. An HTML comment just before a block can say
// `<!-- doctest: continue -->` runs the block after the previous one in the same file, as one module, so
// a tutorial's steps can build on each other. `<!-- doctest: skip (reason) -->` or
// `<!-- doctest: setup CODE -->` (hidden setup code, such as loading a
// fixture).
//
// The examples are type-checked too, so a `// @ts-expect-error` in an example must be a real error.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { documentedErrorClass, failures } from './doctest.js';
import { MUTATION } from './fc-config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test', '.doctest');
const PACKAGE_NAME = '@ducatjs/money';

interface Example {
  /** The markdown file, relative to the repo root. */
  file: string;
  /** The line in that file where the block's code starts. */
  line: number;
  code: string[];
  /** The source line of each line of `code` (a continued block starts with the previous block's). */
  lines: number[];
  skip?: boolean;
  setup?: string;
}

/** The ```ts blocks of a markdown file, with the doctest directive just before each one. */
function examplesIn(file: string, markdown: string): Example[] {
  const lines = markdown.split('\n');
  const examples: Example[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '```ts') {
      continue;
    }

    const example: Example = { file, line: i + 2, code: [], lines: [] };
    // the directive is the last non-blank line before the block (the formatter adds a blank line after it)
    let previous = i - 1;
    while (previous > 0 && lines[previous] === '') {
      previous--;
    }
    const before = lines[previous] ?? '';
    const directive = /^<!-- doctest: (skip|setup|continue)\b ?(.*?) ?-->$/.exec(before);
    if (directive?.[1] === 'continue') {
      const earlier = examples.at(-1);
      if (earlier === undefined) {
        throw new Error(`${file}:${example.line}: nothing to continue`);
      }
      example.code.push(...earlier.code);
      example.lines.push(...earlier.lines);
      if (earlier.setup !== undefined) {
        example.setup = earlier.setup;
      }
    } else if (directive?.[1] === 'setup') {
      example.setup = directive[2] ?? '';
    } else if (directive?.[1] === 'skip') {
      example.skip = true;
    }

    for (i++; lines[i] !== '```'; i++) {
      if (i >= lines.length) {
        throw new Error(`${file}:${example.line}: unclosed code block`);
      }
      example.code.push(lines[i] ?? '');
      example.lines.push(i + 1);
    }
    examples.push(example);
  }
  return examples;
}

/** `@ducatjs/money/fixed` → the source file the package export points at, relative to `fromDir`. */
function sourceFor(specifier: string, fromDir: string): string {
  const exports = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).exports;
  const subpath = '.' + specifier.slice(PACKAGE_NAME.length);
  let target: string | undefined = exports[subpath]?.default;
  if (target === undefined) {
    // a wildcard export, such as ./iso/* for @ducatjs/money/iso/EUR
    for (const [pattern, value] of Object.entries<{ default: string }>(exports)) {
      const [prefix, suffix] = pattern.split('*');
      if (
        suffix !== undefined &&
        subpath.startsWith(prefix!) &&
        subpath.endsWith(suffix) &&
        subpath.length > prefix!.length + suffix.length
      ) {
        const star = subpath.slice(prefix!.length, subpath.length - suffix.length);
        target = value.default.replace('*', star);
        break;
      }
    }
  }
  if (target === undefined) {
    throw new Error(`${specifier} is not a package export`);
  }
  const source = join(ROOT, target.replace(/^\.\/dist\//, 'src/'));
  return relative(fromDir, source).replace(/^(?!\.)/, './');
}

const CHECKED = /^(\s*)(?:(?:const|let) (\w+) = )?(.+?);\s*\/\/ (→|throws|compile error)\s?(.*)$/;

/** The example as a module that checks each arrow comment, with `@ducatjs/money` imports pointed at src/. */
function toModule(example: Example, dir: string): string {
  const output: string[] = [
    `import { check, checkThrows } from '${relative(dir, join(ROOT, 'test', 'doctest.js'))}';`,
  ];
  if (example.setup) {
    output.push(example.setup);
  }
  example.code.forEach((text, index) => {
    const line = example.lines[index]!;
    const rewritten = text.replace(
      new RegExp(`'(${PACKAGE_NAME}(?:/[^']*)?)'`, 'g'),
      (_, specifier) => `'${sourceFor(specifier, dir)}'`,
    );
    const match = CHECKED.exec(rewritten);
    if (!match) {
      output.push(rewritten);
      return;
    }

    const [, indent, name, expression, kind, expected] = match;
    if (kind === 'compile error') {
      // the type error must be real, and the call must still throw when types are erased
      output.push(`${indent}// @ts-expect-error`);
      output.push(`${indent}checkThrows(${line}, () => ${expression});`);
    } else if (kind === 'throws') {
      const errorName = documentedErrorClass(expected ?? '');
      if (errorName === undefined) {
        throw new Error(
          `${example.file}:${line}: name the error class, as in // throws RangeError`,
        );
      }
      output.push(`${indent}checkThrows(${line}, () => ${expression}, '${errorName}');`);
    } else if (name) {
      output.push(`${indent}const ${name} = ${expression};`);
      output.push(`${indent}check(${line}, ${name}, ${JSON.stringify(expected)});`);
    } else {
      output.push(`${indent}check(${line}, ${expression}, ${JSON.stringify(expected)});`);
    }
  });
  return output.join('\n') + '\n';
}

/** README.md and every markdown file under docs/, relative to the repo root. */
export const DOCUMENTS = [
  'README.md',
  ...readdirSync(join(ROOT, 'docs'), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .map((path) => `docs/${path.split('\\').join('/')}`)
    .sort(),
];

const examples = DOCUMENTS.flatMap((document) =>
  examplesIn(document, readFileSync(join(ROOT, document), 'utf8')),
);

describe('documentation examples', () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const files: { path: string; example: Example }[] = [];
  for (const example of examples) {
    if (example.skip) {
      continue;
    }
    const name = example.file.replace(/\.md$/, '').replace(/[^A-Za-z0-9]+/g, '-');
    const path = join(OUT, `${name}-line-${example.line}.ts`);
    writeFileSync(path, toModule(example, OUT));
    files.push({ path, example });
  }

  it('has examples to run', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { path, example } of files) {
    it(`the example at ${example.file}:${example.line} returns what its comments say`, async () => {
      failures.length = 0;
      // A fresh module registry, so the example gets its own Money class and currency registry: a
      // method or ISO code another example's import installed doesn't leak into this one (#278).
      // bun test shares one registry and has no resetModules; there the examples aren't isolated.
      if (typeof vi.resetModules === 'function') {
        vi.resetModules();
      }
      await import(pathToFileURL(path).href);
      const report = failures.map(
        (failure) => `${example.file}:${failure.line}: ${failure.message}`,
      );
      expect(report.join('\n\n')).toBe('');
    });
  }

  // #278: one example's side-effect import must not install methods or currencies for the next
  it.skipIf(typeof vi.resetModules !== 'function')(
    'runs each example in its own module registry',
    async () => {
      const src = (path: string) => pathToFileURL(join(ROOT, 'src', path)).href;
      vi.resetModules();
      await import(src('plugins/tax.ts'));
      const withTax = (await import(src('index.ts'))) as typeof import('../src/index.js');
      expect(typeof (withTax.money('1', 'EUR') as { addTax?: unknown }).addTax).toBe('function');
      vi.resetModules();
      const fresh = (await import(src('fn.ts'))) as typeof import('../src/fn.js');
      expect(fresh.isCurrency('EUR')).toBe(false);
      const root = (await import(src('index.ts'))) as typeof import('../src/index.js');
      expect(typeof (root.money('1', 'EUR') as { addTax?: unknown }).addTax).toBe('undefined');
    },
  );

  it.skipIf(MUTATION)(
    'the examples type-check',
    () => {
      const config = ts.readConfigFile(join(ROOT, 'tsconfig.test.json'), ts.sys.readFile).config;
      const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
      const paths = files.map((file) => file.path);
      const program = ts.createProgram(paths, { ...options, noEmit: true, skipLibCheck: true });
      const errors = ts
        .getPreEmitDiagnostics(program)
        .filter(
          (diagnostic) => diagnostic.file === undefined || paths.includes(diagnostic.file.fileName),
        )
        .map((diagnostic) => {
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
          if (!diagnostic.file || diagnostic.start === undefined) {
            return message;
          }
          const generatedLine = diagnostic.file.getLineAndCharacterOfPosition(
            diagnostic.start,
          ).line;
          const source = diagnostic.file.text.split('\n')[generatedLine]?.trim();
          return `${relative(ROOT, diagnostic.file.fileName)}:${generatedLine + 1}: ${message}\n  ${source}`;
        });
      expect(errors.join('\n\n')).toBe('');
    },
    180_000,
  );
});
