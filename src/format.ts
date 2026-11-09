import { POW10 } from './decimal.js';
import { toDecimal, type Money } from './money.js';

const cache = new Map<string, Intl.NumberFormat>();
// one-entry memo in front of the Map: formatting in a loop is almost always the same
// locale/currency
let lastLocale: string | undefined;
let lastCurrency = '';
let lastScale = -1;
let lastFormatter: Intl.NumberFormat | undefined;
// the same for calls with options, keyed by the options' JSON
let lastOptionsKey = '';
let lastOptionsFormatter: Intl.NumberFormat | undefined;

let stringInput: boolean | undefined;
/** ES2023 Intl.NumberFormat v3 formats decimal strings exactly; older engines convert to Number. */
function supportsStringInput(): boolean {
  if (stringInput === undefined) {
    try {
      stringInput =
        new Intl.NumberFormat('en', { useGrouping: false }).format(
          '9007199254740993' as unknown as number,
        ) === '9007199254740993';
    } catch {
      stringInput = false;
    }
  }
  return stringInput;
}

function formatter(
  money: Money,
  locale: string | undefined,
  options: Intl.NumberFormatOptions | undefined,
): Intl.NumberFormat {
  if (
    options === undefined &&
    lastFormatter !== undefined &&
    locale === lastLocale &&
    money.currency === lastCurrency &&
    money.scale === lastScale
  ) {
    return lastFormatter;
  }
  // Options are keyed by their JSON: Intl's options are strings, numbers and booleans, so it is
  // exact, and objects that differ only in key order just get an entry each. JSON.stringify is far
  // cheaper than building a NumberFormat. The locale, currency and scale go first, in a form JSON
  // can't produce, so no two inputs share a key.
  const base = `${locale}|${money.currency}|${money.scale}`;
  const key = options === undefined ? base : `${base}|${JSON.stringify(options)}`;
  if (options !== undefined && key === lastOptionsKey && lastOptionsFormatter !== undefined) {
    return lastOptionsFormatter;
  }
  let numberFormat = cache.get(key);
  if (numberFormat === undefined) {
    numberFormat = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: money.currency,
      // ISO exponent (or the value's scale), not the engine's default digits: V8 (CLDR) shows ALL,
      // IQD, RSD ... with 0 decimals and JSC with ISO's; we always show what the value holds.
      minimumFractionDigits: money.scale,
      maximumFractionDigits: money.scale,
      ...options,
    });
    // bounded, as before: clearing is rare and cheap next to building formatters
    if (cache.size > 256) {
      cache.clear();
    }
    cache.set(key, numberFormat);
  }
  if (options === undefined) {
    lastLocale = locale;
    lastCurrency = money.currency;
    lastScale = money.scale;
    lastFormatter = numberFormat;
  } else {
    lastOptionsKey = key;
    lastOptionsFormatter = numberFormat;
  }
  return numberFormat;
}

/**
 * Locale-aware formatting with Intl.NumberFormat (formatters are cached). The exact decimal string
 * is passed to Intl, so amounts beyond 2^53 format exactly on engines with Intl.NumberFormat v3
 * (Node 19+, Bun, Deno, Chrome 106+, Safari 15.4+, Firefox 116+).
 *
 *     format(money('1234.5', 'EUR'), 'de-DE')               // "1.234,50 €"
 *     format(money('1234.5', 'EUR'), 'en-GB', { currencyDisplay: 'code' })
 */
export function format(money: Money, locale?: string, options?: Intl.NumberFormatOptions): string {
  return formatter(money, locale, options).format(intlValue(money));
}

/**
 * What to hand to Intl (which only accepts doubles or strings). Below 10^15 minor units the value
 * has at most 15 significant digits, so the double nearest to it formats back to exactly the same
 * digits. `minor / 10^scale` is a single correctly rounded IEEE division of two exactly
 * representable integers, i.e. bit-identical to Number(toDecimal(m)) (asserted in
 * test/format.test.ts), and 2-3x cheaper; this display hand-off is the only place a double ever
 * touches an amount. Larger values go to Intl as the exact decimal string (Intl.NumberFormat v3).
 */
function intlValue(money: Money): number {
  const minor = money.minor;
  if (typeof minor === 'number' && minor < 1e15 && minor > -1e15 && money.scale <= 15) {
    return minor / POW10[money.scale]!;
  }
  const decimal = toDecimal(money);
  return (supportsStringInput() ? decimal : Number(decimal)) as number;
}

/** Like format(), but returns Intl parts (for styling the currency symbol separately, etc.). */
export function formatToParts(
  money: Money,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormatPart[] {
  return formatter(money, locale, options).formatToParts(intlValue(money));
}
