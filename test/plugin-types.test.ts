// Type-checks test/plugin-types/plugin.ts, a plugin written the way a user writes one. Only that
// file's diagnostics count: augmenting Money also changes the type that the library's own method
// bodies see, which the published .d.ts files don't have (the README examples are checked the same
// way, in test/docs.test.ts).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { MUTATION } from './fc-config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'test', 'plugin-types', 'plugin.ts');
const LATER_PLUGINS = join(ROOT, 'test', 'plugin-types', 'later-plugins.ts');

/** The diagnostics in `files`, type-checked as one program in that order. */
function errorsIn(files: string[]): string[] {
  const config = ts.readConfigFile(join(ROOT, 'tsconfig.test.json'), ts.sys.readFile).config;
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
  const program = ts.createProgram(files, { ...options, noEmit: true, skipLibCheck: true });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => files.includes(diagnostic.file?.fileName ?? ''))
    .map((diagnostic) => {
      const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const name = diagnostic.file!.fileName.slice(diagnostic.file!.fileName.lastIndexOf('/') + 1);
      return `${name}:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
    });
}

it.skipIf(MUTATION)(
  'a user plugin merges into Money, with its currency type parameter',
  () => {
    expect(errorsIn([PLUGIN])).toEqual([]);
  },
  60_000,
);

// Every module augments the root entry, as users do. When modules augmented their own source file
// instead, a module first loaded after a user's augmentation lost its methods (and the user's own
// methods vanished), depending on the order the type checker read the files.
it.skipIf(MUTATION).each([
  ['after', [PLUGIN, LATER_PLUGINS]],
  ['before', [LATER_PLUGINS, PLUGIN]],
])(
  'modules loaded %s a user augmentation keep their methods',
  (_order, files) => {
    expect(errorsIn(files)).toEqual([]);
  },
  60_000,
);
