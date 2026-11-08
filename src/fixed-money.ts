// Conversions between Fixed and Money. They live apart from src/fixed.ts so that a program using only
// Fixed doesn't carry the Money class or the currency table.
import { currencyExponent } from './currency.js';
import { fromScaled, type Fixed } from './fixed.js';
import { fromMinor, toScale, type CurrencyInput, type Money } from './money.js';
import { RoundingError, type RoundingMode } from './rounding.js';

/** The exact Fixed of a Money amount, at the money's scale: `money('12.34', 'EUR')` → 12.34. */
export function moneyToFixed(money: Money): Fixed {
  return fromScaled(money.minor, money.scale);
}

/**
 * `value` as Money in `currency`, at the currency's exponent. Throws RoundingError when that would
 * drop digits, unless `rounding` is given: `fixedToMoney(fixed('1.005'), 'EUR', 'halfEven')` is
 * 1.00 EUR.
 */
export function fixedToMoney<C extends CurrencyInput>(
  value: Fixed,
  currency: C,
  rounding: RoundingMode = 'unnecessary',
): Money<C> {
  const exact = fromMinor(value.value, currency, value.scale);
  const target = currencyExponent(currency);
  if (target === value.scale) {
    return exact;
  }
  try {
    return toScale(exact, target, rounding);
  } catch (error) {
    if (error instanceof RoundingError) {
      throw new RoundingError(
        `${value.toString()} has more than ${target} decimal places for ${currency}; pass a rounding mode`,
      );
    }
    throw error;
  }
}
