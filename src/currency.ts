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

const custom = /* @__PURE__ */ new Map<string, number>();
const iso = ISO_EXPONENTS as Readonly<Record<string, number>>;

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
  const prev = custom.get(code);
  if (prev !== undefined && prev !== exponent) {
    throw new TypeError(`${code} is already defined with exponent ${prev}`);
  }
  custom.set(code, exponent);
}

/** The minor-unit exponent of a currency (EUR 2, JPY 0, KWD 3). Throws for unknown codes. */
export function currencyExponent(code: string): number {
  const isoExponent = iso[code];
  if (typeof isoExponent === 'number') {
    return isoExponent;
  }
  const customExponent = custom.get(code);
  if (customExponent !== undefined) {
    return customExponent;
  }
  throw new RangeError(
    `Unknown currency "${code}" (not ISO 4217 and not registered with defineCurrency)`,
  );
}

/** Whether the code is an ISO 4217 currency or one registered with `defineCurrency`. */
export function isCurrency(code: string): code is CurrencyCode {
  return typeof iso[code] === 'number' || custom.has(code);
}

export {
  ISO_EXPONENTS,
  ISO_4217_PUBLISHED,
  ISO_NON_MONETARY,
  type IsoCurrencyCode,
} from './generated/iso4217.js';
