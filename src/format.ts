import { money, toDecimal, type CurrencyInput, type Money, type MoneyOptions } from './money.js';

const cache = new Map<string, Intl.NumberFormat>();

let stringInput: boolean | undefined;
/** ES2023 Intl.NumberFormat v3 formats decimal strings exactly; older engines convert to Number. */
function supportsStringInput(): boolean {
  if (stringInput === undefined) {
    try {
      stringInput = new Intl.NumberFormat('en', { useGrouping: false }).format('9007199254740993' as unknown as number) === '9007199254740993';
    } catch {
      stringInput = false;
    }
  }
  return stringInput;
}

function formatter(m: Money, locale: string | undefined, options: Intl.NumberFormatOptions | undefined): Intl.NumberFormat {
  const key = options === undefined ? `${locale}|${m.currency}|${m.scale}` : null;
  let f = key === null ? undefined : cache.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: m.currency,
      // ISO exponent (or the value's scale), not CLDR's display digits: CLDR shows e.g. HUF/TWD
      // with 0 or 2 digits depending on cash vs. accounting; we always show what the value holds.
      minimumFractionDigits: m.scale,
      maximumFractionDigits: m.scale,
      ...options,
    });
    if (key !== null) {
      if (cache.size > 256) cache.clear();
      cache.set(key, f);
    }
  }
  return f;
}

/**
 * Locale-aware formatting with Intl.NumberFormat (formatters are cached). The exact decimal string
 * is passed to Intl, so amounts beyond 2^53 format exactly on engines with Intl.NumberFormat v3
 * (Node 19+, Bun, Deno, Chrome 106+, Safari 15.4+, Firefox 116+).
 *
 *     format(money('1234.5', 'EUR'), 'de-DE')               // "1.234,50 €"
 *     format(money('1234.5', 'EUR'), 'en-GB', { currencyDisplay: 'code' })
 */
export function format(m: Money, locale?: string, options?: Intl.NumberFormatOptions): string {
  const f = formatter(m, locale, options);
  const s = toDecimal(m);
  return f.format((supportsStringInput() ? s : Number(s)) as number);
}

/** Like format(), but returns Intl parts (for styling the currency symbol separately, etc.). */
export function formatToParts(m: Money, locale?: string, options?: Intl.NumberFormatOptions): Intl.NumberFormatPart[] {
  const s = toDecimal(m);
  return formatter(m, locale, options).formatToParts((supportsStringInput() ? s : Number(s)) as number);
}

interface Symbols { group: string; decimal: string }
const symCache = new Map<string, Symbols>();
function symbols(locale: string | undefined): Symbols {
  const key = locale ?? '';
  let s = symCache.get(key);
  if (!s) {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
    s = {
      group: parts.find((p) => p.type === 'group')?.value ?? ',',
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    };
    symCache.set(key, s);
  }
  return s;
}

// Zero code points of the decimal digit blocks Intl uses (arab, arabext, deva, beng, thai, fullwide, ...).
const ZEROS = [0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810, 0xff10];
function asciiDigit(cp: number): number {
  if (cp >= 48 && cp <= 57) return cp - 48;
  for (const z of ZEROS) if (cp >= z && cp <= z + 9) return cp - z;
  return -1;
}

/**
 * Parses a locale-formatted amount: parse('1.234,50 €', 'EUR', 'de-DE'), parse('CHF 1’234.50', 'CHF', 'de-CH'),
 * parse('١٢٣٫٤٥ US$', 'USD', 'ar-EG'). Currency symbols/codes, spaces and bidi marks around the number are
 * ignored (the currency is the `currency` argument, never guessed from the text). A minus sign (ASCII or
 * U+2212) or accounting parentheses anywhere in the affixes make it negative. Inside the number only
 * digits, the locale's group separator (before the decimal separator) and one decimal separator are allowed.
 */
export function parse<C extends CurrencyInput>(input: string, currency: C, locale?: string, options?: MoneyOptions): Money<C> {
  const { group, decimal } = symbols(locale);
  const chars = Array.from(input);
  let first = -1, last = -1;
  for (let i = 0; i < chars.length; i++) {
    if (asciiDigit(chars[i]!.codePointAt(0)!) >= 0) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) throw new SyntaxError(`Cannot parse "${input}": no digits`);
  const prefix = chars.slice(0, first).join('');
  const suffix = chars.slice(last + 1).join('');
  const affix = prefix + suffix;
  if (!/^[\p{L}\p{Sc}\p{Z}\s\p{Cf}.()+\-−]*$/u.test(affix)) throw new SyntaxError(`Cannot parse "${input}": unexpected characters`);
  const neg = /[-−(]/.test(affix);
  const isGroup = (ch: string) =>
    ch === group || (/^[\s\p{Z}]$/u.test(group) && /^[\s\p{Z}]$/u.test(ch)) || ((group === '’' || group === "'") && (ch === "'" || ch === '’')) || ch === '٬';
  let out = prefix.endsWith(decimal) ? '0.' : '';
  let seenDecimal = out !== '';
  for (let i = first; i <= last; i++) {
    const ch = chars[i]!;
    const d = asciiDigit(ch.codePointAt(0)!);
    if (d >= 0) out += d;
    else if (ch === decimal || ch === '٫') {
      if (seenDecimal) throw new SyntaxError(`Cannot parse "${input}": more than one decimal separator`);
      seenDecimal = true;
      out += '.';
    } else if (isGroup(ch)) {
      if (seenDecimal) throw new SyntaxError(`Cannot parse "${input}": group separator after the decimal separator`);
    } else throw new SyntaxError(`Cannot parse "${input}": unexpected "${ch}"`);
  }
  return money((neg ? '-' : '') + out, currency, options);
}
