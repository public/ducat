import { existsSync, readFileSync } from 'node:fs';
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
  'toDecimal',
  'toMinor',
  'toMinorNumber',
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
};
// export key -> source file, the way the build maps src/X.ts to dist/X.js
const ENTRIES = Object.entries(packageJson.exports).flatMap(([key, target]) =>
  typeof target === 'string'
    ? []
    : [
        {
          key,
          source: target.default.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'),
          target,
        },
      ],
);

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

  it('only /drizzle, /zod, /valibot and /kysely reach their peer libraries; nothing else imports any', async () => {
    const actual: Record<string, string[]> = {};
    const expected: Record<string, string[]> = {};
    for (const { key, source } of ENTRIES) {
      actual[key] = [...packageImportsOf(join(ROOT, source))];
      expected[key] = key.startsWith('./drizzle/') ? [`drizzle-orm/${key.slice(10)}-core`] : [];
      if (key === './zod' || key === './valibot' || key === './kysely') {
        expected[key] = [key.slice(2)];
      }
    }
    expect(actual).toEqual(expected);
  });

  it('every /drizzle dialect exports its column types, and none re-exports the SQL helpers', async () => {
    const internal = new Set(Object.keys(await import('../src/sql.js')));
    const expectedNames: Record<string, string[]> = {
      // SQLite stores decimals as TEXT, so its entry has no column size to export
      './drizzle/sqlite': ['moneyDecimal', 'moneyJson', 'moneyMinor'],
      './drizzle/pg': ['DEFAULT_DECIMAL_SIZE', 'moneyDecimal', 'moneyJson', 'moneyMinor'],
      './drizzle/mysql': ['DEFAULT_DECIMAL_SIZE', 'moneyDecimal', 'moneyJson', 'moneyMinor'],
      './kysely': ['MoneyResultPlugin', 'fixed', 'moneyHelpers', 'setDecimalMoney', 'setMoney'],
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
