/**
 * `currencyContext`: the helpers a single-currency app would otherwise write itself, bound to one
 * currency and locale. ducat has no global defaults on purpose; a context is a plain object, so
 * nothing global changes, two contexts never interfere, and tests stay isolated.
 *
 *     export const eur = currencyContext('EUR', { locale: 'nl-NL' });
 *     export type Eur = MoneyOf<typeof eur>; // Money<'EUR'>
 *
 *     eur.fromMinor(1234); // 12.34 EUR
 *     eur.format(eur.money('1234.5')); // '€ 1.234,50'
 *
 * Its functions are the plain ones (`money`, `fromMinor`, `zero`, `format`), so a `/fn` program
 * that uses a context installs no methods and carries only the currencies it imports. Parsing is
 * opt-in, because `parse` is about 1 kB: pass it (`currencyContext('EUR', { locale, parse })`)
 * and the context has `parse` too.
 */
import { currencyExponent } from './currency.js';
import { format } from './format.js';
import {
  assertCurrency,
  fromMinor,
  isMoneyIn,
  money,
  zero,
  type CurrencyInput,
  type Money,
  type MoneyOptions,
} from './money.js';
// types only: `parse` is passed in, so a context that doesn't parse doesn't carry it
import type { ParseOptions } from './parse.js';

/** `parse` from `@ducatjs/money/parse` (or `/fn`), for a context that reads text. */
export type ParseFunction = (
  input: string,
  currency: string,
  locale?: string,
  options?: ParseOptions,
) => Money;

/** Options for `currencyContext`. */
export interface CurrencyContextOptions {
  /**
   * The BCP 47 locale `format` and `parse` use (default: the runtime's, as `format(m)` without
   * one). An invalid tag throws a RangeError when the context is made.
   */
  readonly locale?: string;
  /**
   * `parse` from `@ducatjs/money/parse` (or `/fn`), to give the context a `parse` in its currency
   * and locale. It is passed in rather than imported, so a context that only formats doesn't
   * carry it.
   */
  readonly parse?: ParseFunction;
}

/** Functions bound to one currency (and locale), from `currencyContext`. */
export interface CurrencyContext<C extends string> {
  /** The currency every function here works in. */
  readonly currency: C;
  /** The locale `format` and `parse` use, or undefined for the runtime's. */
  readonly locale: string | undefined;
  /** `money(amount, currency, options)`: `eur.money('12.34')`. */
  money(amount: string | number | bigint, options?: MoneyOptions): Money<C>;
  /** `fromMinor(minor, currency, scale)`: `eur.fromMinor(1234)` is 12.34 EUR. */
  fromMinor(minor: number | bigint, scale?: number): Money<C>;
  /** `zero(currency, scale)`. */
  zero(scale?: number): Money<C>;
  /**
   * `format(money, locale, options)`, in the context's locale. Money in another currency throws a
   * CurrencyMismatchError.
   */
  format(money: Money<C>, options?: Intl.NumberFormatOptions): string;
  /** Whether `value` is Money in the context's currency, as `isMoneyIn`. */
  is(value: unknown): value is Money<C>;
}

/** A context made with `{ parse }`, which also reads text. */
export interface ParsingCurrencyContext<C extends string> extends CurrencyContext<C> {
  /** `parse(input, currency, locale, options)`: reads text formatted in the context's locale. */
  parse(input: string, options?: ParseOptions): Money<C>;
}

/** The Money type of a context: `MoneyOf<typeof eur>` is `Money<'EUR'>`. */
export type MoneyOf<T extends { readonly currency: string }> = Money<T['currency']>;

/**
 * Binds the plain functions to one currency and locale, for apps that work in one currency:
 * `currencyContext('EUR', { locale: 'nl-NL' })`. The result is a frozen plain object; nothing
 * global is set. The currency must be known when the context is made (with `/fn` alone, import
 * `@ducatjs/money/iso/<CODE>` first), and so must be a valid locale. Pass `parse` for a context
 * that also reads text: `currencyContext('EUR', { locale: 'nl-NL', parse })`.
 */
export function currencyContext<const C extends CurrencyInput>(
  currency: C,
  options: CurrencyContextOptions & { readonly parse: ParseFunction },
): ParsingCurrencyContext<C>;
export function currencyContext<const C extends CurrencyInput>(
  currency: C,
  options?: CurrencyContextOptions,
): CurrencyContext<C>;
export function currencyContext<const C extends CurrencyInput>(
  currency: C,
  options?: CurrencyContextOptions,
): CurrencyContext<C> | ParsingCurrencyContext<C> {
  // an unknown code or a malformed locale fails here, not at the first use
  currencyExponent(currency);
  const locale = options?.locale;
  if (locale !== undefined) {
    Intl.getCanonicalLocales(locale);
  }
  const parse = options?.parse;
  if (parse !== undefined && typeof parse !== 'function') {
    throw new TypeError('currencyContext: `parse` must be the parse function from /parse or /fn');
  }
  const context: CurrencyContext<C> = {
    currency,
    locale,
    money: (amount, moneyOptions) => money(amount, currency, moneyOptions),
    fromMinor: (minor, scale) => fromMinor(minor, currency, scale),
    zero: (scale) => zero(currency, scale),
    // a value in another currency is a bug the types catch; JavaScript callers get the same error
    format: (value, formatOptions) => {
      assertCurrency(value, currency);
      return format(value, locale, formatOptions);
    },
    is: (value): value is Money<C> => isMoneyIn(value, currency),
  };
  if (parse === undefined) {
    return Object.freeze(context);
  }
  return Object.freeze({
    ...context,
    parse: (input: string, parseOptions?: ParseOptions) =>
      parse(input, currency, locale, parseOptions) as Money<C>,
  });
}
