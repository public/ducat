// The format and parse vectors hold one Intl data build's output: the files declare it in
// provenance.data.referenceRuntime (Node 24, ICU 78.3, CLDR 48.0). Some runtimes report the same
// ICU and CLDR versions but ship other data for a few locales (spec/README.md, "Runtime
// divergences"). A canary per such locale formats one value and compares it with the files' row:
// - on the reference runtime a mismatch is a failure, so a change to its data turns CI red;
// - on any other runtime it skips only that locale's format and parse rows, and says so. A
//   notation canary stands for the locale's rows in compact, scientific and engineering notation
//   alone (Deno's older compact patterns differ where its standard ones don't).
import { format, type FormatOptions } from '../../src/format.js';
import { fromMinor } from '../../src/money.js';
import type { SpecFile } from './format.ts';

/** The operations whose rows depend on the runtime's Intl data. */
export const INTL_OPERATIONS: ReadonlySet<string> = new Set([
  'format.money',
  'parse.money',
  'parse.detect',
]);

/** One value per locale whose data differs between Intl builds (spec/README.md). */
export interface Canary {
  readonly locale: string;
  readonly amount: string;
  readonly currency: string;
  readonly options?: FormatOptions;
  /** whether it stands for the locale's notation rows alone */
  readonly notation?: boolean;
}

/** A canary's name in the verdict and the warnings: its locale, and whether for notation. */
export const canaryName = (canary: Canary): string =>
  canary.notation === true ? `${canary.locale} (notation)` : canary.locale;

/**
 * Whether a format or parse row is one a canary stands for: the canary's locale, also with
 * `-u-` keywords (de-CH-u-nu-thai is de-CH's data); for a notation canary only the rows with a
 * notation other than standard.
 */
export function covers(canary: Canary, row: Readonly<Record<string, unknown>>): boolean {
  const base = String(row['locale']).split('-u-')[0];
  if (base !== canary.locale) {
    return false;
  }
  if (canary.notation !== true) {
    return true;
  }
  const notation = (row['options'] as FormatOptions | undefined)?.notation;
  return notation !== undefined && notation !== 'standard';
}

export const CANARIES: readonly Canary[] = [
  // ICU 78.3 writes 1'234.50 (U+0027); Deno 2.9.8's data writes U+2019
  { locale: 'de-CH', amount: '1234.50', currency: 'CHF' },
  // ICU 78.3's unitPattern has U+00A0 before the name; Deno 2.9.8's a space
  { locale: 'fr-CA', amount: '1.00', currency: 'CAD', options: { currencyDisplay: 'name' } },
  // ICU 78.3 overrides CLDR's U+202F group with U+0027; Deno 2.9.8 keeps CLDR's
  { locale: 'fr-CH', amount: '1234.50', currency: 'CHF' },
  // notation: ICU 78.3's (CLDR 48's) compact patterns, which Deno 2.9.8's data has older ones of
  // 0 M ¤ (1,00 M €); Deno's 0 M¤
  {
    locale: 'es',
    amount: '1000000.00',
    currency: 'EUR',
    options: { notation: 'compact' },
    notation: true,
  },
  // 0K ¤ (1,23K €); Deno has none for thousands
  {
    locale: 'it',
    amount: '1234.50',
    currency: 'EUR',
    options: { notation: 'compact' },
    notation: true,
  },
  // an RLM before the number (‏١٫٢٣ ألف €)
  {
    locale: 'ar-EG',
    amount: '1234.50',
    currency: 'EUR',
    options: { notation: 'compact' },
    notation: true,
  },
  // the currency first (‎€ ۱٫۲۳ هزار)
  {
    locale: 'fa-IR',
    amount: '1234.50',
    currency: 'EUR',
    options: { notation: 'compact' },
    notation: true,
  },
  // a space after elfu (€ elfu 1.23)
  {
    locale: 'sw-KE',
    amount: '1234.50',
    currency: 'EUR',
    options: { notation: 'compact' },
    notation: true,
  },
  // lakhs in the long patterns (1.23 lakh euros)
  {
    locale: 'en-IN',
    amount: '123456.78',
    currency: 'EUR',
    options: { notation: 'compact', currencyDisplay: 'name', compactDisplay: 'long' },
    notation: true,
  },
];

/** What a canary found that differs from the files. */
export interface Divergence {
  /** the canary's name (`canaryName`) */
  readonly locale: string;
  readonly canary: Canary;
  readonly expected: string;
  readonly actual: string;
  /** the locale's rows in the format and parse tables */
  readonly rows: number;
}

export interface IntlVerdict {
  /** whether this is the runtime the files declare */
  readonly reference: boolean;
  readonly declared: string;
  /** canary mismatches on the reference runtime: test failures */
  readonly failures: readonly Divergence[];
  /** locales skipped on another runtime */
  readonly skipped: ReadonlyMap<string, Divergence>;
}

const DECLARATION = /^Node (\d+) \(ICU ([\d.]+), CLDR ([\d.]+)\)$/;

/** The build the format and parse files declare; they must all declare the same one. */
export function declaredRuntime(files: ReadonlyMap<string, unknown>): string {
  const declared = new Set<string>();
  for (const file of files.values()) {
    const spec = file as SpecFile;
    if (spec.tables?.some((table) => INTL_OPERATIONS.has(table.op))) {
      declared.add(spec.provenance.data?.['referenceRuntime'] ?? '(none)');
    }
  }
  if (declared.size !== 1 || !DECLARATION.test([...declared][0]!)) {
    throw new Error(`format and parse files declare ${[...declared].join(', ')}`);
  }
  return [...declared][0]!;
}

type Versions = Readonly<Record<string, string | undefined>>;

/**
 * Whether this process is the declared runtime, from the runtime and its versions alone.
 * `versions` and `isDeno` are parameters so a test can stub them.
 */
export function isReferenceRuntime(
  declared: string,
  versions: Versions = process.versions,
  isDeno: boolean = 'Deno' in globalThis,
): boolean {
  const [, major, icu, cldr] = DECLARATION.exec(declared)!;
  return (
    versions['bun'] === undefined &&
    !isDeno &&
    versions['node']?.split('.')[0] === major &&
    versions['icu'] === icu &&
    versions['cldr'] === cldr
  );
}

/** This runtime, written as the files write the declaration. */
function runtimeName(versions: Versions, isDeno: boolean): string {
  const name =
    versions['bun'] !== undefined
      ? `Bun ${versions['bun']}`
      : isDeno
        ? 'Deno'
        : `Node ${versions['node'] ?? '(unknown)'}`;
  return `${name} (ICU ${versions['icu'] ?? '(none)'}, CLDR ${versions['cldr'] ?? '(none)'})`;
}

/**
 * The CI job that sets SPEC_REFERENCE_RUNTIME=1 is the one meant to run the declared runtime:
 * there, any other runtime is a failure (a Node 24 update with new ICU data, say), never a skip.
 * Returns the failure, or undefined. Without the variable nothing is checked.
 */
export function referenceJobProblem(
  declared: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  versions: Versions = process.versions,
  isDeno: boolean = 'Deno' in globalThis,
): string | undefined {
  if (env['SPEC_REFERENCE_RUNTIME'] !== '1' || isReferenceRuntime(declared, versions, isDeno)) {
    return undefined;
  }
  return (
    `reference job runs ${runtimeName(versions, isDeno)}; the files declare ${declared}: ` +
    'regenerate the vectors or update the declaration'
  );
}

function formatCanary(canary: Canary): string {
  const [whole, places = ''] = canary.amount.split('.');
  const money = fromMinor(BigInt(`${whole}${places}`), canary.currency, places.length);
  return format(money, canary.locale, canary.options);
}

/** The canary's expected text: the files' format.money row with the same inputs. */
function expectedText(files: ReadonlyMap<string, unknown>, canary: Canary): string {
  for (const file of files.values()) {
    for (const table of (file as SpecFile).tables ?? []) {
      if (table.op !== 'format.money') {
        continue;
      }
      const row = table.rows.find(
        (candidate) =>
          candidate['locale'] === canary.locale &&
          candidate['amount'] === canary.amount &&
          candidate['currency'] === canary.currency &&
          JSON.stringify(candidate['options']) === JSON.stringify(canary.options),
      );
      if (row !== undefined) {
        return row['text'] as string;
      }
    }
  }
  throw new Error(`no format.money row for the ${canary.locale} canary`);
}

function rowsOf(files: ReadonlyMap<string, unknown>, canary: Canary): number {
  let count = 0;
  for (const file of files.values()) {
    for (const table of (file as SpecFile).tables ?? []) {
      if (INTL_OPERATIONS.has(table.op)) {
        count += table.rows.filter((row) => covers(canary, row)).length;
      }
    }
  }
  return count;
}

/** Whether a row is skipped on this runtime: a differing canary stands for it. */
export function isSkipped(verdict: IntlVerdict, row: Readonly<Record<string, unknown>>): boolean {
  for (const divergence of verdict.skipped.values()) {
    if (covers(divergence.canary, row)) {
      return true;
    }
  }
  return false;
}

/** Runs every canary. `formatText` and `reference` are parameters so a test can stub them. */
export function intlVerdict(
  files: ReadonlyMap<string, unknown>,
  formatText: (canary: Canary) => string = formatCanary,
  reference: boolean = isReferenceRuntime(declaredRuntime(files)),
): IntlVerdict {
  const failures: Divergence[] = [];
  const skipped = new Map<string, Divergence>();
  for (const canary of CANARIES) {
    const expected = expectedText(files, canary);
    const actual = formatText(canary);
    if (actual === expected) {
      continue;
    }
    const divergence = {
      locale: canaryName(canary),
      canary,
      expected,
      actual,
      rows: rowsOf(files, canary),
    };
    if (reference) {
      failures.push(divergence);
    } else {
      skipped.set(divergence.locale, divergence);
    }
  }
  return { reference, declared: declaredRuntime(files), failures, skipped };
}

const codepoints = (text: string) =>
  Array.from(text, (ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);

/** A GitHub Actions warning line for a skipped locale: the first differing code points, then both texts. */
export function warningLine(divergence: Divergence): string {
  const expected = codepoints(divergence.expected);
  const actual = codepoints(divergence.actual);
  let at = 0;
  while (at < expected.length && expected[at] === actual[at]) {
    at++;
  }
  return (
    `::warning title=Intl data differs::${divergence.locale} skipped (${divergence.rows} rows): ` +
    `expected ${expected[at] ?? 'end'} got ${actual[at] ?? 'end'} ` +
    `(canary expected ${expected.join(' ')}, got ${actual.join(' ')})`
  );
}
