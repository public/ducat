import { POW10 } from './decimal.js';
import { toDecimal, toScale, type Money } from './money.js';
import type { RoundingMode } from './rounding.js';

/**
 * Intl's options, plus `digits` and `rounding`: round once, exactly, to `digits` decimal places
 * with `rounding` (default 'halfExpand'), then show that many fraction digits.
 */
export interface FormatOptions extends Intl.NumberFormatOptions {
  /** Decimal places to show; the amount is rounded (or padded) to exactly this many first. */
  readonly digits?: number;
  /** How `digits` rounds (default 'halfExpand'). Ducat rounds, not Intl, so it is exact. */
  readonly rounding?: RoundingMode;
}

/** What format() needs from a formatter: Intl.NumberFormat, or the long-name composition below. */
interface Formatter {
  format(value: number): string;
  formatToParts(value: number): Intl.NumberFormatPart[];
}

const cache = /* @__PURE__ */ new Map<string, Formatter>();
// one-entry memo in front of the Map: formatting in a loop is almost always the same
// locale/currency
let lastLocale: string | undefined;
let lastCurrency = '';
let lastScale = -1;
let lastFormatter: Formatter | undefined;
// the same for calls with options, keyed by the options' JSON
let lastOptionsKey = '';
let lastOptionsFormatter: Formatter | undefined;

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

/** A JSON.stringify replacer that writes undefined as a marker no Intl option value uses. */
function keepUndefined(_key: string, value: unknown): unknown {
  return value === undefined ? '\u0000undefined' : value;
}

function formatter(
  money: Money,
  locale: string | undefined,
  options: Intl.NumberFormatOptions | undefined,
): Formatter {
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
  // can't produce, so no two inputs share a key. An undefined value is kept in the key, because
  // the spread below lets it override our fraction digits, where a missing key doesn't.
  const base = `${locale}|${money.currency}|${money.scale}`;
  const key = options === undefined ? base : `${base}|${JSON.stringify(options, keepUndefined)}`;
  if (options !== undefined && key === lastOptionsKey && lastOptionsFormatter !== undefined) {
    return lastOptionsFormatter;
  }
  let numberFormat = cache.get(key);
  if (numberFormat === undefined) {
    const intlOptions: Intl.NumberFormatOptions = {
      style: 'currency',
      currency: money.currency,
      // ISO exponent (or the value's scale), not the engine's default digits: V8 (CLDR) shows ALL,
      // IQD, RSD ... with 0 decimals and JSC with ISO's; we always show what the value holds.
      minimumFractionDigits: money.scale,
      maximumFractionDigits: money.scale,
      ...options,
    };
    numberFormat = longName(new Intl.NumberFormat(locale, intlOptions), intlOptions);
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

const longNameSound = /* @__PURE__ */ new Map<string, boolean>();
const SHAPE: Partial<Record<string, string>> = {
  currency: 'c',
  integer: 'd',
  group: 'd',
  decimal: 'd',
  fraction: 'd',
};

/**
 * `numberFormat` itself, unless it shows long names in a locale where the runtime gets them wrong.
 * ICU 78.3 (Node 24) does in the English locales of euro countries that inherit en-150 (en-NL,
 * en-DE, en-FI ...): it applies en-150's euro pattern (¤#,##0.00) inside the long-name pattern, so
 * every currency shows its symbol beside its name, and fraction digits beyond two land after the
 * name: "KWD 1,234.56 Kuwaiti dinars7". A probe asks once per locale (one currency part, the
 * digits in one run); on a fixed runtime it passes and Intl's own text is used.
 *
 * Where it fails, the text is composed as the long form is meant to be (TR35's unitPattern): the
 * number as the locale's currency format writes it, with the separators parse() reads, then the
 * plural name Intl chose. Only English locales are affected, and CLDR 48's English unitPattern is
 * "{0} {1}" for every count. The number is the code form's at the same options without the code:
 * English writes no other literal into a currency's number, and Intl ignores currencySign for long
 * names.
 */
function longName(numberFormat: Intl.NumberFormat, options: Intl.NumberFormatOptions): Formatter {
  const { locale, currencyDisplay } = numberFormat.resolvedOptions();
  if (currencyDisplay !== 'name' || !locale.startsWith('en-')) {
    return numberFormat;
  }
  let sound = longNameSound.get(locale);
  if (sound === undefined) {
    // c: a currency part, d: a digit part (integer, group, decimal, fraction), x: anything else
    const shape = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'KWD',
      currencyDisplay: 'name',
      minimumFractionDigits: 3,
    })
      .formatToParts(1234.567)
      .map(({ type }) => SHAPE[type] ?? 'x')
      .join('');
    sound = /^[^c]*c[^c]*$/.test(shape) && !/d[^d]+d/.test(shape);
    longNameSound.set(locale, sound);
  }
  if (sound) {
    return numberFormat;
  }
  const { currencySign: _sign, ...rest } = options;
  const code = new Intl.NumberFormat(locale, { ...rest, currencyDisplay: 'code' });
  const toParts = (value: number): Intl.NumberFormatPart[] => {
    const parts = numberFormat.formatToParts(value);
    const name = parts.findLast((part) => part.type === 'currency');
    return name === undefined
      ? parts
      : [
          ...code
            .formatToParts(value)
            .filter(({ type }) => type !== 'currency' && type !== 'literal'),
          { type: 'literal', value: ' ' },
          name,
        ];
  };
  return {
    format: (value) =>
      toParts(value)
        .map((part) => part.value)
        .join(''),
    formatToParts: toParts,
  };
}

/**
 * Locale-aware formatting with Intl.NumberFormat (formatters are cached). The exact decimal string
 * is passed to Intl, so amounts beyond 2^53 format exactly on engines with Intl.NumberFormat v3
 * (Node 19+, Bun, Deno, Chrome 106+, Safari 15.4+, Firefox 116+).
 *
 *     format(money('1234.5', 'EUR'), 'de-DE')               // "1.234,50 €"
 *     format(money('1234.5', 'EUR'), 'en-GB', { currencyDisplay: 'code' })
 *     format(money('0.123456', 'EUR', { scale: 6 }), 'en', { digits: 4 })   // "€0.1235"
 */
export function format(money: Money, locale?: string, options?: FormatOptions): string {
  if (options?.digits !== undefined || options?.rounding !== undefined) {
    const [rounded, rest] = withDigits(money, options);
    return formatter(rounded, locale, rest).format(intlValue(rounded));
  }
  return formatter(money, locale, options).format(intlValue(money));
}

/**
 * The amount rounded once to `digits`, and the other Intl options. Intl's fraction or significant
 * digits, or its rounding increment, beside `digits` would round a second time, on a double, so
 * they throw.
 */
function withDigits(
  money: Money,
  options: FormatOptions,
): [Money, Intl.NumberFormatOptions | undefined] {
  const { digits, rounding, ...rest } = options;
  if (
    digits === undefined ||
    rest.minimumFractionDigits !== undefined ||
    rest.maximumFractionDigits !== undefined ||
    rest.minimumSignificantDigits !== undefined ||
    rest.maximumSignificantDigits !== undefined ||
    rest.roundingIncrement !== undefined
  ) {
    throw new TypeError(
      'format: digits replaces Intl’s digit and rounding options; rounding needs it',
    );
  }
  return [toScale(money, digits, rounding), Object.keys(rest).length > 0 ? rest : undefined];
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
  options?: FormatOptions,
): Intl.NumberFormatPart[] {
  if (options?.digits !== undefined || options?.rounding !== undefined) {
    const [rounded, rest] = withDigits(money, options);
    return formatter(rounded, locale, rest).formatToParts(intlValue(rounded));
  }
  return formatter(money, locale, options).formatToParts(intlValue(money));
}
