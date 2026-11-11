import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';
import * as fn from '../src/fn.js';
import * as all from '../src/plugins/all.js';

// The core operations are methods in the root entry, and plain functions in /fn and /all.
const METHOD_FORMS = [
  'add',
  'subtract',
  'negate',
  'abs',
  'multiply',
  'divide',
  'round',
  'toScale',
  'compare',
  'equals',
  'identical',
  'lessThan',
  'lessThanOrEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'isZero',
  'isPositive',
  'isNegative',
  'sign',
  'min',
  'max',
  'clamp',
  'majorPart',
  'minorPart',
  'hasFraction',
  'toDecimal',
  'toMinor',
  'toMinorNumber',
  'toNumber',
  'toScaledUnits',
];

const ROOT_FUNCTIONS = [
  'money',
  'fromMinor',
  'zero',
  'fromJSON',
  'sum',
  'isMoney',
  'isMoneyIn',
  'assertCurrency',
  'ratio',
  'extendMoney',
];

describe('export surface', () => {
  it('the root entry has the constructors and list functions, not the method forms', () => {
    const names = Object.keys(root);
    expect(METHOD_FORMS.filter((name) => names.includes(name))).toEqual([]);
    expect(ROOT_FUNCTIONS.filter((name) => !names.includes(name))).toEqual([]);
  });

  it('/fn and /all have every method form and everything the root entry has', () => {
    for (const entry of [fn, all]) {
      const names = Object.keys(entry);
      const missing = [...METHOD_FORMS, ...Object.keys(root)].filter(
        (name) => !names.includes(name),
      );
      expect(missing).toEqual([]);
    }
  });
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { types: string; default: string }>;
  types: string;
  typesVersions: { '*': Record<string, string[]> };
};

// TypeScript's node10 resolution (CommonJS projects) ignores `exports`, and reads `types` and
// `typesVersions` instead. They must name the same declarations, entry for entry.
describe('types for node10 resolution', () => {
  it('`types` and `typesVersions` mirror the types in `exports`', () => {
    const fromExports: Record<string, string[]> = {};
    for (const [key, target] of Object.entries(packageJson.exports)) {
      if (typeof target !== 'string' && key !== '.') {
        fromExports[key.slice(2)] = [target.types];
      }
    }
    const rootEntry = packageJson.exports['.'] as { types: string };
    expect(packageJson.types).toBe(rootEntry.types);
    expect(packageJson.typesVersions['*']).toEqual(fromExports);
  });
});
// export key -> source file, the way the build maps src/X.ts to dist/X.js
// A pattern export (`./iso/*`) stands for every file it matches.
const ENTRIES = Object.entries(packageJson.exports).flatMap(([key, target]) => {
  if (typeof target === 'string') {
    return [];
  }
  const source = target.default.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
  if (!key.includes('*')) {
    return [{ key, source, target }];
  }
  const [prefix, suffix] = source.split('*') as [string, string];
  return readdirSync(join(ROOT, prefix))
    .filter((name) => name.endsWith(suffix))
    .map((name) => {
      const stem = name.slice(0, -suffix.length);
      const expand = (path: string) => path.replace('*', stem);
      return {
        key: expand(key),
        source: expand(source),
        target: { types: expand(target.types), default: expand(target.default) },
      };
    });
});

/** Every package specifier the module imports, following its relative imports through src/. */
function packageImportsOf(file: string, seen = new Set<string>()): Set<string> {
  const packages = new Set<string>();
  if (seen.has(file)) {
    return packages;
  }
  seen.add(file);
  // without comments, whose examples import the package itself
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
    const specifier = match[1]!;
    if (specifier.startsWith('.')) {
      const resolved = join(dirname(file), specifier.replace(/\.js$/, '.ts'));
      for (const name of packageImportsOf(resolved, seen)) {
        packages.add(name);
      }
    } else {
      packages.add(specifier);
    }
  }
  return packages;
}

describe('package entries', () => {
  it('every export maps its types and code to the same source file, which exists', () => {
    for (const { target } of ENTRIES) {
      expect(target.types.replace(/\.d\.ts$/, '.js')).toBe(target.default);
    }
    const missing = ENTRIES.filter(({ source }) => !existsSync(join(ROOT, source)));
    expect(missing).toEqual([]);
  });

  it('only /drizzle, /zod, /valibot, /kysely and the /testing helpers reach their peer libraries (/typeorm needs none)', async () => {
    const actual: Record<string, string[]> = {};
    const expected: Record<string, string[]> = {};
    for (const { key, source } of ENTRIES) {
      actual[key] = [...packageImportsOf(join(ROOT, source))];
      expected[key] = key.startsWith('./drizzle/') ? [`drizzle-orm/${key.slice(10)}-core`] : [];
      if (key === './zod' || key === './valibot' || key === './kysely') {
        expected[key] = [key.slice(2)];
      }
    }
    // the test helpers reach only their own test libraries
    expected['./testing/vitest'] = ['vitest'];
    expected['./testing/arbitraries'] = ['fast-check'];
    expect(actual).toEqual(expected);
  });

  it('every /drizzle dialect exports its column types, and none re-exports the SQL helpers', async () => {
    const internal = new Set(Object.keys(await import('../src/sql.js')));
    const expectedNames: Record<string, string[]> = {
      // SQLite stores decimals as TEXT, so its entry has no column size to export
      './drizzle/sqlite': ['moneyDecimal', 'moneyJson', 'moneyMinor'],
      './drizzle/pg': ['DEFAULT_DECIMAL_SIZE', 'moneyDecimal', 'moneyJson', 'moneyMinor'],
      './drizzle/mysql': ['DEFAULT_DECIMAL_SIZE', 'moneyDecimal', 'moneyJson', 'moneyMinor'],
      './kysely': [
        'DEFAULT_DECIMAL_SIZE',
        'MoneyResultPlugin',
        'fixed',
        'moneyHelpers',
        'setDecimalMoney',
        'setMoney',
      ],
      // TypeORM transformers are plain objects: the entry never imports typeorm
      './typeorm': [
        'DEFAULT_DECIMAL_SIZE',
        'decimalTransformer',
        'fromRawDecimal',
        'fromRawMinor',
        'jsonTransformer',
        'minorTransformer',
      ],
      './pg': [
        'DEFAULT_DECIMAL_SIZE',
        'MONEY_TYPE_NAME',
        'exactTypes',
        'moneyTypeOids',
        'moneyTypeSql',
        'parseArray',
        'parseBigInt',
        'parseMoneyComposite',
        'parseNumeric',
        'toMoneyComposite',
        'toNumeric',
      ],
    };
    const drizzleNames: Record<string, string[]> = {};
    const leaked: Record<string, string[]> = {};
    for (const { key, source } of ENTRIES) {
      // the Jest setup entry installs on Jest's global expect when imported, so it can't load here
      if (key === './testing/jest') {
        continue;
      }
      // a computed path, so the type checker doesn't load drizzle-orm into this project
      const names = Object.keys(await import(pathToFileURL(join(ROOT, source)).href));
      if (key in expectedNames) {
        drizzleNames[key] = names.sort();
      }
      const internalNames = names.filter(
        (name) => internal.has(name) && name !== 'DEFAULT_DECIMAL_SIZE',
      );
      if (internalNames.length > 0) {
        leaked[key] = internalNames;
      }
    }
    expect(drizzleNames).toEqual(expectedNames);
    expect(leaked).toEqual({});
  });
});

describe('schema entries', () => {
  it('/zod and /valibot export the same schema functions', async () => {
    const zod = await import('../src/zod.js');
    const valibot = await import('../src/valibot.js');
    expect(Object.keys(zod).sort()).toEqual(['moneyJSONSchema', 'moneySchema']);
    expect(Object.keys(valibot).sort()).toEqual(['moneyJSONSchema', 'moneySchema']);
  });
});

describe('fixed entry', () => {
  /** Every src/ file the module reaches through its relative imports, type-only imports excluded. */
  function sourcesOf(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) {
      return seen;
    }
    seen.add(file);
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const match of text.matchAll(
      /^(?:import|export)(?!\s+type\b)[^;]*?from\s*'(\.[^']+)'/gm,
    )) {
      sourcesOf(join(dirname(file), match[1]!.replace(/\.js$/, '.ts')), seen);
    }
    return seen;
  }

  it('/words and its languages reach neither Money nor the currency table', () => {
    for (const entry of ['src/words.ts', 'src/words/en.ts', 'src/words/de.ts']) {
      const files = [...sourcesOf(join(ROOT, entry))].map((file) => file.slice(ROOT.length + 1));
      expect(files).not.toContain('src/money.ts');
      expect(files).not.toContain('src/currency.ts');
    }
  });

  it('/fixed reaches neither Money nor the currency table; /fixed/money adds both', () => {
    const relativeNames = (entry: string) =>
      [...sourcesOf(join(ROOT, entry))].map((file) => file.slice(ROOT.length + 1)).sort();
    const fixedOnly = relativeNames('src/fixed.ts');
    expect(fixedOnly).not.toContain('src/money.ts');
    expect(fixedOnly).not.toContain('src/currency.ts');
    expect(fixedOnly.some((file) => file === 'src/generated/iso4217.ts')).toBe(false);
    const withMoney = relativeNames('src/plugins/fixed-money.ts');
    expect(withMoney).toContain('src/money.ts');
    expect(withMoney).toContain('src/currency.ts');
  });
});

describe('policy entry', () => {
  it('/policy has the policy constructors and check, and the root entry does not', async () => {
    const policy = await import('../src/policy.js');
    expect(Object.keys(policy).sort()).toEqual(['assertScale', 'isoPolicy', 'roundingPolicy']);
    for (const name of Object.keys(policy)) {
      expect(Object.keys(root)).not.toContain(name);
      expect(Object.keys(fn)).toContain(name);
      expect(Object.keys(all)).toContain(name);
    }
  });
});

describe('testing entries', () => {
  it('only the setup entries are listed as having side effects', () => {
    const sideEffects = (
      JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
        sideEffects: string[];
      }
    ).sideEffects;
    for (const name of ['vitest', 'jest']) {
      expect(sideEffects).toContain(`./dist/testing/${name}.js`);
      expect(sideEffects).toContain(`./src/testing/${name}.ts`);
    }
    expect(sideEffects.filter((path) => path.includes('testing/index'))).toEqual([]);
    expect(sideEffects.filter((path) => path.includes('arbitraries'))).toEqual([]);
  });

  it('none is part of /fn or /all', async () => {
    const testing = await import('../src/testing/index.js');
    for (const name of Object.keys(testing)) {
      expect(Object.keys(fn)).not.toContain(name);
      expect(Object.keys(all)).not.toContain(name);
    }
  });
});

it('test/fn-only/tsconfig.json type-checks every entry that installs no methods', async () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const pkg = JSON.parse(read('../package.json')) as { exports: Record<string, unknown> };
  const expected = Object.values(pkg.exports)
    .flatMap((target) =>
      typeof target === 'object' && target !== null && 'default' in target
        ? [String(target.default)]
        : [],
    )
    .map((target) => target.replace('./dist/', 'src/').replace(/\.js$/, '.ts'))
    .filter(
      (source) =>
        !source.includes('/plugins/') && !source.includes('*') && source !== 'src/index.ts',
    )
    .map((source) => `../../${source}`)
    .sort();
  const config = read('fn-only/tsconfig.json');
  const files = (JSON.parse(config.slice(config.indexOf('{'))) as { files: string[] }).files;
  expect(files).toEqual([...new Set(expected)].sort());
});
