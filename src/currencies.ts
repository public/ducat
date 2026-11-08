/**
 * `@ducatjs/money/currencies`: currency facts beyond the exponent. ISO 4217 numeric codes both
 * ways, the size of the minor unit, and names and symbols per locale, which come from the runtime's
 * `Intl` rather than a bundled table. Which currencies a territory uses is in
 * `@ducatjs/money/territories`.
 */
import { currencyExponent } from './currency.js';
import { formatScaled } from './decimal.js';
import { ISO_NUMERIC_CODES } from './generated/iso4217-numeric.js';

// ---------------------------------------------------------------------------------------------
// Numeric codes
// ---------------------------------------------------------------------------------------------

/**
 * The ISO 4217 numeric code of an active currency, three digits as published: `'978'` for EUR,
 * `'008'` for ALL. Card networks, ISO 8583 and some ISO 20022 messages carry currencies this way.
 * `undefined` for a code ISO doesn't list (a custom or withdrawn currency).
 */
export function numericCode(currency: string): string | undefined {
  return Object.hasOwn(ISO_NUMERIC_CODES, currency) ? ISO_NUMERIC_CODES[currency] : undefined;
}

let currenciesByNumeric: Map<string, string> | undefined;

/**
 * The active ISO 4217 currency with a numeric code: `currencyFromNumeric('978')` and
 * `currencyFromNumeric(978)` are `'EUR'`, and `'008'`, `'8'` and `8` are all `'ALL'`. `undefined`
 * for a number ISO doesn't assign; a value that isn't a whole number from 0 to 999 throws a
 * RangeError.
 */
export function currencyFromNumeric(numeric: string | number): string | undefined {
  const text = typeof numeric === 'number' ? String(numeric) : numeric.trim();
  if (!/^\d{1,3}$/.test(text)) {
    throw new RangeError(`Not an ISO 4217 numeric code: ${String(numeric)}`);
  }
  if (currenciesByNumeric === undefined) {
    currenciesByNumeric = new Map();
    for (const [currency, code] of Object.entries(ISO_NUMERIC_CODES)) {
      currenciesByNumeric.set(code, currency);
    }
  }
  return currenciesByNumeric.get(text.padStart(3, '0'));
}

// ---------------------------------------------------------------------------------------------
// Minor unit
// ---------------------------------------------------------------------------------------------

/**
 * The size of the currency's minor unit, in major units, as an exact decimal string: `'0.01'` for
 * EUR, `'1'` for JPY (no minor unit), `'0.001'` for KWD and BHD. It follows the exponent, so a
 * currency registered with `defineCurrency` works too; an unknown code throws, as
 * `currencyExponent` does. For the smallest coin, see `cashUnit` in `@ducatjs/money/cash`.
 */
export function minorUnit(currency: string): string {
  return formatScaled(1, currencyExponent(currency));
}

// ---------------------------------------------------------------------------------------------
// Names and symbols, from Intl
// ---------------------------------------------------------------------------------------------

const displayNames = new Map<string, Intl.DisplayNames>();
const symbolFormats = new Map<string, Intl.NumberFormat>();

function cached<T>(cache: Map<string, T>, key: string, build: () => T): T {
  let value = cache.get(key);
  if (value === undefined) {
    // a handful of locales in practice; the bound keeps a server that sees many from growing
    if (cache.size >= 64) {
      cache.clear();
    }
    value = build();
    cache.set(key, value);
  }
  return value;
}

/**
 * The currency's name in a locale, from the runtime's `Intl.DisplayNames`: `currencyName('EUR',
 * 'en')` is 'Euro' and `currencyName('EUR', 'de')` is 'Euro'; `currencyName('CHF', 'fr')` is 'franc
 * suisse'. `undefined` when the runtime has no name for the code. Names follow the runtime's CLDR
 * data, so they can differ between runtimes and versions.
 */
export function currencyName(currency: string, locale: string): string | undefined {
  const names = cached(
    displayNames,
    locale,
    () => new Intl.DisplayNames(locale, { type: 'currency', fallback: 'none' }),
  );
  return names.of(currency);
}

/** Options for `currencySymbol`. */
export interface CurrencySymbolOptions {
  /**
   * 'symbol' (default) is the symbol the locale uses where it must not be ambiguous ('US$' in
   * en-CA, 'CA$' in en-US); 'narrow' is the shortest form ('$'), as `Intl.NumberFormat`'s
   * `narrowSymbol`.
   */
  readonly display?: 'symbol' | 'narrow';
}

/**
 * The currency's symbol in a locale, from the runtime's `Intl.NumberFormat`: `currencySymbol('EUR',
 * 'en-US')` is '€', `currencySymbol('USD', 'en-CA')` is 'US$', and `currencySymbol('USD', 'en-CA',
 * { display: 'narrow' })` is '$'. A currency without a symbol in that locale gives its code.
 */
export function currencySymbol(
  currency: string,
  locale: string,
  options?: CurrencySymbolOptions,
): string {
  const display = options?.display === 'narrow' ? 'narrowSymbol' : 'symbol';
  const format = cached(
    symbolFormats,
    `${locale}\u0000${currency}\u0000${display}`,
    () => new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: display }),
  );
  const part = format.formatToParts(0).find((candidate) => candidate.type === 'currency');
  return part?.value ?? currency;
}
