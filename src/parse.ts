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
