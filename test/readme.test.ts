// Runs the TypeScript examples in README.md, like Python's doctest, so the README can't drift from the code.
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
// `<!-- doctest: skip (reason) -->` or `<!-- doctest: setup CODE -->` (hidden setup code, such as loading a
// fixture).
//
// The examples are type-checked too, so a `// @ts-expect-error` in an example must be a real error.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { documentedErrorClass, failures } from './doctest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test', '.doctest');
const PACKAGE_NAME = '@ducatjs/money';

interface Example {
  /** The line in README.md where the block's code starts. */
  line: number;
  code: string[];
  skip?: boolean;
  setup?: string;
}

/** The ```ts blocks of a markdown file, with the doctest directive just before each one. */
function examplesIn(markdown: string): Example[] {
  const lines = markdown.split('\n');
  const examples: Example[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '```ts') {
      continue;
    }

    const example: Example = { line: i + 2, code: [] };
    // the directive is the last non-blank line before the block (the formatter adds a blank line after it)
    let previous = i - 1;
    while (previous > 0 && lines[previous] === '') {
      previous--;
    }
    const before = lines[previous] ?? '';
    const directive = /^<!-- doctest: (skip|setup)\b ?(.*?) ?-->$/.exec(before);
    if (directive?.[1] === 'setup') {
      example.setup = directive[2] ?? '';
    } else if (directive?.[1] === 'skip') {
      example.skip = true;
    }

    for (i++; lines[i] !== '```'; i++) {
      if (i >= lines.length) {
        throw new Error(`README.md:${example.line}: unclosed code block`);
      }
      example.code.push(lines[i] ?? '');
    }
    examples.push(example);
  }
  return examples;
}

/** `@ducatjs/money/fixed` → the source file the package export points at, relative to `fromDir`. */
function sourceFor(specifier: string, fromDir: string): string {
  const exports = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).exports;
  const subpath = '.' + specifier.slice(PACKAGE_NAME.length);
  const target = exports[subpath]?.default;
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
    const line = example.line + index;
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
        throw new Error(`README.md:${line}: name the error class, as in // throws RangeError`);
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

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const examples = examplesIn(readme);

describe('README.md examples', () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const files: string[] = [];
  for (const example of examples) {
    if (example.skip) {
      continue;
    }
    const file = join(OUT, `line-${example.line}.ts`);
    writeFileSync(file, toModule(example, OUT));
    files.push(file);
  }

  it('has examples to run', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const line = Number(/line-(\d+)/.exec(file)![1]);
    it(`the example at README.md:${line} returns what its comments say`, async () => {
      failures.length = 0;
      await import(pathToFileURL(file).href);
      const report = failures.map((failure) => `README.md:${failure.line}: ${failure.message}`);
      expect(report.join('\n\n')).toBe('');
    });
  }

  it('the examples type-check', () => {
    const config = ts.readConfigFile(join(ROOT, 'tsconfig.test.json'), ts.sys.readFile).config;
    const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
    const program = ts.createProgram(files, { ...options, noEmit: true, skipLibCheck: true });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter(
        (diagnostic) => diagnostic.file === undefined || files.includes(diagnostic.file.fileName),
      )
      .map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        if (!diagnostic.file || diagnostic.start === undefined) {
          return message;
        }
        const generatedLine = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line;
        const source = diagnostic.file.text.split('\n')[generatedLine]?.trim();
        return `${relative(ROOT, diagnostic.file.fileName)}:${generatedLine + 1}: ${message}\n  ${source}`;
      });
    expect(errors.join('\n\n')).toBe('');
  }, 60_000);
});
