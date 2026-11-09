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

// The exponents of the currencies this program can use: ISO codes registered by the root entry
// (all of them) or by the constants of `@ducatjs/money/iso` (the ones used), and codes from
// `defineCurrency`. `/fn` programs that never import the root entry carry only what they use.
const known: Record<string, number> = /* @__PURE__ */ Object.create(null);

/** @internal Registers an ISO 4217 code; the generated constants and the root entry call it. */
export function isoCurrency<C extends string>(code: C, exponent: number): C {
  known[code] = exponent;
  return code;
}

/** @internal Registers every ISO 4217 code, for the root entry. */
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
    `Unknown currency "${code}" (with /fn, import it from @ducatjs/money/iso; otherwise defineCurrency)`,
  );
}

/** Whether the code is an ISO 4217 currency or one registered with `defineCurrency`. */
export function isCurrency(code: string): code is CurrencyCode {
  return known[code] !== undefined;
}

export {
  ISO_EXPONENTS,
  ISO_4217_PUBLISHED,
  ISO_NON_MONETARY,
  type IsoCurrencyCode,
} from './generated/iso4217.js';
