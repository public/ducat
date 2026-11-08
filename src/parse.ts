import { ISO_EXPONENTS, ISO_NON_MONETARY } from './currency.js';
import { money, type CurrencyInput, type Money, type MoneyOptions } from './money.js';

interface Symbols {
  group: string;
  decimal: string;
}
const symCache = new Map<string, Symbols>();

/**
 * The group and decimal separators `format()` uses for this locale and currency. They come from a
 * currency-style formatter, not a plain number one, because some locales use different separators
 * for money: fr-CH writes 1 234.56 € but 1 234,56 for a number, and de-AT 1.234,56 € but 1 234,56.
 */
function symbols(locale: string | undefined, currency: string): Symbols {
  const key = `${locale ?? ''}|${currency}`;
  let found = symCache.get(key);
  if (!found) {
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

function separatorParts(locale: string | undefined, currency: string): Intl.NumberFormatPart[] {
  try {
    // Two fraction digits even for JPY and the like, so the decimal separator always appears.
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
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
 */
export function parse<C extends CurrencyInput>(
  input: string,
  currency: C,
  locale?: string,
  options?: MoneyOptions,
): Money<C> {
  const { group, decimal } = symbols(locale, currency);
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
  for (let i = first; i <= last; i++) {
    const ch = chars[i]!;
    const digit = asciiDigit(ch.codePointAt(0)!);
    if (digit >= 0) {
      out += digit;
    } else if (ch === decimal || ch === '٫') {
      if (seenDecimal) {
        throw new SyntaxError(`Cannot parse "${input}": more than one decimal separator`);
      }
      seenDecimal = true;
      out += '.';
    } else if (isGroup(ch)) {
      if (seenDecimal) {
        throw new SyntaxError(
          `Cannot parse "${input}": group separator after the decimal separator`,
        );
      }
    } else {
      throw new SyntaxError(`Cannot parse "${input}": unexpected "${ch}"`);
    }
  }
  return money((neg ? '-' : '') + out, currency, options);
}

/** Options for `parseMoney`. */
export interface ParseMoneyOptions<C extends string = string> extends MoneyOptions {
  /**
   * The currency to use when the text has none, and to settle an ambiguous symbol such as `$`.
   * In strict mode a text naming another currency is an error.
   */
  readonly hint?: C;
  /** The currencies to detect (default: every ISO 4217 currency). Others are not recognised. */
  readonly currencies?: readonly C[];
  /**
   * Strict mode: an ambiguous symbol needs a `hint`, a currency that contradicts the `hint` is an
   * error, and group separators must follow the locale's group sizes (`1,234,567`, or
   * `12,34,567` in en-IN).
   */
  readonly strict?: boolean;
}

/** What one symbol or code can mean in a locale. */
interface SymbolMeaning {
  /** Every currency this text can stand for (narrow symbols included). */
  readonly all: Set<string>;
  /** The currencies whose own symbol in the locale is exactly this text. */
  readonly own: Set<string>;
}

const symbolTables = new Map<string, Map<string, SymbolMeaning>>();

/** Strips what surrounds a symbol in formatted output: spaces, no-break spaces and bidi marks. */
const normalizeSymbol = (text: string) => text.replace(/[\s\p{Z}\p{Cf}]/gu, '');

function currencySymbol(
  locale: string | undefined,
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

/**
 * symbol → the currencies it can mean, for one locale and candidate list, from Intl's own symbols
 * (so it follows the runtime's CLDR data). Built on first use and cached.
 */
function symbolTable(locale: string | undefined, candidates: readonly string[]) {
  const key = `${locale ?? ''}|${candidates.join(',')}`;
  let table = symbolTables.get(key);
  if (table !== undefined) {
    return table;
  }
  table = new Map();
  const meaningOf = (text: string) => {
    let meaning = table!.get(text);
    if (meaning === undefined) {
      meaning = { all: new Set(), own: new Set() };
      table!.set(text, meaning);
    }
    return meaning;
  };
  for (const currency of candidates) {
    const own = currencySymbol(locale, currency, 'symbol');
    const narrow = currencySymbol(locale, currency, 'narrowSymbol');
    // A symbol that is just the code is handled as a code.
    if (own !== undefined && own !== currency) {
      meaningOf(own).all.add(currency);
      meaningOf(own).own.add(currency);
    }
    if (narrow !== undefined && narrow !== currency) {
      meaningOf(narrow).all.add(currency);
    }
  }
  if (symbolTables.size >= 32) {
    symbolTables.clear();
  }
  symbolTables.set(key, table);
  return table;
}

let isoCodes: string[] | undefined;

/** Every ISO 4217 currency that money is counted in (not gold, test or fund codes). */
function defaultCandidates(): string[] {
  isoCodes ??= Object.keys(ISO_EXPONENTS).filter(
    (code) => !(ISO_NON_MONETARY as readonly string[]).includes(code),
  );
  return isoCodes;
}

/** The currencies one piece of affix text can mean, or undefined if it isn't a currency at all. */
function meaningOfPiece(
  piece: string,
  locale: string | undefined,
  candidates: readonly string[],
): SymbolMeaning | undefined {
  if (/^[A-Z]{3}$/.test(piece) && candidates.includes(piece)) {
    return { all: new Set([piece]), own: new Set([piece]) };
  }
  // The locale's own symbols first, then English ones (US$, CA$, A$...), which many texts use.
  return symbolTable(locale, candidates).get(piece) ?? symbolTable('en', candidates).get(piece);
}

/** Group sizes the locale formats this currency with: [3, 3] for en-US, [3, 2] for en-IN. */
function groupSizes(locale: string | undefined, currency: string): [number, number] {
  const parts = separatorParts(locale, currency);
  const integers = parts.filter((part) => part.type === 'integer').map((part) => part.value.length);
  // 1234567.5 formats as 1|234|567 (sizes 3, 3) or 12|34|567 (3, 2)
  const primary = integers[integers.length - 1] ?? 3;
  const secondary = integers.length >= 3 ? integers[integers.length - 2]! : primary;
  return [primary, secondary];
}

/** Throws unless the integer part's groups follow the locale's sizes (when it has any groups). */
function checkGroups(
  input: string,
  integerPart: string,
  sizes: [number, number],
  decimal: string,
): void {
  // the caller has turned every separator into a comma
  const groups = integerPart.split(',');
  if (groups.length <= 1) {
    return;
  }
  const [primary, secondary] = sizes;
  const lastIndex = groups.length - 1;
  const isValid = groups.every((group, i) => {
    if (i === lastIndex) {
      return group.length === primary;
    }
    if (i === 0) {
      return group.length >= 1 && group.length <= secondary;
    }
    return group.length === secondary;
  });
  if (!isValid) {
    throw new SyntaxError(
      `Cannot parse "${input}": group separators in the wrong places (decimal separator "${decimal}")`,
    );
  }
}

/**
 * Parses a formatted amount and detects its currency from the text: `parseMoney('CHF 1’234.50',
 * 'de-CH')`, `parseMoney('1.234,50 €', 'de-DE')`, `parseMoney('US$ 100')`. It recognises ISO codes
 * and the symbols `Intl.NumberFormat` uses for the locale (and English ones such as US$ and CA$).
 * The number itself is read as `parse` reads it, with the detected currency's separators.
 *
 * A symbol several currencies share (`$`, `kr`, `¥`) means the currency whose own symbol it is in
 * the locale (`$` is USD in en-US and CAD in en-CA), or `hint`. In `strict` mode it needs the
 * hint. Text with no currency uses `hint`, and throws without one.
 */
export function parseMoney<C extends string = string>(
  input: string,
  locale?: string,
  options?: ParseMoneyOptions<C>,
): Money<C> {
  const strict = options?.strict === true;
  const hint = options?.hint;
  const candidates = options?.currencies ?? defaultCandidates();

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

  // Each piece of the affix must be a sign or a currency; every currency piece must agree.
  let detected: string | undefined;
  const pieces = affix.split(/[\s\p{Z}\p{Cf}()+\-−]+/u).filter((piece) => piece !== '');
  for (const piece of pieces) {
    const meaning = meaningOfPiece(piece, locale, candidates);
    if (meaning === undefined) {
      throw new SyntaxError(`Cannot parse "${input}": "${piece}" is not a currency`);
    }
    let currency: string | undefined;
    if (meaning.all.size === 1) {
      currency = [...meaning.all][0];
    } else if (hint !== undefined && meaning.all.has(hint)) {
      currency = hint;
    } else if (!strict && meaning.own.size === 1) {
      currency = [...meaning.own][0];
    } else {
      throw new SyntaxError(
        `Cannot parse "${input}": "${piece}" could be ${[...meaning.all].sort().join(', ')}; pass a hint`,
      );
    }
    if (detected !== undefined && detected !== currency) {
      throw new SyntaxError(`Cannot parse "${input}": both ${detected} and ${currency}`);
    }
    detected = currency;
  }

  if (detected === undefined) {
    if (hint === undefined) {
      throw new SyntaxError(`Cannot parse "${input}": no currency; pass a hint`);
    }
    detected = hint;
  } else if (strict && hint !== undefined && detected !== hint) {
    throw new SyntaxError(`Cannot parse "${input}": ${detected}, expected ${hint}`);
  }

  if (strict) {
    const { decimal } = symbols(locale, detected);
    const number = chars.slice(first, last + 1).join('');
    const decimalAt = Math.max(number.indexOf(decimal), number.indexOf('٫'));
    const integerPart = decimalAt === -1 ? number : number.slice(0, decimalAt);
    const asciiInteger = Array.from(integerPart, (ch) => {
      const digit = asciiDigit(ch.codePointAt(0)!);
      return digit >= 0 ? String(digit) : ',';
    }).join('');
    checkGroups(input, asciiInteger, groupSizes(locale, detected), decimal);
  }

  return parse(input, detected as C, locale, options);
}
