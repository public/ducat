import { currencyExponent } from './currency.js';
import { fromMinor, scaleDown, scaleUp, toScale, type CurrencyInput, type Money } from './money.js';
import { divRound, RoundingError, type RoundingMode } from './rounding.js';

/** @internal Shared conversion between ISO-scaled Money and a processor's integer amount. */
export function toProcessorAmount(
  processor: string,
  m: Money,
  exponent: number,
  multiple: number,
  rounding: RoundingMode,
): number {
  // to the processor's exponent; going up is exact, going down (e.g. IDR on Adyen) needs rounding
  let v: number | bigint;
  try {
    v = exponent >= m.scale ? scaleUp(m.minor, exponent - m.scale) : scaleDown(m.minor, m.scale - exponent, rounding);
  } catch (e) {
    if (e instanceof RoundingError)
      throw new RoundingError(
        `${m} has more precision than ${processor} accepts for ${m.currency} (${exponent} decimals); pass a rounding mode`,
      );
    throw e;
  }
  if (typeof v !== 'number') throw new RangeError(`${m} is too large for ${processor}`);
  if (multiple !== 1 && v % multiple !== 0) {
    if (rounding === 'unnecessary')
      throw new RoundingError(
        `${processor} requires ${m.currency} amounts to be a multiple of ${multiple} minor units; ${m} is not (pass a rounding mode)`,
      );
    v = divRound(v, multiple, rounding) * multiple;
  }
  return v + 0;
}

/** @internal processor integer -> Money at the ISO exponent when exact, else at the processor's exponent. */
export function fromProcessorAmount<C extends CurrencyInput>(
  processor: string,
  amount: number | bigint,
  currency: C,
  exponent: number,
): Money<C> {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount))
    throw new RangeError(`${processor} amount must be an integer, got ${amount}`);
  const m = fromMinor(amount, currency, exponent);
  const iso = currencyExponent(currency);
  if (iso >= exponent) return toScale(m, iso);
  try {
    return toScale(m, iso, 'unnecessary');
  } catch {
    return m; // e.g. ISK 12.34 from Stripe's two-decimal view: keep the extra precision rather than lose it
  }
}
