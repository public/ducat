import { currencyExponent } from './currency.js';
import { formatScaled, parseDecimal, parsePlainDecimal, toSafe } from './decimal.js';
import { fromMinor, scaleDown, scaleUp, toScale, type CurrencyInput, type Money } from './money.js';
import { divRound, divRoundBig, RoundingError, type RoundingMode } from './rounding.js';

/**
 * Rescales Money's minor units to a processor's exponent, then to a multiple of `multiple` minor
 * units (Checkout.com's CLP, Stripe's ISK). Throws a RoundingError naming the processor when
 * precision would be lost and `rounding` is 'unnecessary'.
 */
function rescaleForProcessor(
  processor: string,
  money: Money,
  exponent: number,
  multiple: number,
  rounding: RoundingMode,
): number | bigint {
  // Going up in scale is always exact; going down (e.g. IDR on Adyen) may need rounding.
  let minor: number | bigint;
  try {
    if (exponent >= money.scale) {
      minor = scaleUp(money.minor, exponent - money.scale);
    } else {
      minor = scaleDown(money.minor, money.scale - exponent, rounding);
    }
  } catch (error) {
    if (error instanceof RoundingError) {
      throw new RoundingError(
        `${money} has more precision than ${processor} accepts for ${money.currency} ` +
          `(${exponent} decimals); pass a rounding mode`,
      );
    }
    throw error;
  }

  if (multiple === 1) {
    return minor;
  }

  const isMultiple = typeof minor === 'number' ? minor % multiple === 0 : minor % BigInt(multiple) === 0n;
  if (isMultiple) {
    return minor;
  }
  if (rounding === 'unnecessary') {
    throw new RoundingError(
      `${processor} requires ${money.currency} amounts to be a multiple of ${multiple} minor units; ` +
        `${money} is not (pass a rounding mode)`,
    );
  }

  if (typeof minor === 'number') {
    return divRound(minor, multiple, rounding) * multiple;
  }
  const bigMultiple = BigInt(multiple);
  return toSafe(divRoundBig(minor, bigMultiple, rounding) * bigMultiple);
}

/**
 * @internal Money -> a processor's integer amount at the processor's exponent.
 * Throws a RangeError when the amount doesn't fit in a safe integer.
 */
export function toProcessorAmount(
  processor: string,
  money: Money,
  exponent: number,
  multiple: number,
  rounding: RoundingMode,
): number {
  const minor = rescaleForProcessor(processor, money, exponent, multiple, rounding);
  if (typeof minor !== 'number') {
    throw new RangeError(`${money} is too large for ${processor}`);
  }

  // `+ 0` turns -0 into 0, so a zero amount never serialises as "-0".
  return minor + 0;
}

/**
 * @internal Money -> a processor's decimal string with exactly `exponent` decimals
 * ("10.00", or "1000" for JPY), built from the integer so it never goes through a float.
 */
export function toProcessorDecimal(processor: string, money: Money, exponent: number, rounding: RoundingMode): string {
  const minor = rescaleForProcessor(processor, money, exponent, 1, rounding);
  return formatScaled(minor, exponent);
}

/**
 * Returns Money at the currency's ISO scale when that is exact, and otherwise at the scale it
 * came with, so a processor's extra precision (Stripe's ISK 12.34) is kept rather than lost.
 */
function toIsoScaleWhenExact<C extends string>(money: Money<C>, currency: C): Money<C> {
  const isoExponent = currencyExponent(currency);
  if (isoExponent >= money.scale) {
    return toScale(money, isoExponent);
  }

  try {
    return toScale(money, isoExponent, 'unnecessary');
  } catch {
    return money;
  }
}

/** @internal A processor's integer amount -> Money (see `toIsoScaleWhenExact` for the scale). */
export function fromProcessorAmount<C extends CurrencyInput>(
  processor: string,
  amount: number | bigint,
  currency: C,
  exponent: number,
): Money<C> {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new RangeError(`${processor} amount must be an integer, got ${amount}`);
  }

  return toIsoScaleWhenExact(fromMinor(amount, currency, exponent), currency);
}

/**
 * @internal A processor's decimal string -> Money, exactly (never via a float). `pattern` is the
 * processor's documented format. The scale follows `toIsoScaleWhenExact`.
 */
export function fromProcessorDecimal<C extends CurrencyInput>(
  processor: string,
  value: string,
  currency: C,
  pattern: RegExp,
): Money<C> {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new SyntaxError(`${processor} amount must be a decimal string, got ${JSON.stringify(value)}`);
  }

  // PayPal's pattern allows a bare fraction (".5"), which the decimal parsers don't.
  const withLeadingZero = value.replace(/^(-?)\./, '$10.');
  const parsed = parsePlainDecimal(withLeadingZero) ?? parseDecimal(withLeadingZero);
  return toIsoScaleWhenExact(fromMinor(parsed.digits, currency, parsed.scale), currency);
}
