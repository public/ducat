/**
 * `@ducatjs/money/typeorm`: TypeORM column transformers for Money, exact in both directions. Each
 * is a `ValueTransformer` for a column's `transformer` option, and it never imports TypeORM:
 *
 *     import { minorTransformer } from '@ducatjs/money/typeorm';
 *
 *     @Column({ type: 'bigint', transformer: minorTransformer('EUR') })
 *     total!: Money<'EUR'>;
 *
 * `null` and `undefined` pass through both ways, for nullable columns. TypeORM also runs `to` on
 * the values of find operators (`MoreThan(fee)`, `In([...])`), so `where` clauses take Money.
 * `fromRawMinor` and `fromRawDecimal` read what raw queries return (`SUM()` and the like), which
 * no transformer sees.
 */
import { checkScale } from './decimal.js';
import { currencyExponent } from './currency.js';
import type { CurrencyInput, Money, MoneyJSON } from './money.js';
import {
  checkCurrency,
  checkDecimalSize,
  checkIsoScale,
  decimalFromDriver,
  decimalToDriver,
  jsonFromDriver,
  minorFromDriver,
  minorToDriver,
  type DecimalColumnSize,
} from './sql.js';

export { DEFAULT_DECIMAL_SIZE, type DecimalColumnSize } from './sql.js';

/**
 * A TypeORM `ValueTransformer` between `Money<C>` and what the driver sends and receives (`D`).
 * `to` takes the entity's value (`null` and `undefined` pass through), `from` the driver's.
 */
export interface MoneyTransformer<C extends string, D> {
  to(value: Money<C> | null | undefined): D | null | undefined;
  from(value: unknown): Money<C> | null;
}

/** Options for `minorTransformer`. */
export interface MinorTransformerOptions {
  /**
   * The scale the column's integers count in (default: the currency's ISO exponent). A column of
   * ten-thousandths of a euro is `{ scale: 4 }`: `12340` is 1.2340 EUR. Money at another scale
   * throws on write: `round()` it first.
   */
  readonly scale?: number;
}

/**
 * A BIGINT column of minor units in a fixed currency (`1234` is 12.34 EUR), exact up to the
 * column's ±9.2·10^18. It writes an integer string, which node-postgres, mysql2 and SQLite all bind
 * exactly, and reads a string, bigint or safe-integer number. TypeORM's MySQL driver returns BIGINT
 * as a string by default; better-sqlite3 returns a number, which throws beyond 2^53 - 1 rather than
 * lose digits (call `db.defaultSafeIntegers(true)` in `prepareDatabase` for bigints). Money in
 * another currency or at another scale throws on write.
 *
 *     @Column({ type: 'bigint', transformer: minorTransformer('EUR') })
 */
export function minorTransformer<const C extends CurrencyInput>(
  currency: C,
  options?: MinorTransformerOptions,
): MoneyTransformer<C, string> {
  // an unknown code or a bad scale fails here, where the column is declared
  currencyExponent(currency);
  const scale = options?.scale === undefined ? undefined : checkScale(options.scale);
  return {
    to: (value) => (value == null ? value : minorToDriver(value, currency, scale).toString()),
    from: (value) => (value == null ? null : minorFromDriver(value, currency, scale)),
  };
}

/**
 * A NUMERIC/DECIMAL column (TEXT in SQLite) holding the exact decimal as a string. node-postgres
 * and mysql2 return decimals as strings; a number has been through a float and throws. Trailing
 * zeros (`12.3400` from NUMERIC(19,4)) are fine, and more decimals than the currency has throw.
 * Pass the column's size to refuse, on write, a value it would round or clamp (MySQL outside
 * strict mode clamps instead of failing).
 *
 *     @Column({ type: 'numeric', precision: 19, scale: 4, transformer: decimalTransformer('EUR') })
 */
export function decimalTransformer<const C extends CurrencyInput>(
  currency: C,
  size?: DecimalColumnSize,
): MoneyTransformer<C, string> {
  if (size === undefined) {
    currencyExponent(currency);
  } else {
    checkDecimalSize(currency, size);
  }
  return {
    to: (value) => (value == null ? value : decimalToDriver(value, currency, size)),
    from: (value) => (value == null ? null : decimalFromDriver(value, currency)),
  };
}

/**
 * A `json` or `jsonb` column (`simple-json` in SQLite) holding `{"amount":"12.34","currency":
 * "EUR"}`, with the currency in each value. TypeORM serialises those column types itself, so `to`
 * returns the object, not its text. Money at a scale other than its currency's throws on write:
 * `round()` it first. Pass a currency to fix it: then another currency throws, on write and on
 * read.
 *
 *     @Column({ type: 'jsonb', nullable: true, transformer: jsonTransformer() })
 */
export function jsonTransformer<const C extends CurrencyInput = CurrencyInput>(
  currency?: C,
): MoneyTransformer<C, MoneyJSON<C>> {
  if (currency !== undefined) {
    currencyExponent(currency);
  }
  return {
    to: (value) => {
      if (value == null) {
        return value;
      }
      checkCurrency(value, currency);
      checkIsoScale(value);
      return value.toJSON();
    },
    from: (value) => (value == null ? null : jsonFromDriver(value, currency)),
  };
}

function checkRaw(value: unknown, what: string): void {
  if (value == null) {
    throw new TypeError(
      `Expected ${what} from a raw query, got ${value}; ` +
        'an aggregate over no rows is NULL, so COALESCE(SUM(...), 0) it',
    );
  }
}

/**
 * Money from an integer a raw query returns, such as `SUM(total_minor)`: Postgres returns NUMERIC
 * text, MySQL DECIMAL text, SQLite a number (or a bigint). A number beyond 2^53 - 1 has already
 * lost digits and throws, as does a non-integer (`AVG()`); so does NULL, which `SUM()` returns for
 * no rows.
 *
 *     const { total } = await orders
 *       .createQueryBuilder('o')
 *       .select('SUM(o.total_minor)', 'total')
 *       .getRawOne();
 *     fromRawMinor(total, 'EUR');
 */
export function fromRawMinor<const C extends CurrencyInput>(
  value: unknown,
  currency: C,
  options?: MinorTransformerOptions,
): Money<C> {
  checkRaw(value, 'an integer');
  const scale = options?.scale === undefined ? undefined : checkScale(options.scale);
  return minorFromDriver(value, currency, scale);
}

/**
 * Money from a decimal a raw query returns, such as `SUM(price)` over a NUMERIC column: it must be
 * a string, as Postgres and MySQL return it, with no more decimals than the currency has (trailing
 * zeros are fine). SQLite sums TEXT decimals as floats, so there the number throws: sum minor units
 * instead. NULL throws too.
 */
export function fromRawDecimal<const C extends CurrencyInput>(
  value: unknown,
  currency: C,
): Money<C> {
  checkRaw(value, 'a decimal');
  return decimalFromDriver(value, currency);
}
