import { CASH_RULES, type CashRule } from './generated/cash.js';
import {
  CurrencyMismatchError,
  make,
  scaleUp,
  toScale,
  type Money,
  type RoundingPolicy,
} from './money.js';
import { roundingPolicy } from './policy.js';
import { divideAndRound, divideAndRoundBigint, type RoundingMode } from './rounding.js';
import { currencyExponent } from './currency.js';
import { formatScaled } from './decimal.js';

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
  const rules = cashRulesFor(currency);
  if (rules === undefined) {
    return undefined;
  }
  if (country !== undefined) {
    for (let i = 0; i < rules.length; i++) {
      if (rules[i]!.countries.includes(country)) {
        return rules[i];
      }
    }
    return undefined;
  }
  // EUR has no euro-wide rule, so it needs a country
  if (currency === 'EUR') {
    return undefined;
  }
  return rules[0];
}

// CASH_RULES grouped by currency, in table order. Built on first use, not at import, so the module
// stays free of side effects; cashRound calls cashRule on every amount, and a scan of the whole table
// was most of its cost.
let rulesByCurrency: Map<string, CashRule[]> | undefined;

function cashRulesFor(currency: string): readonly CashRule[] | undefined {
  if (rulesByCurrency === undefined) {
    rulesByCurrency = new Map();
    for (let i = 0; i < CASH_RULES.length; i++) {
      const rule = CASH_RULES[i]!;
      const forCurrency = rulesByCurrency.get(rule.currency);
      if (forCurrency === undefined) {
        rulesByCurrency.set(rule.currency, [rule]);
      } else {
        forCurrency.push(rule);
      }
    }
  }
  return rulesByCurrency.get(currency);
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
  return roundToIncrement(money, inc, options?.rounding ?? rule.rounding ?? 'halfExpand');
}

/**
 * The cash-rounding rule for a currency as a `RoundingPolicy`, to pass wherever a rounding mode
 * goes: `m.multiply('1.075', cashPolicy('CHF'))` rounds once, straight to CHF 0.05. The policy only
 * accepts amounts in `currency`. Throws a RangeError when no rule applies (EUR needs a country);
 * use `isoPolicy` for currencies without cash rounding.
 */
export function cashPolicy(currency: string, options?: CashRoundOptions): RoundingPolicy {
  const rule = cashRule(currency, options?.country);
  if (!rule || (options?.includeUnverified === false && !rule.verified)) {
    const where = options?.country === undefined ? '' : ` in ${options.country}`;
    throw new RangeError(`No cash-rounding rule for ${currency}${where}`);
  }
  return roundingPolicy({
    scale: currencyExponent(currency),
    increment: rule.increment,
    rounding: options?.rounding ?? rule.rounding ?? 'halfExpand',
    currency,
  });
}

/** Options for `currencyDigits`. */
export interface CurrencyDigitsOptions {
  /** 'standard' (the default): the ISO 4217 exponent. 'cash': the decimals of a cash amount. */
  readonly usage?: 'standard' | 'cash';
  /** For cash: the country (ISO 3166 alpha-2), which EUR needs. */
  readonly country?: string;
  /** For cash: whether to use rules backed only by secondary sources (default true). */
  readonly includeUnverified?: boolean;
}

/**
 * The number of decimals a currency's amounts are shown with: its ISO 4217 exponent, or with
 * `{ usage: 'cash' }`, the decimals of a cash amount (what CLDR calls `cashDigits`): none when cash
 * is rounded to whole units, the exponent otherwise.
 *
 *     currencyDigits('SEK')                       // 2
 *     currencyDigits('SEK', { usage: 'cash' })    // 0: cash is rounded to whole kronor
 *     currencyDigits('CHF', { usage: 'cash' })    // 2: CHF 0.05 still needs two decimals
 *
 * A currency without a cash rule (or EUR without a country that has one) takes its exponent.
 * Throws for unknown codes, like `currencyExponent`.
 */
export function currencyDigits(currency: string, options?: CurrencyDigitsOptions): number {
  const exponent = currencyExponent(currency);
  if (options?.usage !== 'cash') {
    return exponent;
  }
  const rule = cashRule(currency, options.country);
  if (!rule || (options.includeUnverified === false && !rule.verified)) {
    return exponent;
  }

  // Cash amounts show no decimals once the step is whole units (SEK 1, HUF 5, UZS 50), and the
  // currency's usual decimals otherwise: DKK 0.50 is shown as 10.50, not 10.5, as in CLDR.
  if (rule.increment % 10 ** exponent === 0) {
    return 0;
  }
  return exponent;
}

/** Options for `cashUnit`. */
export interface CashUnitOptions {
  /** The country (ISO 3166 alpha-2), which EUR needs. */
  readonly country?: string;
  /** Whether to use rules backed only by secondary sources (default true). */
  readonly includeUnverified?: boolean;
}

/**
 * The smallest cash step, in major units, as an exact decimal string without trailing zeros: the smallest coin in use
 * where the cash rules know one. `cashUnit('CHF')` is '0.05', `cashUnit('SEK')` is '1',
 * `cashUnit('EUR', { country: 'NL' })` is '0.05'. A currency without a cash rule (or EUR without a
 * country that has one) gives its minor unit, '0.01' for GBP. Throws for unknown codes, like
 * `currencyExponent`.
 */
export function cashUnit(currency: string, options?: CashUnitOptions): string {
  const exponent = currencyExponent(currency);
  const rule = cashRule(currency, options?.country);
  if (!rule || (options?.includeUnverified === false && !rule.verified)) {
    return formatScaled(1, exponent);
  }
  // without trailing zeros: SEK's step is 100 öre, '1' rather than '1.00'
  return formatScaled(rule.increment, exponent).replace(/\.0+$|(\.\d*?)0+$/, '$1');
}

export { CASH_RULES, type CashRule };
