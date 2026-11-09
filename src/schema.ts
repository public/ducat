import { isCurrency } from './currency.js';
import { checkScale } from './decimal.js';
import { money, type Money, type MoneyJSON } from './money.js';
import { Rounding, type RoundingMode } from './rounding.js';

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
  /**
   * The most digits the amount may have, not counting the sign and the decimal point (default
   * 50). It keeps an oversized request body from building a huge bigint.
   */
  readonly maxDigits?: number;
}

/** The default `maxDigits`: far beyond any real amount, small enough to be cheap to reject. */
export const DEFAULT_MAX_DIGITS = 50;

const MODES = new Set<unknown>(Object.values(Rounding));

/**
 * @internal Checks the options when the schema is built, so a mistake there throws at once
 * instead of turning every input into a validation error.
 */
export function checkSchemaOptions(options: MoneySchemaOptions | undefined): void {
  if (options === undefined) {
    return;
  }
  const allowed = options.currency;
  const codes = typeof allowed === 'string' || allowed === undefined ? [allowed] : allowed;
  for (const code of codes) {
    if (code !== undefined && !isCurrency(code)) {
      throw new RangeError(`Unknown currency ${String(code)}`);
    }
  }
  const scale = options.scale;
  if (scale !== undefined) {
    checkScale(scale);
  }
  if (options.rounding !== undefined && !MODES.has(options.rounding)) {
    throw new RangeError(`Invalid rounding mode ${String(options.rounding)}`);
  }
  const maxDigits = options.maxDigits;
  if (maxDigits !== undefined && !(Number.isSafeInteger(maxDigits) && maxDigits >= 1)) {
    throw new RangeError(`Invalid maxDigits ${maxDigits}`);
  }
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

  const amount = json.amount;
  // Checked before the pattern, so a huge string is rejected without scanning it.
  const maxLength = (options?.maxDigits ?? DEFAULT_MAX_DIGITS) + 2;
  if (amount.length > maxLength || !DECIMAL.test(amount)) {
    return { field: 'amount', message: 'Expected a decimal string such as "12.34"' };
  }
  const digitCount = amount.length - (amount[0] === '-' ? 1 : 0) - (amount.includes('.') ? 1 : 0);
  if (digitCount > (options?.maxDigits ?? DEFAULT_MAX_DIGITS)) {
    return {
      field: 'amount',
      message: `More than ${options?.maxDigits ?? DEFAULT_MAX_DIGITS} digits`,
    };
  }

  try {
    return money(amount, currency, options);
  } catch (error) {
    // the options are checked up front, so this is too many decimals for the scale
    return { field: 'amount', message: (error as Error).message };
  }
}
