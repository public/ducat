/**
 * `@ducatjs/money/wire`: Money to and from common wire formats, exactly in both directions:
 * - `google.type.Money` (`currencyCode`, `units`, `nanos`), used by Google APIs and many gRPC
 *   services;
 * - ISO 20022 amounts (`<InstdAmt Ccy="EUR">12.34</InstdAmt>`): a non-negative decimal with at
 *   most 5 decimals and 18 digits;
 * - `{ value, currency }` with an integer count of ISO 4217 minor units, the JSON several
 *   processors and ledgers use.
 *
 * Every reader checks the format strictly, and every writer throws rather than send a value the
 * format can't hold.
 */
import { currencyExponent } from './currency.js';
import { formatScaled, parseDecimal } from './decimal.js';
import { fromMinor, toScale, type CurrencyInput, type Money } from './money.js';
import { fromProcessorAmount, toProcessorAmount } from './processor.js';
import { RoundingError, type RoundingMode } from './rounding.js';

const NANOS_PER_UNIT = 1_000_000_000n;
const MAX_INT64 = 2n ** 63n - 1n;
const MIN_INT64 = -(2n ** 63n);
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Options for the readers: the scale of the Money they return, and how to round to it. */
export interface WireReadOptions {
  /** The result's scale (default: the currency's ISO exponent). */
  readonly scale?: number;
  /** How to round when the value has more decimals than that (default 'unnecessary': throw). */
  readonly rounding?: RoundingMode;
}

/** `value` (an integer count of 10^-from units) as Money at the requested scale. */
function atScale<C extends string>(
  format: string,
  value: bigint,
  from: number,
  currency: C,
  options: WireReadOptions | undefined,
): Money<C> {
  const exact = fromMinor(value, currency, from);
  const scale = options?.scale ?? currencyExponent(currency);
  try {
    return toScale(exact, scale, options?.rounding ?? 'unnecessary');
  } catch (error) {
    if (error instanceof RoundingError) {
      throw new RoundingError(
        `${format} ${formatScaled(exact.minor, exact.scale)} ${currency} has more than ${scale} decimals; pass { rounding } or { scale }`,
      );
    }
    throw error;
  }
}

/** `money` as an integer count of 10^-scale units, or undefined when that would drop digits. */
function exactAt(money: Money, scale: number): bigint | undefined {
  const minor = BigInt(money.minor);
  if (money.scale <= scale) {
    return minor * 10n ** BigInt(scale - money.scale);
  }
  const divisor = 10n ** BigInt(money.scale - scale);
  return minor % divisor === 0n ? minor / divisor : undefined;
}

// ---------------------------------------------------------------------------------------------
// google.type.Money
// ---------------------------------------------------------------------------------------------

/**
 * `google.type.Money` in its proto3 JSON form: `units` is an int64, which proto3 JSON writes as a
 * string, and `nanos` the billionths, with the same sign as `units`.
 */
export interface GoogleMoney {
  readonly currencyCode: string;
  readonly units: string;
  readonly nanos: number;
}

/**
 * Money as `google.type.Money`: `toGoogleMoney(money('-1.75', 'EUR'))` is `{ currencyCode: 'EUR',
 * units: '-1', nanos: -750000000 }`. Throws a RoundingError for an amount with more than 9
 * decimals (unless `rounding` is given), and a RangeError when the whole units don't fit in an
 * int64 or the code isn't three capital letters, as the format requires.
 */
export function toGoogleMoney(money: Money, rounding: RoundingMode = 'unnecessary'): GoogleMoney {
  if (!CURRENCY_CODE.test(money.currency)) {
    throw new RangeError(`google.type.Money needs an ISO 4217 code, got ${money.currency}`);
  }
  let total = exactAt(money, 9);
  if (total === undefined) {
    if (rounding === 'unnecessary') {
      throw new RoundingError(
        `${money.toString()} has more than 9 decimals, the most google.type.Money holds; pass a rounding mode`,
      );
    }
    total = BigInt(toScale(money, 9, rounding).minor);
  }

  // bigint division and remainder truncate toward zero, so units and nanos share the sign
  const units = total / NANOS_PER_UNIT;
  const nanos = Number(total % NANOS_PER_UNIT);
  if (units > MAX_INT64 || units < MIN_INT64) {
    throw new RangeError(`${money.toString()} doesn't fit in google.type.Money (int64 units)`);
  }
  // `+ 0` turns -0 into 0
  return { currencyCode: money.currency, units: String(units), nanos: nanos + 0 };
}

/** What `fromGoogleMoney` accepts: the proto3 JSON form, or units as a number or bigint. */
export interface GoogleMoneyInput {
  readonly currencyCode: string;
  readonly units?: string | number | bigint;
  readonly nanos?: number;
}

/**
 * Reads `google.type.Money`, exactly: `fromGoogleMoney({ currencyCode: 'EUR', units: '12', nanos:
 * 340000000 })` is 12.34 EUR. Missing `units` or `nanos` mean 0, as in proto3. The value is checked
 * as the format defines it: `units` an int64, `nanos` from -999,999,999 to 999,999,999 with the
 * same sign as a non-zero `units`. A malformed value throws a RangeError. The result has the
 * currency's exponent; more decimals throw a RoundingError unless `options` says what to do.
 */
export function fromGoogleMoney<C extends CurrencyInput>(
  value: GoogleMoneyInput & { readonly currencyCode: C },
  options?: WireReadOptions,
): Money<C> {
  const invalid = (reason: string): never => {
    throw new RangeError(`Invalid google.type.Money: ${reason}`);
  };
  if (value === null || typeof value !== 'object') {
    return invalid('expected an object');
  }
  const { currencyCode, units = 0, nanos = 0 } = value;
  if (typeof currencyCode !== 'string' || !CURRENCY_CODE.test(currencyCode)) {
    return invalid(`currencyCode ${JSON.stringify(currencyCode)}`);
  }

  let wholeUnits: bigint;
  if (typeof units === 'bigint') {
    wholeUnits = units;
  } else if (typeof units === 'number' && Number.isSafeInteger(units)) {
    wholeUnits = BigInt(units);
  } else if (typeof units === 'string' && /^-?\d{1,19}$/.test(units)) {
    wholeUnits = BigInt(units);
  } else {
    return invalid(`units ${JSON.stringify(String(units))}`);
  }
  if (wholeUnits > MAX_INT64 || wholeUnits < MIN_INT64) {
    return invalid(`units ${wholeUnits} is beyond int64`);
  }
  if (!Number.isInteger(nanos) || nanos > 999_999_999 || nanos < -999_999_999) {
    return invalid(`nanos ${nanos}`);
  }
  if ((wholeUnits > 0n && nanos < 0) || (wholeUnits < 0n && nanos > 0)) {
    return invalid(`units ${wholeUnits} and nanos ${nanos} have different signs`);
  }

  const total = wholeUnits * NANOS_PER_UNIT + BigInt(nanos);
  return atScale('google.type.Money', total, 9, currencyCode, options);
}

// ---------------------------------------------------------------------------------------------
// ISO 20022
// ---------------------------------------------------------------------------------------------

/**
 * An ISO 20022 amount, as in `<InstdAmt Ccy="EUR">12.34</InstdAmt>`: `Ccy` is the attribute and
 * `value` the element's text.
 */
export interface Iso20022Amount {
  readonly Ccy: string;
  readonly value: string;
}

// ActiveOrHistoricCurrencyAndAmount: xs:decimal, fractionDigits 5, totalDigits 18, minInclusive 0
const ISO_20022_AMOUNT = /^(\d+)(?:\.(\d+))?$/;
const ISO_20022_MAX_DECIMALS = 5;
const ISO_20022_MAX_DIGITS = 18;

/**
 * Whether a decimal's value fits the schema's facets. XSD counts digits in the value, not the text,
 * so leading zeros and trailing fractional zeros don't count: '0012.3400' has 4 digits, 2 decimals.
 */
function fitsIso20022(integer: string, fraction: string): boolean {
  const decimals = fraction.replace(/0+$/, '');
  const whole = integer.replace(/^0+/, '');
  return (
    decimals.length <= ISO_20022_MAX_DECIMALS &&
    whole.length + decimals.length <= ISO_20022_MAX_DIGITS
  );
}

/** Options for `toIso20022Amount`. */
export interface Iso20022WriteOptions {
  /**
   * The number of decimals to write (default: the currency's ISO exponent), at most 5. The payment
   * networks' rules (CBPR+, HVPS+) require the currency's minor unit, so give another only for
   * messages that allow it.
   */
  readonly scale?: number;
}

/**
 * Money as an ISO 20022 amount: `toIso20022Amount(money('12.34', 'EUR'))` is `{ Ccy: 'EUR', value:
 * '12.34' }`. It is written with the currency's decimals, as the payment networks' rules (CBPR+,
 * HVPS+) require for ActiveCurrencyAndAmount: 12.3400 EUR at scale 4 is written '12.34', and JPY
 * '1000'. More decimals than that throw a RoundingError unless `rounding` is given. The schema
 * types allow at most 5 decimals and 18 digits, and no negative amounts: the direction is carried
 * elsewhere in the message (a credit/debit indicator). An amount that doesn't fit throws a
 * RangeError.
 */
export function toIso20022Amount(
  money: Money,
  rounding: RoundingMode = 'unnecessary',
  options?: Iso20022WriteOptions,
): Iso20022Amount {
  if (!CURRENCY_CODE.test(money.currency)) {
    throw new RangeError(`ISO 20022 amounts need an ISO 4217 code, got ${money.currency}`);
  }
  const scale = options?.scale ?? currencyExponent(money.currency);
  if (!Number.isInteger(scale) || scale < 0 || scale > ISO_20022_MAX_DECIMALS) {
    throw new RangeError(`ISO 20022 amounts have 0 to 5 decimals, not ${scale}`);
  }

  let amount: Money;
  try {
    amount = toScale(money, scale, rounding);
  } catch (error) {
    if (error instanceof RoundingError) {
      throw new RoundingError(
        `${money.toString()} has more than ${scale} decimals for an ISO 20022 ${money.currency} amount; pass a rounding mode`,
      );
    }
    throw error;
  }
  if (amount.minor < 0) {
    throw new RangeError(
      `ISO 20022 amounts can't be negative (${money.toString()}); use the credit/debit indicator`,
    );
  }
  const value = formatScaled(amount.minor, amount.scale);
  const [integer = '', fraction = ''] = value.split('.');
  if (!fitsIso20022(integer, fraction)) {
    throw new RangeError(`${money.toString()} has more than 18 digits, the most ISO 20022 allows`);
  }
  return { Ccy: money.currency, value };
}

/**
 * Reads an ISO 20022 amount, exactly: `fromIso20022Amount({ Ccy: 'EUR', value: '12.34' })` is
 * 12.34 EUR. The text is checked as the schema defines it: plain digits with an optional decimal
 * point, at most 5 decimals and 18 digits (not counting leading or trailing zeros, as XSD
 * counts them), no sign, exponent or spaces (XML whitespace around the
 * element's text should be trimmed by the XML reader). Anything else throws a SyntaxError. The
 * result has the currency's exponent; more decimals throw a RoundingError unless `options` says what
 * to do (KWD's 3 decimals fit; 12.345 EUR needs `{ scale: 3 }` or a rounding mode).
 */
export function fromIso20022Amount<C extends CurrencyInput>(
  amount: { readonly Ccy: C; readonly value: string },
  options?: WireReadOptions,
): Money<C> {
  const { Ccy: currency, value } = amount ?? ({} as never);
  if (typeof currency !== 'string' || !CURRENCY_CODE.test(currency)) {
    throw new SyntaxError(`Invalid ISO 20022 currency ${JSON.stringify(currency)}`);
  }
  const match = typeof value === 'string' ? ISO_20022_AMOUNT.exec(value) : null;
  if (match === null || !fitsIso20022(match[1]!, match[2] ?? '')) {
    throw new SyntaxError(
      `Invalid ISO 20022 amount ${JSON.stringify(value)}: at most 18 digits, 5 of them decimals`,
    );
  }
  const parsed = parseDecimal(value);
  return atScale('ISO 20022 amount', parsed.digits, parsed.scale, currency, options);
}

// ---------------------------------------------------------------------------------------------
// { value, currency } in minor units
// ---------------------------------------------------------------------------------------------

/** An integer count of the currency's ISO 4217 minor units: `{ value: 1234, currency: 'EUR' }`. */
export interface MinorUnitAmount {
  readonly value: number;
  readonly currency: string;
}

/**
 * Money as `{ value, currency }` in ISO 4217 minor units: `toMinorUnits(money('12.34', 'EUR'))` is
 * `{ value: 1234, currency: 'EUR' }`, and JPY 500 is `{ value: 500, currency: 'JPY' }`. The same
 * shape as Adyen's `amount`, at the ISO exponent; use the processor's own view (`toAdyen`,
 * `toCheckout`, ...) where its exponents differ from ISO. Throws a RoundingError for an amount with
 * more decimals than the currency (unless `rounding` is given), and a RangeError beyond 2^53 - 1
 * minor units, which JSON numbers can't hold exactly.
 */
export function toMinorUnits(
  money: Money,
  rounding: RoundingMode = 'unnecessary',
): MinorUnitAmount {
  const exponent = currencyExponent(money.currency);
  return {
    value: toProcessorAmount('ISO 4217 minor units', money, exponent, 1, rounding),
    currency: money.currency,
  };
}

/**
 * Reads `{ value, currency }` in ISO 4217 minor units: `fromMinorUnits({ value: 1234, currency:
 * 'EUR' })` is 12.34 EUR. `value` must be a safe integer (or a bigint); anything else throws a
 * RangeError.
 */
export function fromMinorUnits<C extends CurrencyInput>(amount: {
  readonly value: number | bigint;
  readonly currency: C;
}): Money<C> {
  if (amount === null || typeof amount !== 'object' || typeof amount.currency !== 'string') {
    throw new RangeError('Expected { value, currency }');
  }
  return fromProcessorAmount(
    'ISO 4217 minor units',
    amount.value,
    amount.currency,
    currencyExponent(amount.currency),
  );
}
