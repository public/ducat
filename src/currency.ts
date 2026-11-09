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

// The exponents of the currencies this program can use. `@ducatjs/money/iso/<CODE>` and
// `defineCurrency` add codes to `known` one at a time; `@ducatjs/money/iso` (which every entry except
// `/fn` imports) makes the ISO table literal its prototype rather than copying it. That keeps the
// lookup as fast as reading the literal directly: V8 folds a load through a stable prototype, while
// a copy of 165 keys, or a null-prototype object, is a slow dictionary (#243 doubled fromMinor's
// time that way). `known` has a prototype, so a value counts only when it's a number: `toString`
// is a function and `__proto__` an object.
const known: Record<string, number> = {};

function exponentOf(code: string): number | undefined {
  const exponent = known[code];
  return typeof exponent === 'number' ? exponent : undefined;
}

/** @internal Registers an ISO 4217 code; the generated `iso/<CODE>` modules call it. */
export function isoCurrency(code: string, exponent: number): void {
  known[code] = exponent;
}

/** @internal Registers every ISO 4217 code, for `@ducatjs/money/iso`. */
export function registerIsoCurrencies(): void {
  Object.setPrototypeOf(known, iso);
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
  const prev = exponentOf(code);
  if (prev !== undefined && prev !== exponent) {
    throw new TypeError(`${code} is already defined with exponent ${prev}`);
  }
  known[code] = exponent;
}

/** The minor-unit exponent of a currency (EUR 2, JPY 0, KWD 3). Throws for unknown codes. */
export function currencyExponent(code: string): number {
  const exponent = exponentOf(code);
  return exponent === undefined ? unknownCurrency(code) : exponent;
}

function unknownCurrency(code: string): never {
  throw new RangeError(
    // true wherever it's thrown: with the root entry every ISO code is registered already
    `Unknown currency "${code}" (ISO codes with /fn alone: import @ducatjs/money/iso; others: defineCurrency)`,
  );
}

/**
 * Whether the code is registered: an ISO 4217 code (every one wherever an entry other than `/fn` is
 * imported; in a `/fn`-only program, the ones imported from `@ducatjs/money/iso`), or a code from
 * `defineCurrency`.
 */
export function isCurrency(code: string): code is CurrencyCode {
  return exponentOf(code) !== undefined;
}

export {
  ISO_EXPONENTS,
  ISO_4217_PUBLISHED,
  ISO_NON_MONETARY,
  type IsoCurrencyCode,
} from './generated/iso4217.js';
