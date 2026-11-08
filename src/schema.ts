import { isCurrency } from './currency.js';
import { money, type Money, type MoneyJSON } from './money.js';
import type { RoundingMode } from './rounding.js';

/** Options for the Zod and Valibot money schemas. */
export interface MoneySchemaOptions<C extends string = string> {
  /**
   * The currency, or the currencies, to accept. Without it, any ISO 4217 code or code registered
   * with `defineCurrency` is accepted, and nothing else.
   */
  readonly currency?: C | readonly C[];
  /** Decimal places to keep (default: the currency's exponent), as in `money()`. */
  readonly scale?: number;
  /**
   * How to round an amount with more decimals than the scale. The default, 'unnecessary', rejects
   * such amounts, as `fromJSON` does.
   */
  readonly rounding?: RoundingMode;
}

/** The Money type a schema produces: one Money per allowed currency, not a mixed-currency Money. */
export type MoneyFor<C extends string> = C extends string ? Money<C> : never;

/** @internal A problem with one field of the input, for the schema libraries' issue paths. */
export interface MoneyIssue {
  readonly field: 'amount' | 'currency';
  readonly message: string;
}

// The exact decimal strings `toJSON` writes: an optional minus, digits, and an optional fraction.
// No exponent, no plus sign, no whitespace and no grouping, so the wire format stays unambiguous.
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/**
 * @internal Reads `{ amount, currency }` (already known to have two string fields) into Money, or
 * says what is wrong with it. Shared by the Zod and Valibot entries, so both accept exactly the
 * same inputs.
 */
export function readMoneyJSON<C extends string>(
  json: MoneyJSON,
  options: MoneySchemaOptions<C> | undefined,
): Money | MoneyIssue {
  const currency = json.currency;
  const allowed = options?.currency;

  if (allowed === undefined) {
    if (!isCurrency(currency)) {
      return { field: 'currency', message: `Unknown currency "${currency}"` };
    }
  } else if (
    typeof allowed === 'string' ? currency !== allowed : !allowed.includes(currency as C)
  ) {
    const expected = typeof allowed === 'string' ? allowed : allowed.join(', ');
    return { field: 'currency', message: `Expected currency ${expected}, got "${currency}"` };
  }

  if (!DECIMAL.test(json.amount)) {
    return { field: 'amount', message: 'Expected a decimal string such as "12.34"' };
  }

  try {
    return money(json.amount, currency, options);
  } catch (error) {
    // money() reports too many decimals (RoundingError) and bad options (RangeError)
    return { field: 'amount', message: (error as Error).message };
  }
}
