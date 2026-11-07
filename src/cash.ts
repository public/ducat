import { CASH_RULES, type CashRule } from './generated/cash.js';
import { CurrencyMismatchError, make, scaleUp, toScale, type Money } from './money.js';
import { divideAndRound, divideAndRoundBigint, type RoundingMode } from './rounding.js';
import { currencyExponent } from './currency.js';

/**
 * Rounds to a multiple of `increment` (same currency): roundToIncrement(CHF 10.03, CHF 0.05) = CHF
 * 10.05. Default rounding 'halfExpand' (nearest, ties away from zero), which is what the statutory
 * cash-rounding rules (SE, NO, DK, HU, CZ, FI, BE ...) prescribe.
 */
export function roundToIncrement<C extends string>(
  money: Money<C>,
  increment: Money<NoInfer<C>>,
  rounding: RoundingMode = 'halfExpand',
): Money<C> {
  if (money.currency !== increment.currency) {
    throw new CurrencyMismatchError(money.currency, increment.currency);
  }
  if (!(increment.minor > 0)) {
    throw new RangeError('increment must be positive');
  }
  const scale = Math.max(money.scale, increment.scale);
  const minor = scaleUp(money.minor, scale - money.scale);
  const step = scaleUp(increment.minor, scale - increment.scale);
  if (typeof minor === 'number' && typeof step === 'number') {
    const steps = divideAndRound(minor, step, rounding);
    const rounded = steps * step;
    if (Number.isSafeInteger(rounded)) {
      return toScale(
        make(money.currency, rounded, scale),
        money.scale > scale ? money.scale : scale,
      );
    }
  }
  return make(
    money.currency,
    divideAndRoundBigint(BigInt(minor), BigInt(step), rounding) * BigInt(step),
    scale,
  );
}

/**
 * The cash-rounding rule for a currency, optionally narrowed by country (ISO 3166 alpha-2).
 * EUR has no euro-wide rule: pass the country (BE, NL, FI, IE, IT, SK, EE, LT).
 */
export function cashRule(currency: string, country?: string): CashRule | undefined {
  let found: CashRule | undefined;
  for (const rule of CASH_RULES) {
    if (rule.currency !== currency) {
      continue;
    }
    if (country !== undefined) {
      if (rule.countries.includes(country)) {
        return rule;
      }
    } else if (currency !== 'EUR') {
      found ??= rule;
    }
  }
  return found;
}

/**
 * Options for `cashRound`: the country (needed for EUR), the rounding mode, and whether to use
 * unverified rules.
 */
export interface CashRoundOptions {
  readonly country?: string;
  readonly rounding?: RoundingMode;
  /**
   * Apply rules that are only backed by secondary sources (default true; see
   * data/cash-rounding.json).
   */
  readonly includeUnverified?: boolean;
}

/**
 * Rounds a cash total to the smallest legal/practical cash step (CHF 0.05, SEK 1, DKK 0.50, CAD
 * 0.05, HUF 5, EUR 0.05 in BE/NL/FI/IE/...). Card and other electronic payments are NOT rounded:
 * only call this for cash tenders. Returns m unchanged when no rule applies.
 */
export function cashRound<C extends string>(money: Money<C>, options?: CashRoundOptions): Money<C> {
  const rule = cashRule(money.currency, options?.country);
  if (!rule || (options?.includeUnverified === false && !rule.verified)) {
    return money;
  }
  const inc = make(money.currency, rule.increment, currencyExponent(money.currency));
  return roundToIncrement(money, inc, options?.rounding ?? 'halfExpand');
}

export { CASH_RULES, type CashRule };
