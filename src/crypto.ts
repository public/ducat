/**
 * `@ducatjs/money/crypto`: crypto currencies and tokens as an opt-in table (BTC with 8 decimals,
 * ETH with 18, SOL with 9, and common Ethereum tokens), and exact conversions to and from base
 * units (satoshi, wei, lamport). Nothing is registered until you ask:
 *
 *     defineCryptoCurrencies(['BTC', 'ETH']);
 *     money('0.5', 'ETH').toString()            // '0.500000000000000000 ETH'
 *     toBaseUnits(money('0.00000001', 'BTC'))  // 1n
 *     fromBaseUnits('1000000000000000000', 'ETH').toString() // '1.000000000000000000 ETH'
 *
 * Amounts beyond 2^53 base units (most ETH amounts in wei) use Money's bigint path, so they stay
 * exact. The decimals come from each unit's defining source (see data/crypto-units.json).
 */
import { currencyExponent, defineCurrency } from './currency.js';
import { pow10n } from './decimal.js';
import { CRYPTO_UNIT_TABLE } from './generated/crypto.js';
import { fromMinor, type CurrencyInput, type Money } from './money.js';
import { RoundingError } from './rounding.js';

/** A code in the crypto table. */
export type CryptoCurrencyCode = keyof typeof CRYPTO_UNIT_TABLE;

/**
 * Every crypto code, for the `CurrencyCode` type:
 *
 *     declare module '@ducatjs/money' {
 *       interface CustomCurrencies extends CryptoCurrencies {}
 *     }
 */
export type CryptoCurrencies = { readonly [Code in CryptoCurrencyCode]: true };

/** One entry of the crypto table. */
export interface CryptoUnit {
  readonly code: CryptoCurrencyCode;
  readonly name: string;
  /** Decimal places of one unit in base units: 8 for BTC (satoshi), 18 for ETH (wei). */
  readonly decimals: number;
  /** The base unit's name, for native currencies: 'satoshi', 'wei', 'lamport'. */
  readonly baseUnit?: string;
  /** The network the decimals are for. A token's decimals can differ on another network. */
  readonly network: string;
  /** The token's contract address on that network, for tokens. */
  readonly contract?: string;
}

const table: Readonly<Record<string, Omit<CryptoUnit, 'code'>>> = CRYPTO_UNIT_TABLE;

/** The table entry for a code, or undefined for a code that isn't in it. */
export function cryptoUnit(code: string): CryptoUnit | undefined {
  // own properties only, so 'toString' and friends are not currencies
  if (!Object.hasOwn(table, code)) {
    return undefined;
  }
  return { code: code as CryptoCurrencyCode, ...table[code]! };
}

/** Every entry of the table, by code. */
export function cryptoUnits(): CryptoUnit[] {
  return Object.keys(table).map((code) => cryptoUnit(code)!);
}

/**
 * Registers crypto codes with `defineCurrency`, with their decimals as the exponent: all of them,
 * or only `codes`. Registering one again is harmless; a code already defined with other decimals
 * throws, as `defineCurrency` does.
 */
export function defineCryptoCurrencies(codes?: readonly CryptoCurrencyCode[]): void {
  const selected: readonly string[] = codes ?? Object.keys(table);

  // check every code first, so a typo registers nothing
  for (const code of selected) {
    if (!Object.hasOwn(table, code)) {
      throw new RangeError(`${code} is not in the crypto currency table`);
    }
  }

  for (const code of selected) {
    defineCurrency(code, table[code]!.decimals);
  }
}

/**
 * The amount as a count of the currency's base units (satoshi for BTC, wei for ETH), always a
 * bigint since wei amounts are rarely safe integers. The base unit is 10^-exponent of the currency
 * (its decimals, once registered), so this works for any registered code. An amount with more
 * decimals than that throws a RoundingError: there is no fraction of a base unit.
 */
export function toBaseUnits(money: Money): bigint {
  const decimals = currencyExponent(money.currency);
  const minor = BigInt(money.minor);
  if (money.scale <= decimals) {
    return minor * pow10n(decimals - money.scale);
  }

  // more decimals than the currency has: only exact when the extra digits are zeros
  const divisor = pow10n(money.scale - decimals);
  if (minor % divisor !== 0n) {
    throw new RoundingError(
      `${money.toString()} is not a whole number of base units (${decimals} decimals)`,
    );
  }
  return minor / divisor;
}

// A plain integer: an optional minus sign and digits, no leading zeros, nothing else.
const BASE_UNITS = /^-?(?:0|[1-9]\d*)$/;

/**
 * Money from a count of base units: `fromBaseUnits('100000000', 'BTC')` is 1.00000000 BTC. The
 * count is a bigint, a safe integer or a decimal string. Strings are parsed strictly, since they
 * usually come from an API or a node: digits with an optional minus sign, and nothing else (no
 * spaces, signs, decimal points, exponents, separators or leading zeros). Anything else throws a
 * SyntaxError. A hexadecimal quantity from an Ethereum node goes through `BigInt('0x…')` first.
 * The result has the currency's exponent as its scale.
 */
export function fromBaseUnits<C extends CurrencyInput>(
  units: bigint | number | string,
  currency: C,
): Money<C> {
  const decimals = currencyExponent(currency);
  if (typeof units === 'string') {
    // 1000 digits is far beyond any real amount, and bounds the work for untrusted input
    if (units.length > 1001 || !BASE_UNITS.test(units)) {
      throw new SyntaxError(`Invalid base-unit count "${units}": expected an integer like "1000"`);
    }
    return fromMinor(BigInt(units), currency, decimals);
  }
  return fromMinor(units, currency, decimals);
}
