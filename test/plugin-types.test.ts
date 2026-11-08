// Type-checks test/plugin-types/plugin.ts, a plugin written the way a user writes one. Only that
// file's diagnostics count: augmenting Money also changes the type that the library's own method
// bodies see, which the published .d.ts files don't have (the README examples are checked the same
// way, in test/readme.test.ts).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'test', 'plugin-types', 'plugin.ts');

it('a user plugin merges into Money, with its currency type parameter', () => {
  const config = ts.readConfigFile(join(ROOT, 'tsconfig.test.json'), ts.sys.readFile).config;
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
  const program = ts.createProgram([PLUGIN], { ...options, noEmit: true, skipLibCheck: true });
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === PLUGIN)
    .map((diagnostic) => {
      const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      return `plugin.ts:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
    });
  expect(errors).toEqual([]);
}, 60_000);
