// The reference (docs/reference/) must name every export of every package entry, every type and every
// method, so a new function can't ship undocumented. Each entry has a home page; a name counts when it
// appears in backticks on that page (a re-export counts on the page of the entry it comes from).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { money } from '../src/plugins/all.js';
import { bag, exchangeRate } from '../src/plugins/all.js';
import { exact } from '../src/plugins/all.js';
import { fixed } from '../src/plugins/all.js';
import { MUTATION } from './fc-config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportsField = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).exports as Record<
  string,
  { default: string } | string
>;

/** The reference page that documents each entry, as a file in docs/reference/. */
const PAGES: Record<string, string> = {
  '.': 'money.md',
  './fn': 'fn.md',
  './iso': 'fn.md',
  './allocate': 'allocate.md',
  './tax': 'tax.md',
  './math': 'math.md',
  './convert': 'convert.md',
  './convert/ecb': 'rate-sources.md',
  './convert/history': 'rate-sources.md',
  './convert/boc': 'rate-sources.md',
  './convert/fed': 'rate-sources.md',
  './convert/boe': 'rate-sources.md',
  './convert/hmrc': 'rate-sources.md',
  './convert/fetch': 'rate-sources.md',
  './stripe-fx': 'rate-sources.md',
  './adyen-fx': 'rate-sources.md',
  './exact': 'exact.md',
  './policy': 'policy.md',
  './cash': 'cash.md',
  './pricing': 'pricing.md',
  './context': 'context.md',
  './finance': 'finance.md',
  './format': 'format.md',
  './parse': 'parse.md',
  './stripe': 'processors.md',
  './adyen': 'processors.md',
  './checkout': 'processors.md',
  './paypal': 'processors.md',
  './braintree': 'processors.md',
  './klarna': 'processors.md',
  './prisma': 'prisma.md',
  './drizzle/pg': 'drizzle.md',
  './drizzle/mysql': 'drizzle.md',
  './drizzle/sqlite': 'drizzle.md',
  './kysely': 'kysely.md',
  './typeorm': 'typeorm.md',
  './pg': 'pg.md',
  './zod': 'schemas.md',
  './valibot': 'schemas.md',
  './fixed': 'fixed.md',
  './fixed/money': 'fixed.md',
  './wire': 'wire.md',
  './words': 'words.md',
  './words/de': 'words.md',
  './words/en': 'words.md',
  './words/es': 'words.md',
  './words/fr': 'words.md',
  './words/it': 'words.md',
  './words/nl': 'words.md',
  './words/pt': 'words.md',
  './currencies': 'currencies.md',
  './territories': 'currencies.md',
  './historic': 'currencies.md',
  './crypto': 'currencies.md',
  './testing': 'testing.md',
  './testing/vitest': 'testing.md',
  './testing/jest': 'testing.md',
  './testing/arbitraries': 'testing.md',
  './all': 'all.md',
};

/** Entries that re-export other entries: their pages list entries, not every name. */
const AGGREGATES = new Set(['./fn', './all', './testing/vitest', './testing/jest']);

/** Entries whose names the reference must list, with the source file each one points at. */
const entries = Object.entries(exportsField)
  .filter(([key]) => key !== './package.json' && !key.includes('*'))
  .map(([key, target]) => {
    const built = typeof target === 'string' ? target : target.default;
    return {
      key,
      source: join(ROOT, built.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')),
    };
  });

const page = (name: string): string => readFileSync(join(ROOT, 'docs', 'reference', name), 'utf8');
const mentions = (text: string, name: string): boolean =>
  text.includes(name) &&
  new RegExp(`\`[^\`\\n]*(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])[^\`\\n]*\``).test(text);
const allReference = (): string =>
  Object.values(PAGES)
    .filter((name, index, list) => list.indexOf(name) === index)
    .map(page)
    .join('\n');

describe('the reference names everything the package exports', () => {
  it('every entry has a reference page', () => {
    const missing = entries.filter(({ key }) => PAGES[key] === undefined).map(({ key }) => key);
    expect(missing, 'add these entries to PAGES in test/docs-reference.test.ts').toEqual([]);
  });

  it('every value an entry exports is on its page', async () => {
    const problems: string[] = [];
    // a name re-exported from another entry counts on that entry's page too
    const homes = new Map<unknown, Set<string>>();
    const modules = new Map<string, Record<string, unknown>>();
    for (const { key, source } of entries) {
      if (AGGREGATES.has(key)) {
        // re-exports only, and /testing/jest needs Jest's global expect to load
        continue;
      }
      const loaded = (await import(pathToFileURL(source).href)) as Record<string, unknown>;
      modules.set(key, loaded);
      for (const [name, value] of Object.entries(loaded)) {
        const id = `${name}\0${typeof value === 'object' || typeof value === 'function' ? '' : String(value)}`;
        const keyOf = typeof value === 'object' || typeof value === 'function' ? value : id;
        homes.set(keyOf, (homes.get(keyOf) ?? new Set()).add(PAGES[key]!));
      }
    }
    for (const { key } of entries) {
      if (AGGREGATES.has(key)) {
        expect(page(PAGES[key]!).length).toBeGreaterThan(0);
        continue;
      }
      for (const [name, value] of Object.entries(modules.get(key)!)) {
        const keyOf =
          typeof value === 'object' || typeof value === 'function'
            ? value
            : `${name}\0${String(value)}`;
        const pages = [...(homes.get(keyOf) ?? [PAGES[key]!])];
        if (!pages.some((candidate) => mentions(page(candidate), name))) {
          problems.push(
            `\`${name}\` (from @ducatjs/money${key.slice(1)}): add it to docs/reference/${PAGES[key]}`,
          );
        }
      }
    }
    expect(problems.join('\n')).toBe('');
  });

  it.skipIf(MUTATION)(
    'every exported type is named in the reference',
    () => {
      const program = ts.createProgram(
        entries.map(({ source }) => source),
        {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          target: ts.ScriptTarget.ES2023,
          noEmit: true,
          skipLibCheck: true,
        },
      );
      const checker = program.getTypeChecker();
      const text = allReference();
      const problems = new Set<string>();
      for (const { key, source } of entries) {
        const file = program.getSourceFile(source);
        const symbol = file && checker.getSymbolAtLocation(file);
        if (!symbol) {
          problems.add(`${source} did not load`);
          continue;
        }
        for (const exported of checker.getExportsOfModule(symbol)) {
          const target =
            exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
          if (target.flags & ts.SymbolFlags.Value) {
            continue;
          }
          if (!mentions(text, exported.name)) {
            const home = AGGREGATES.has(key)
              ? 'the page of the entry it comes from'
              : `docs/reference/${PAGES[key]}`;
            problems.add(
              `type \`${exported.name}\` (from @ducatjs/money${key.slice(1)}): add it to ${home}`,
            );
          }
        }
      }
      expect([...problems].join('\n')).toBe('');
    },
    120_000,
  );

  it('every method of the library classes is in the reference', () => {
    const instances: Record<string, [object, string]> = {
      Money: [money('1', 'EUR'), 'money.md (or the page of the module that installs it)'],
      Fixed: [fixed('1'), 'fixed.md'],
      ExactMoney: [exact(money('1', 'EUR')), 'exact.md'],
      Rate: [exchangeRate('EUR', 'USD', '1.1'), 'convert.md'],
      MoneyBag: [bag(), 'convert.md'],
    };
    const text = allReference();
    const problems: string[] = [];
    for (const [className, [instance, home]] of Object.entries(instances)) {
      for (
        let proto = Object.getPrototypeOf(instance);
        proto && proto !== Object.prototype;
        proto = Object.getPrototypeOf(proto)
      ) {
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (
            name === 'constructor' ||
            name.startsWith('_') ||
            typeof Object.getOwnPropertyDescriptor(proto, name)?.value !== 'function'
          ) {
            continue;
          }
          if (!mentions(text, name)) {
            problems.push(`${className}#${name}: add it to docs/reference/${home}`);
          }
        }
      }
    }
    expect(problems.join('\n')).toBe('');
  });
});
