// Conversions between Money and the values SQL drivers send and receive, shared by the ORM and
// query-builder integrations (`/drizzle/*`, `/kysely`). Every reader is strict: a driver value that
// may already have lost digits (an unsafe number, a float for a DECIMAL) is rejected rather than
// trusted, and every writer refuses a value the column would change.
import { currencyExponent } from './currency.js';
import {
  CurrencyMismatchError,
  fromJSON,
  fromMinor,
  money as parseMoney,
  toDecimal,
  toMinor,
  type Money,
  type MoneyJSON,
} from './money.js';

const INTEGER_TEXT = /^-?\d+$/;
// a BIGINT (SQLite INTEGER) column's range: MySQL outside strict mode clips anything beyond it
const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;

/** The declared size of a NUMERIC/DECIMAL column. */
export interface DecimalColumnSize {
  /** Total number of significant digits the column holds. */
  readonly precision: number;
  /** Digits after the decimal point. */
  readonly scale: number;
}

/** NUMERIC(19,4): 15 integer digits and 4 decimals, enough for every ISO 4217 exponent. */
export const DEFAULT_DECIMAL_SIZE: DecimalColumnSize = { precision: 19, scale: 4 };

/** Throws unless the money is in the column's currency (when the column has a fixed currency). */
export function checkCurrency(money: Money, currency: string | undefined): void {
  if (currency !== undefined && money.currency !== currency) {
    throw new CurrencyMismatchError(currency, money.currency);
  }
}

/**
 * Throws unless the money is at its currency's exponent (or the column's `scale`). Columns store
 * amounts at one scale, so a value with more digits would have to be rounded, and the caller should
 * choose how.
 */
export function checkIsoScale(money: Money, scale = currencyExponent(money.currency)): void {
  if (money.scale !== scale) {
    throw new RangeError(
      `${money} has scale ${money.scale}; round() it to ${scale} decimals before storing it`,
    );
  }
}

/**
 * Minor units for a BIGINT column, as a bigint: units of 10^-scale when the column has a `scale`,
 * else the currency's minor units. Throws beyond the column's range, ±9.2·10^18: MySQL outside
 * strict mode would store the nearest limit instead.
 */
export function minorToDriver(money: Money, currency: string | undefined, scale?: number): bigint {
  checkCurrency(money, currency);
  checkIsoScale(money, scale);
  const minor = scale === undefined ? toMinor(money) : BigInt(money.minor);

  if (minor < BIGINT_MIN || minor > BIGINT_MAX) {
    throw new RangeError(`${money} is ${minor} minor units, beyond the range of a BIGINT column`);
  }
  return minor;
}

/**
 * Money from a BIGINT driver value. Accepts a bigint, a safe-integer number, or an integer string
 * (node-postgres returns int8 as a string). A number beyond 2^53 has already lost digits, so it
 * throws.
 */
export function minorFromDriver<C extends string>(
  value: unknown,
  currency: C,
  scale?: number,
): Money<C> {
  if (typeof value === 'string') {
    if (!INTEGER_TEXT.test(value)) {
      throw new SyntaxError(`Expected an integer from a BIGINT column, got "${value}"`);
    }
    return fromMinor(BigInt(value), currency, scale);
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return fromMinor(value, currency, scale);
  }
  throw new TypeError(`Expected an integer from a BIGINT column, got ${typeof value}`);
}

/** Throws if a decimal column of this size would round amounts in this currency. */
export function checkDecimalSize(currency: string, size: DecimalColumnSize): void {
  const { precision, scale } = size;
  const isValidSize =
    Number.isInteger(precision) &&
    Number.isInteger(scale) &&
    precision >= 1 &&
    scale >= 0 &&
    scale <= precision;
  if (!isValidSize) {
    throw new RangeError(`NUMERIC(${precision},${scale}) is not a valid column size`);
  }

  const exponent = currencyExponent(currency);
  if (size.scale < exponent) {
    throw new RangeError(
      `NUMERIC(${size.precision},${size.scale}) would round ${currency}, which has ${exponent} decimals`,
    );
  }
}

/**
 * The exact decimal string for a NUMERIC/DECIMAL column. Throws if the column could not hold it
 * unchanged: MySQL outside strict mode clamps an out-of-range value instead of failing.
 */
export function decimalToDriver(
  money: Money,
  currency: string | undefined,
  size: DecimalColumnSize | undefined,
): string {
  checkCurrency(money, currency);
  checkIsoScale(money);
  const decimal = toDecimal(money);

  if (size !== undefined) {
    checkIntegerDigits(money, decimal, size);
  }
  return decimal;
}

/**
 * Throws if the decimal (the money's `toDecimal`) has more integer digits than a column of this
 * size holds: Postgres rejects it, and MySQL outside strict mode clamps it.
 */
export function checkIntegerDigits(money: Money, decimal: string, size: DecimalColumnSize): void {
  const integerPart = decimal.replace('-', '').split('.')[0]!;
  // "0.12" has no integer digits: NUMERIC(4,4) holds it
  const integerDigits = integerPart === '0' ? 0 : integerPart.length;
  if (integerDigits > size.precision - size.scale) {
    throw new RangeError(
      `${money} does not fit NUMERIC(${size.precision},${size.scale}), which holds ` +
        `${size.precision - size.scale} integer digits`,
    );
  }
}

/**
 * Money from a NUMERIC/DECIMAL driver value, which must be a string: a number has been through a
 * float. Trailing zeros (`12.3400` from NUMERIC(19,4)) are fine; more decimals than the currency
 * has, `NaN` and `Infinity` throw.
 */
export function decimalFromDriver<C extends string>(value: unknown, currency: C): Money<C> {
  if (typeof value !== 'string') {
    throw new TypeError(
      `Expected a string from a DECIMAL column, got ${typeof value}; ` +
        'configure the driver to return decimals as strings',
    );
  }
  return parseMoney(value, currency);
}

/** `{"amount":"12.34","currency":"EUR"}` for a JSON, JSONB or TEXT column. */
export function jsonToDriver(money: Money, currency: string | undefined): string {
  checkCurrency(money, currency);
  checkIsoScale(money);
  return JSON.stringify(money);
}

/**
 * Money from a JSON column: the parsed object (JSONB in node-postgres, JSON in mysql2) or the
 * text (SQLite).
 */
export function jsonFromDriver<C extends string>(
  value: unknown,
  currency: C | undefined,
): Money<C> {
  if (typeof value !== 'string' && (typeof value !== 'object' || value === null)) {
    throw new TypeError(`Expected JSON from a money column, got ${String(value)}`);
  }
  const parsed = fromJSON(value as MoneyJSON | string) as Money<C>;
  checkCurrency(parsed, currency);
  return parsed;
}
