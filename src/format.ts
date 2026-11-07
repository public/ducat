import { POW10 } from './decimal.js';
import { toDecimal, type Money } from './money.js';

const cache = new Map<string, Intl.NumberFormat>();
// one-entry memo in front of the Map: formatting in a loop is almost always the same locale/currency
let lastLocale: string | undefined,
  lastCurrency = '',
  lastScale = -1,
  lastF: Intl.NumberFormat | undefined;

let stringInput: boolean | undefined;
/** ES2023 Intl.NumberFormat v3 formats decimal strings exactly; older engines convert to Number. */
function supportsStringInput(): boolean {
  if (stringInput === undefined) {
    try {
      stringInput =
        new Intl.NumberFormat('en', { useGrouping: false }).format('9007199254740993' as unknown as number) ===
        '9007199254740993';
    } catch {
      stringInput = false;
    }
  }
  return stringInput;
}

function formatter(
  m: Money,
  locale: string | undefined,
  options: Intl.NumberFormatOptions | undefined,
): Intl.NumberFormat {
  if (
    options === undefined &&
    lastF !== undefined &&
    locale === lastLocale &&
    m.currency === lastCurrency &&
    m.scale === lastScale
  )
    return lastF;
  const key = options === undefined ? `${locale}|${m.currency}|${m.scale}` : null;
  let f = key === null ? undefined : cache.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: m.currency,
      // ISO exponent (or the value's scale), not the engine's default digits: V8 (CLDR) shows ALL,
      // IQD, RSD ... with 0 decimals and JSC with ISO's; we always show what the value holds.
      minimumFractionDigits: m.scale,
      maximumFractionDigits: m.scale,
      ...options,
    });
    if (key !== null) {
      if (cache.size > 256) cache.clear();
      cache.set(key, f);
    }
  }
  if (key !== null) {
    lastLocale = locale;
    lastCurrency = m.currency;
    lastScale = m.scale;
    lastF = f;
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
  return formatter(m, locale, options).format(intlValue(m));
}

/**
 * What to hand to Intl (which only accepts doubles or strings).
 * Below 10^15 minor units the value has at most 15 significant digits, so the double nearest to it
 * formats back to exactly the same digits. `minor / 10^scale` is a single correctly rounded IEEE
 * division of two exactly representable integers, i.e. bit-identical to Number(toDecimal(m)) (asserted
 * in test/format.test.ts), and 2-3x cheaper; this display hand-off is the only place a double ever
 * touches an amount. Larger values go to Intl as the exact decimal string (Intl.NumberFormat v3).
 */
function intlValue(m: Money): number {
  const v = m.minor;
  if (typeof v === 'number' && v < 1e15 && v > -1e15 && m.scale <= 15) return v / POW10[m.scale]!;
  const s = toDecimal(m);
  return (supportsStringInput() ? s : Number(s)) as number;
}

/** Like format(), but returns Intl parts (for styling the currency symbol separately, etc.). */
export function formatToParts(m: Money, locale?: string, options?: Intl.NumberFormatOptions): Intl.NumberFormatPart[] {
  return formatter(m, locale, options).formatToParts(intlValue(m));
}
