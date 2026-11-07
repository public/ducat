/**
 * Adyen's minor-unit view (https://docs.adyen.com/development-resources/currency-codes, encoded in
 * data/adyen.json). Adyen's table is authoritative where it differs from ISO 4217: CLP 2 (ISO 0),
 * ISK 2 (ISO 0), IDR 0 (ISO 2), CVE 0 (ISO 2). The Terminal API uses major units instead.
 */
import { ADYEN_EXPONENTS } from './generated/adyen.js';
import { type CurrencyInput, type Money } from './money.js';
import { fromProcessorAmount, toProcessorAmount } from './processor.js';
import type { RoundingMode } from './rounding.js';

export { ADYEN_EXPONENTS };

function exponent(currency: string): number {
  const found = ADYEN_EXPONENTS[currency];
  // typeof, not !== undefined: the table is a plain object, so 'toString' or 'constructor' would
  // otherwise find an inherited method instead of failing.
  if (typeof found !== 'number') {
    throw new RangeError(`${currency} is not in Adyen's currency table`);
  }
  return found;
}

/** Whether Adyen lists the currency (its table, not ISO 4217). */
export const isAdyenCurrency = (currency: string): boolean =>
  typeof ADYEN_EXPONENTS[currency] === 'number';
/** The exponent Adyen's API uses for a currency (CLP 2, ISK 2, IDR 0, CVE 0 differ from ISO). */
export const adyenExponent = exponent;

/** Adyen `amount` object: toAdyen(money('15000', 'IDR')) -> { value: 15000, currency: 'IDR' }. */
export function toAdyen(
  money: Money,
  rounding: RoundingMode = 'unnecessary',
): { value: number; currency: string } {
  return {
    value: toProcessorAmount('Adyen', money, exponent(money.currency), 1, rounding),
    currency: money.currency,
  };
}

/** Reads an Adyen `amount` object: fromAdyen({ value: 15000, currency: 'IDR' }) is 15000 IDR. */
export function fromAdyen<C extends CurrencyInput>(amount: {
  value: number | bigint;
  currency: C;
}): Money<C> {
  return fromProcessorAmount('Adyen', amount.value, amount.currency, exponent(amount.currency));
}
