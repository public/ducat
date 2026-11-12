import { ISO_EXPONENTS, ISO_NON_MONETARY } from './currency.js';
import { money, type CurrencyInput, type Money, type MoneyOptions } from './money.js';

interface Symbols {
  group: string;
  decimal: string;
  /** The locale's group sizes, looked up the first time a group separator is seen. */
  groupSizes?: readonly GroupSizes[];
}
const symCache = /* @__PURE__ */ new Map<string, Symbols>();

/**
 * The group and decimal separators `format()` uses for this locale and currency. They come from a
 * currency-style formatter, not a plain number one, because some locales use different separators
 * for money: fr-CH writes 1 234.56 € but 1 234,56 for a number, and de-AT 1.234,56 € but 1 234,56.
 */
function symbols(locale: string | undefined, currency: string): Symbols {
  const key = `${locale ?? ''}|${currency}`;
  let found = symCache.get(key);
  if (!found) {
    // Checked once per locale and currency, on a cache miss, so the hot path pays nothing.
    if (locale !== undefined) {
      requireLocaleData(locale);
    }
    const parts = separatorParts(locale, currency);
    found = {
      group: parts.find((part) => part.type === 'group')?.value ?? ',',
      decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    };
    if (symCache.size > 256) {
      symCache.clear();
    }
    symCache.set(key, found);
  }
  return found;
}

function separatorParts(
  locale: string | undefined,
  currency: string,
  currencySign: 'standard' | 'accounting' = 'standard',
): Intl.NumberFormatPart[] {
  try {
    // Two fraction digits even for JPY and the like, so the decimal separator always appears.
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencySign,
      useGrouping: true,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).formatToParts(1234567.5);
  } catch {
    // Codes Intl rejects as currencies (custom ones that are not three letters): a number format's
    // separators.
    return new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  }
}

// Zero code points of the decimal digit blocks Intl uses (arab, arabext, deva, beng, thai,
// fullwide, ...).
const ZEROS = [
  0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0,
  0xf20, 0x1040, 0x17e0, 0x1810, 0xff10,
];
const FULLWIDTH_ZERO = 0xff10;
const LAST_BLOCK_BEFORE_FULLWIDTH = 0x1810;
function asciiDigit(cp: number): number {
  if (cp >= 48 && cp <= 57) {
    return cp - 48;
  }
  // Every non-digit character used to scan the whole table. Separators, signs and Latin-1 spaces
  // are below the first block (U+0660); currency signs such as € (U+20AC) and the narrow no-break
  // space (U+202F) fall in the gap before the fullwidth digits.
  if (cp < ZEROS[0]! || (cp > LAST_BLOCK_BEFORE_FULLWIDTH + 9 && cp < FULLWIDTH_ZERO)) {
    return -1;
  }
  // ZEROS is sorted, so the first block above cp ends the search
  for (let i = 0; i < ZEROS.length; i++) {
    const zero = ZEROS[i]!;
    if (cp < zero) {
      return -1;
    }
    if (cp <= zero + 9) {
      return cp - zero;
    }
  }
  return -1;
}

/**
 * Parses a locale-formatted amount: parse('1.234,50 €', 'EUR', 'de-DE'), parse('CHF 1’234.50',
 * 'CHF', 'de-CH'), parse('١٢٣٫٤٥ US$', 'USD', 'ar-EG'). Currency symbols/codes, spaces and bidi
 * marks around the number are ignored (the currency is the `currency` argument, never guessed from
 * the text). A minus sign (ASCII or U+2212) or accounting parentheses anywhere in the affixes make
 * it negative. Inside the number only digits, the locale's group separator (before the decimal
 * separator) and one decimal separator are allowed.
 *
 * Group separators must be where the locale puts them (`1.234,50` in de-DE, `1,23,456.78` in
 * en-IN), because a misplaced one is usually a decimal separator from another locale: `78.00` in
 * de-DE throws instead of becoming 7800.00. Pass `{ lenient: true }` to accept them anywhere.
 */
export function parse<C extends CurrencyInput>(
  input: string,
  currency: C,
  locale?: string,
  options?: ParseOptions,
): Money<C> {
  const localeSymbols = symbols(locale, currency);
  const { group, decimal } = localeSymbols;
  const chars = Array.from(input);
  let first = -1;
  let last = -1;
  for (let i = 0; i < chars.length; i++) {
    if (asciiDigit(chars[i]!.codePointAt(0)!) >= 0) {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  if (first < 0) {
    throw new SyntaxError(`Cannot parse "${input}": no digits`);
  }
  const prefix = chars.slice(0, first).join('');
  const suffix = chars.slice(last + 1).join('');
  const affix = prefix + suffix;
  if (!/^[\p{L}\p{Sc}\p{Z}\s\p{Cf}.()+\-−]*$/u.test(affix)) {
    throw new SyntaxError(`Cannot parse "${input}": unexpected characters`);
  }
  const neg = /[-−(]/.test(affix);
  const isGroup = (ch: string) =>
    ch === group ||
    (/^[\s\p{Z}]$/u.test(group) && /^[\s\p{Z}]$/u.test(ch)) ||
    ((group === '’' || group === "'") && (ch === "'" || ch === '’')) ||
    ch === '٬';
  let out = prefix.endsWith(decimal) ? '0.' : '';
  let seenDecimal = out !== '';
  // The integer part's digit runs between group separators, as counters (most input has none, and
  // then nothing is checked): the first run, the length every middle run shares, and the last run.
  let separators = 0;
  let firstRun = 0;
  let middleRun = -1;
  let middleRunsAgree = true;
  let lastRun = -1;
  let digitsInGroup = 0;
  for (let i = first; i <= last; i++) {
    const ch = chars[i]!;
    const digit = asciiDigit(ch.codePointAt(0)!);
    if (digit >= 0) {
      out += digit;
      digitsInGroup++;
    } else if (ch === decimal || ch === '٫') {
      if (seenDecimal) {
        throw new SyntaxError(`Cannot parse "${input}": more than one decimal separator`);
      }
      seenDecimal = true;
      out += '.';
      lastRun = digitsInGroup;
    } else if (isGroup(ch)) {
      if (seenDecimal) {
        throw new SyntaxError(
          `Cannot parse "${input}": group separator after the decimal separator`,
        );
      }
      if (separators === 0) {
        firstRun = digitsInGroup;
      } else if (middleRun < 0) {
        middleRun = digitsInGroup;
      } else if (middleRun !== digitsInGroup) {
        middleRunsAgree = false;
      }
      separators++;
      digitsInGroup = 0;
    } else {
      throw new SyntaxError(`Cannot parse "${input}": unexpected "${ch}"`);
    }
  }
  if (separators > 0 && options?.lenient !== true) {
    if (lastRun < 0) {
      lastRun = digitsInGroup;
    }
    localeSymbols.groupSizes ??= groupSizes(locale, currency);
    checkRuns(input, localeSymbols.groupSizes, firstRun, middleRunsAgree ? middleRun : -2, lastRun);
  }
  // pass options through as they are unless they carry `lenient`, so the common call allocates nothing
  let moneyOptions: MoneyOptions | undefined = options;
  if (options !== undefined && 'lenient' in options) {
    const { lenient: _lenient, ...rest } = options;
    moneyOptions = rest;
  }
  return money((neg ? '-' : '') + out, currency, moneyOptions);
}

/** Options for `parse`. */
export interface ParseOptions extends MoneyOptions {
  /** Accept group separators in any position, as before 0.2 (`1.5` in de-DE is then 15.00). */
  readonly lenient?: boolean;
}

/** Options for `parseMoney`. */
export interface ParseMoneyOptions<C extends string = string> extends MoneyOptions {
  /**
   * The expected currency. It settles a symbol several currencies share (`$`, `kr`, `£`, `¥`), and
   * a text naming another currency is an error. With `lenient`, a bare number is read in it.
   */
  readonly hint?: C;
  /**
   * Your own meanings for symbols, which win over the locale's: `{ $: 'CAD' }` for a shop that only
   * prices in Canadian dollars.
   */
  readonly symbols?: Readonly<Record<string, C>>;
  /** The currencies to detect (default: every ISO 4217 currency). Others are not recognised. */
  readonly currencies?: readonly C[];
  /**
   * Accept group separators in any positions (as `parse` does with `lenient`), and a bare number when a `hint`
   * is given. It never makes the currency a guess.
   */
  readonly lenient?: boolean;
}

const symbolTables = /* @__PURE__ */ new Map<string, Map<string, Set<string>>>();
const groupSizeCache = /* @__PURE__ */ new Map<string, GroupSizes[]>();

/** The size of the last group, and of the groups before it: [3, 3] for 1,234,567, [3, 2] for 12,34,567. */
type GroupSizes = readonly [number, number];
const supportedLocales = /* @__PURE__ */ new Map<string, boolean>();

/** Strips what surrounds a symbol in formatted output: spaces, no-break spaces and bidi marks. */
const normalizeSymbol = (text: string) => text.replace(/[\s\p{Z}\p{Cf}]/gu, '');

function currencySymbol(
  locale: string,
  currency: string,
  display: 'symbol' | 'narrowSymbol',
): string | undefined {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: display,
    }).formatToParts(1);
    const value = parts.find((part) => part.type === 'currency')?.value;
    return value === undefined ? undefined : normalizeSymbol(value);
  } catch {
    return undefined;
  }
}

/** Language and region of a locale tag, the part Intl must have data for. */
function languageAndRegion(tag: string): string {
  const parsed = new Intl.Locale(tag);
  return `${parsed.language}-${parsed.region ?? ''}`;
}

/**
 * Throws unless Intl has data for the locale's language and region. Intl silently falls back to
 * another locale (an unsupported tag, or a runtime with reduced ICU data), and that locale's
 * separators and symbols would then decide the amount and the currency.
 */
function requireLocaleData(locale: string): void {
  let isSupported = supportedLocales.get(locale);
  if (isSupported === undefined) {
    const resolved = new Intl.NumberFormat(locale).resolvedOptions().locale;
    isSupported = languageAndRegion(resolved) === languageAndRegion(locale);
    if (supportedLocales.size >= 64) {
      supportedLocales.clear();
    }
    supportedLocales.set(locale, isSupported);
  }
  if (!isSupported) {
    throw new RangeError(`This runtime has no Intl data for the locale ${locale}`);
  }
}

/**
 * symbol → every currency it can mean in one locale (symbol and narrow symbol), from Intl's own
 * data, so it follows the runtime's CLDR version. Built on first use, cached per locale (at most
 * 16), and narrowed by a `currencies` option rather than rebuilt.
 */
function symbolTable(locale: string): Map<string, Set<string>> {
  let table = symbolTables.get(locale);
  if (table !== undefined) {
    return table;
  }
  table = new Map();
  for (const currency of defaultCandidates()) {
    for (const display of ['symbol', 'narrowSymbol'] as const) {
      const symbol = currencySymbol(locale, currency, display);
      // A symbol that is just the code is handled as a code.
      if (symbol !== undefined && symbol !== currency) {
        let meanings = table.get(symbol);
        if (meanings === undefined) {
          meanings = new Set();
          table.set(symbol, meanings);
        }
        meanings.add(currency);
      }
    }
  }
  if (symbolTables.size >= 16) {
    symbolTables.clear();
  }
  symbolTables.set(locale, table);
  return table;
}

/** Where the English symbols come from: en has CA$, A$ and the like, en-CA has US$. */
const ENGLISH_SYMBOL_LOCALES = ['en', 'en-CA'];

let isoCodes: string[] | undefined;

/** Every ISO 4217 currency that money is counted in (not gold, test or fund codes). */
function defaultCandidates(): string[] {
  isoCodes ??= Object.keys(ISO_EXPONENTS).filter(
    (code) => !(ISO_NON_MONETARY as readonly string[]).includes(code),
  );
  return isoCodes;
}

/** The currencies one piece of affix text can mean; an empty list if it isn't a currency. */
function meaningsOf(
  piece: string,
  locale: string,
  candidates: ReadonlySet<string> | undefined,
  customSymbols: Readonly<Record<string, string>> | undefined,
): string[] {
  const isCandidate = (code: string) =>
    candidates === undefined ? defaultCandidates().includes(code) : candidates.has(code);
  if (/^[A-Z]{3}$/.test(piece) && isCandidate(piece)) {
    return [piece];
  }
  if (customSymbols !== undefined && Object.hasOwn(customSymbols, piece)) {
    return [customSymbols[piece]!];
  }
  // The locale's own symbols first, then English ones (US$, CA$, A$...), which many texts use.
  for (const source of [locale, ...ENGLISH_SYMBOL_LOCALES]) {
    const found = symbolTable(source).get(piece);
    const meanings = found === undefined ? [] : [...found].filter(isCandidate);
    if (meanings.length > 0) {
      return meanings.sort();
    }
  }
  return [];
}

/**
 * The group sizes the locale formats this currency with, in its standard and its accounting
 * format: they can differ (en-IN writes JP¥1,00,000, but (JP¥100,000) in accounting style).
 */
function groupSizes(locale: string | undefined, currency: string): readonly GroupSizes[] {
  const key = `${locale ?? ''}|${currency}`;
  let sizes = groupSizeCache.get(key);
  if (sizes === undefined) {
    sizes = [];
    for (const currencySign of ['standard', 'accounting'] as const) {
      const found = sizesOf(separatorParts(locale, currency, currencySign));
      if (!sizes.some((known) => known[0] === found[0] && known[1] === found[1])) {
        sizes.push(found);
      }
    }
    if (groupSizeCache.size >= 256) {
      groupSizeCache.clear();
    }
    groupSizeCache.set(key, sizes);
  }
  return sizes;
}

function sizesOf(parts: Intl.NumberFormatPart[]): GroupSizes {
  const integers = parts.filter((part) => part.type === 'integer').map((part) => part.value.length);
  // 1234567.5 formats as 1|234|567 (sizes 3, 3) or 12|34|567 (3, 2)
  const primary = integers[integers.length - 1] ?? 3;
  const secondary = integers.length >= 3 ? integers[integers.length - 2]! : primary;
  return [primary, secondary];
}

/** Throws unless the integer part's groups follow one of the locale's sizes (when it has groups). */
function checkGroups(input: string, integerPart: string, allSizes: readonly GroupSizes[]): void {
  // the caller has turned every separator into a comma
  const runs = integerPart.split(',');
  if (runs.length <= 1) {
    return;
  }
  const middle = runs.slice(1, -1).map((run) => run.length);
  let middleRun = -1;
  if (middle.length > 0) {
    middleRun = middle.every((length) => length === middle[0]) ? middle[0]! : -2;
  }
  checkRuns(input, allSizes, runs[0]!.length, middleRun, runs[runs.length - 1]!.length);
}

/**
 * Throws unless digit runs between group separators fit one of the sizes: 1,234,567 or 12,34,567
 * has a leading run of 1 up to `secondary` digits, middle runs of `secondary` and a last run of
 * `primary`. `middleRun` is the length all middle runs share, -1 for none, -2 if they differ.
 */
function checkRuns(
  input: string,
  allSizes: readonly GroupSizes[],
  firstRun: number,
  middleRun: number,
  lastRun: number,
): void {
  for (let option = 0; option < allSizes.length; option++) {
    const [primary, secondary] = allSizes[option]!;
    if (
      lastRun === primary &&
      firstRun >= 1 &&
      firstRun <= secondary &&
      (middleRun === -1 || middleRun === secondary)
    ) {
      return;
    }
  }
  throw new SyntaxError(`Cannot parse "${input}": group separators in the wrong places`);
}

/**
 * Parses a formatted amount and detects its currency from the text: `parseMoney('CHF 1’234.50',
 * 'de-CH')`, `parseMoney('1.234,50 €', 'de-DE')`. Like the rest of ducat it never guesses:
 *
 * - it reads ISO codes (uppercase, among `currencies`) and symbols that mean one currency in the
 *   locale (or in English: US$, CA$, A$);
 * - a symbol several currencies share (`$`, `kr`, `£`, `¥`) needs a `hint` or a `symbols` entry;
 * - a currency other than the `hint`, two different currencies, or text that isn't a currency
 *   throws;
 * - so does a locale this runtime has no Intl data for, and group separators in the wrong places
 *   (`lenient: true` accepts those, and a bare number when a `hint` is given).
 *
 * The number is read as `parse` reads it, with the detected currency's separators.
 */
export function parseMoney<C extends string = string>(
  input: string,
  locale: string,
  options?: ParseMoneyOptions<C>,
): Money<C> {
  const hint = options?.hint;
  const lenient = options?.lenient === true;
  const candidates =
    options?.currencies === undefined ? undefined : new Set<string>(options.currencies);
  requireLocaleData(locale);

  // The text around the number: everything before the first digit and after the last.
  const chars = Array.from(input);
  let first = -1;
  let last = -1;
  for (let i = 0; i < chars.length; i++) {
    if (asciiDigit(chars[i]!.codePointAt(0)!) >= 0) {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  if (first < 0) {
    throw new SyntaxError(`Cannot parse "${input}": no digits`);
  }
  const affix = `${chars.slice(0, first).join('')} ${chars.slice(last + 1).join('')}`;

  // Each piece of the affix must be a sign or a currency, and every currency must agree. A lone
  // separator next to the number (".50 USD") belongs to the number, which parse reads.
  let detected: string | undefined;
  const pieces = affix
    .split(/[\s\p{Z}\p{Cf}()+\-−]+/u)
    .filter((piece) => piece !== '' && !/^[.,٫]$/u.test(piece));
  for (const piece of pieces) {
    const meanings = meaningsOf(piece, locale, candidates, options?.symbols);
    let currency: string;
    if (meanings.length === 1) {
      currency = meanings[0]!;
    } else if (meanings.length === 0) {
      throw new SyntaxError(`Cannot parse "${input}": "${piece}" is not a currency`);
    } else if (hint !== undefined && meanings.includes(hint)) {
      currency = hint;
    } else {
      throw new SyntaxError(
        `Cannot parse "${input}": "${piece}" could be ${meanings.join(', ')}; pass a hint or symbols`,
      );
    }
    if (detected !== undefined && detected !== currency) {
      throw new SyntaxError(`Cannot parse "${input}": both ${detected} and ${currency}`);
    }
    detected = currency;
  }

  if (detected === undefined) {
    if (hint === undefined || !lenient) {
      throw new SyntaxError(
        `Cannot parse "${input}": no currency in the text` +
          (hint === undefined ? '' : '; pass lenient: true to read a bare number in the hint'),
      );
    }
    detected = hint;
  } else if (hint !== undefined && detected !== hint) {
    // a text that names another currency than expected is never a correct parse
    throw new SyntaxError(`Cannot parse "${input}": ${detected}, expected ${hint}`);
  }

  if (!lenient) {
    const { decimal } = symbols(locale, detected);
    const number = chars.slice(first, last + 1).join('');
    const decimalAt = Math.max(number.indexOf(decimal), number.indexOf('٫'));
    const integerPart = decimalAt === -1 ? number : number.slice(0, decimalAt);
    const asciiInteger = Array.from(integerPart, (ch) => {
      const digit = asciiDigit(ch.codePointAt(0)!);
      return digit >= 0 ? String(digit) : ',';
    }).join('');
    checkGroups(input, asciiInteger, groupSizes(locale, detected));
  }

  return parse(input, detected as C, locale, options);
}
