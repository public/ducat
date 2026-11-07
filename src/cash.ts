import { CASH_RULES, type CashRule } from './generated/cash.js';
import { CurrencyMismatchError, make, scaleUp, toScale, type Money } from './money.js';
import { divRound, divRoundBig, type RoundingMode } from './rounding.js';
import { currencyExponent } from './currency.js';

/**
 * Rounds to a multiple of `increment` (same currency): roundToIncrement(CHF 10.03, CHF 0.05) = CHF 10.05.
 * Default rounding 'halfExpand' (nearest, ties away from zero), which is what the statutory
 * cash-rounding rules (SE, NO, DK, HU, CZ, FI, BE ...) prescribe.
 */
export function roundToIncrement<C extends string>(m: Money<C>, increment: Money<NoInfer<C>>, rounding: RoundingMode = 'halfExpand'): Money<C> {
  if (m.currency !== increment.currency) throw new CurrencyMismatchError(m.currency, increment.currency);
  if (!(increment.minor > 0)) throw new RangeError('increment must be positive');
  const s = Math.max(m.scale, increment.scale);
  const x = scaleUp(m.minor, s - m.scale);
  const inc = scaleUp(increment.minor, s - increment.scale);
  if (typeof x === 'number' && typeof inc === 'number') {
    const q = divRound(x, inc, rounding);
    const r = q * inc;
    if (Number.isSafeInteger(r)) return toScale(make(m.currency, r, s), m.scale > s ? m.scale : s);
  }
  return make(m.currency, divRoundBig(BigInt(x), BigInt(inc), rounding) * BigInt(inc), s);
}

/**
 * The cash-rounding rule for a currency, optionally narrowed by country (ISO 3166 alpha-2).
 * EUR has no euro-wide rule: pass the country (BE, NL, FI, IE, IT, SK, EE, LT).
 */
export function cashRule(currency: string, country?: string): CashRule | undefined {
  let found: CashRule | undefined;
  for (const r of CASH_RULES) {
    if (r.currency !== currency) continue;
    if (country !== undefined) {
      if (r.countries.includes(country)) return r;
    } else if (currency !== 'EUR') {
      found ??= r;
    }
  }
  return found;
}

export interface CashRoundOptions {
  readonly country?: string;
  readonly rounding?: RoundingMode;
  /** Apply rules that are only backed by secondary sources (default true; see data/cash-rounding.json). */
  readonly includeUnverified?: boolean;
}

/**
 * Rounds a cash total to the smallest legal/practical cash step (CHF 0.05, SEK 1, DKK 0.50, CAD 0.05,
 * HUF 5, EUR 0.05 in BE/NL/FI/IE/...). Card and other electronic payments are NOT rounded: only call
 * this for cash tenders. Returns m unchanged when no rule applies.
 */
export function cashRound<C extends string>(m: Money<C>, options?: CashRoundOptions): Money<C> {
  const rule = cashRule(m.currency, options?.country);
  if (!rule || (options?.includeUnverified === false && !rule.verified)) return m;
  const inc = make(m.currency, rule.increment, currencyExponent(m.currency));
  return roundToIncrement(m, inc, options?.rounding ?? 'halfExpand');
}

export { CASH_RULES, type CashRule };
