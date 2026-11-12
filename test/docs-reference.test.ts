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
  './excel': 'excel.md',
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

/**
 * `Class#member` for every class member in src/ that TypeScript marks `private` or whose JSDoc says
 * `@internal`: those are on the prototype at run time but aren't part of the documented API.
 */
function internalMembers(classNames: readonly string[]): Set<string> {
  const wanted = new Set(classNames);
  const found = new Set<string>();
  for (const file of ts.sys.readDirectory(join(ROOT, 'src'), ['.ts'])) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    source.forEachChild(function visit(node) {
      if (ts.isClassDeclaration(node) && node.name !== undefined && wanted.has(node.name.text)) {
        for (const member of node.members) {
          const name =
            member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : '';
          const isPrivate =
            ts.getCombinedModifierFlags(member as ts.Declaration) & ts.ModifierFlags.Private;
          const isInternal = ts.getJSDocTags(member).some((tag) => tag.tagName.text === 'internal');
          if (name !== '' && (isPrivate || isInternal)) {
            found.add(`${node.name.text}#${name}`);
          }
        }
      }
      node.forEachChild(visit);
    });
  }
  return found;
}

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
    'every exported type is on its page',
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
      // the pages of the entries that export each type: a re-export counts on its origin's page
      const exportsOf = new Map<string, { name: string; target: ts.Symbol }[]>();
      const homes = new Map<ts.Symbol, Set<string>>();
      const problems = new Set<string>();
      for (const { key, source } of entries) {
        const file = program.getSourceFile(source);
        const symbol = file && checker.getSymbolAtLocation(file);
        if (!symbol) {
          problems.add(`${source} did not load`);
          continue;
        }
        const types = checker
          .getExportsOfModule(symbol)
          .map((exported) => ({
            name: exported.name,
            target:
              exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported,
          }))
          .filter(({ target }) => !(target.flags & ts.SymbolFlags.Value));
        exportsOf.set(key, types);
        if (!AGGREGATES.has(key)) {
          for (const { target } of types) {
            homes.set(target, (homes.get(target) ?? new Set()).add(PAGES[key]!));
          }
        }
      }
      for (const { key } of entries) {
        for (const { name, target } of exportsOf.get(key) ?? []) {
          const pages = [...(homes.get(target) ?? [])];
          if (pages.length === 0) {
            problems.add(`type \`${name}\` (from @ducatjs/money${key.slice(1)}) has no home entry`);
          } else if (!pages.some((candidate) => mentions(page(candidate), name))) {
            problems.add(`type \`${name}\`: add it to docs/reference/${pages[0]}`);
          }
        }
      }
      expect([...problems].join('\n')).toBe('');
    },
    120_000,
  );

  it('every method of the library classes is on its page', () => {
    // a module's Money methods are declared in its `interface Money` augmentation
    const moneyMethodPage = new Map<string, string>();
    for (const { key, source } of entries) {
      if (AGGREGATES.has(key)) {
        continue;
      }
      const text = readFileSync(source, 'utf8');
      for (const block of text.matchAll(
        /interface Money<C extends string> \{([\s\S]*?)\n {2}\}/g,
      )) {
        for (const method of block[1]!.matchAll(/^ {4}(\w+)\s*[<(]/gm)) {
          moneyMethodPage.set(method[1]!, PAGES[key]!);
        }
      }
    }
    const instances: Record<string, [object, (name: string) => string]> = {
      Money: [money('1', 'EUR'), (name) => moneyMethodPage.get(name) ?? 'money.md'],
      Fixed: [fixed('1'), () => 'fixed.md'],
      ExactMoney: [exact(money('1', 'EUR')), () => 'exact.md'],
      Rate: [exchangeRate('EUR', 'USD', '1.1'), () => 'convert.md'],
      MoneyBag: [bag(), () => 'convert.md'],
    };
    // private or @internal in TypeScript, but visible on the prototype at run time
    const internal = internalMembers(Object.keys(instances));
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
          if (!internal.has(`${className}#${name}`) && !mentions(page(home(name)), name)) {
            problems.push(`${className}#${name}: add it to docs/reference/${home(name)}`);
          }
        }
      }
    }
    expect(problems.join('\n')).toBe('');
  });
});
