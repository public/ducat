/**
 * Klarna's amount view (Klarna Payments and Order Management; https://docs.klarna.com/acquirer/klarna/get-started/integration-resilience/data-types/,
 * encoded in data/klarna.json). Amounts (`order_amount`, `unit_price`, `total_amount`, ...) are
 * integers "in minor units according to the ISO 4217 standard", in the one local currency of each
 * purchase country: 25 EUR -> 2500, 1000 HUF -> 100000 (fillér; PayPal sends HUF without decimals).
 */
import { KLARNA_EXPONENTS } from './generated/klarna.js';
import { type CurrencyInput, type Money } from './money.js';
import { fromProcessorAmount, toProcessorAmount } from './processor.js';
import type { RoundingMode } from './rounding.js';

export { KLARNA_EXPONENTS };

/** The ISO 4217 exponent of a Klarna purchase currency; throws for any other currency. */
function klarnaExponent(currency: string): number {
  const exponent = KLARNA_EXPONENTS[currency.toUpperCase()];
  if (exponent === undefined) {
    throw new RangeError(`${currency} is not a Klarna purchase currency`);
  }
  return exponent;
}

/** Whether the currency is one of Klarna's purchase currencies (case-insensitive). */
export function isKlarnaCurrency(currency: string): boolean {
  return KLARNA_EXPONENTS[currency.toUpperCase()] !== undefined;
}

export interface KlarnaAmountOptions {
  /** How to round when the value has more decimals than the currency (default 'unnecessary': throw). */
  readonly rounding?: RoundingMode;
}

/** The integer to send in any Klarna amount field: toKlarna(money('25', 'EUR')) === 2500. */
export function toKlarna(money: Money, options?: KlarnaAmountOptions): number {
  const rounding = options?.rounding ?? 'unnecessary';
  return toProcessorAmount('Klarna', money, klarnaExponent(money.currency), 1, rounding);
}

/** Reads a Klarna amount field: fromKlarna(2500, 'EUR') is 25.00 EUR. */
export function fromKlarna<C extends CurrencyInput>(amount: number | bigint, currency: C): Money<Uppercase<C>> {
  const code = currency.toUpperCase() as Uppercase<C>;
  return fromProcessorAmount('Klarna', amount, code, klarnaExponent(code));
}
