import { ISO_EXPONENTS, type IsoCurrencyCode } from './generated/iso4217.js';

/**
 * Augment this interface to add non-ISO currencies to the `CurrencyCode` type:
 *
 *     declare module '@ducatjs/money' { interface CustomCurrencies { BTC: true; USDC: true } }
 *     defineCurrency('BTC', 8);
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CustomCurrencies {}

/** A known currency code: ISO 4217, or one added to `CustomCurrencies`. */
export type CurrencyCode = IsoCurrencyCode | (keyof CustomCurrencies & string);

const iso = ISO_EXPONENTS as Readonly<Record<string, number>>;

// The exponents of the currencies this program can use: ISO codes registered by importing
// `@ducatjs/money/iso` (all of them; every entry except `/fn` does) or `@ducatjs/money/iso/<CODE>`
// (one), and codes from `defineCurrency`. `/fn` programs carry only the codes they import.
const known: Record<string, number> = /* @__PURE__ */ Object.create(null);

/** @internal Registers an ISO 4217 code; the generated `iso/<CODE>` modules call it. */
export function isoCurrency(code: string, exponent: number): void {
  known[code] = exponent;
}

/** @internal Registers every ISO 4217 code, for `@ducatjs/money/iso`. */
export function registerIsoCurrencies(): void {
  Object.assign(known, iso);
}

/**
 * Registers a currency that is not in ISO 4217 (crypto, loyalty points, withdrawn codes you still
 * hold balances in). ISO codes cannot be redefined: use an explicit `scale` for extra precision.
 */
export function defineCurrency(code: string, exponent: number): void {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 30) {
    throw new RangeError(`Invalid exponent ${exponent}`);
  }
  if (typeof iso[code] === 'number') {
    throw new TypeError(`${code} is an ISO 4217 currency and cannot be redefined`);
  }
  const prev = known[code];
  if (prev !== undefined && prev !== exponent) {
    throw new TypeError(`${code} is already defined with exponent ${prev}`);
  }
  known[code] = exponent;
}

/** The minor-unit exponent of a currency (EUR 2, JPY 0, KWD 3). Throws for unknown codes. */
export function currencyExponent(code: string): number {
  const exponent = known[code];
  if (exponent !== undefined) {
    return exponent;
  }
  return unknownCurrency(code);
}

function unknownCurrency(code: string): never {
  throw new RangeError(
    `Unknown currency "${code}": import @ducatjs/money/iso/${code} or /iso with /fn, or defineCurrency`,
  );
}

/**
 * Whether the code is registered: an ISO 4217 code (every one wherever an entry other than `/fn` is
 * imported; in a `/fn`-only program, the ones imported from `@ducatjs/money/iso`), or a code from
 * `defineCurrency`.
 */
export function isCurrency(code: string): code is CurrencyCode {
  return known[code] !== undefined;
}

export {
  ISO_EXPONENTS,
  ISO_4217_PUBLISHED,
  ISO_NON_MONETARY,
  type IsoCurrencyCode,
} from './generated/iso4217.js';
