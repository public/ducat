/**
 * `@ducatjs/money/drizzle/sqlite`: Drizzle ORM column types for SQLite (better-sqlite3, libSQL,
 * Bun). Selects return `Money`, inserts and updates accept it, and the currency is part of the
 * column's type.
 *
 *     import { sqliteTable } from 'drizzle-orm/sqlite-core';
 *     import { moneyMinor } from '@ducatjs/money/drizzle/sqlite';
 *
 *     const orders = sqliteTable('orders', { total: moneyMinor('EUR')('total_minor').notNull() });
 */
import { sql, type Column, type SQL } from 'drizzle-orm';
import { customType } from 'drizzle-orm/sqlite-core';
import { currencyExponent } from '../currency.js';
import type { CurrencyInput, Money } from '../money.js';
import {
  decimalFromDriver,
  decimalToDriver,
  jsonFromDriver,
  jsonToDriver,
  minorFromDriver,
  minorToDriver,
  type ScaleColumnOption,
} from '../sql.js';
import { scaledFromDriver, scaledMoneySql, type ScaledMoneyOf } from './scaled.js';

export type { ScaleColumnOption } from '../sql.js';

/**
 * An INTEGER column of minor units in a fixed currency (`1234` is 12.34 EUR), read back as
 * `Money<C>`. Exact up to SQLite's limit of ±9.2·10^18 minor units. better-sqlite3 returns integers
 * as numbers by default, which are exact only below 2^53; beyond that reading throws, so call
 * `defaultSafeIntegers(true)` on the database for larger amounts. Writing another currency, or a
 * value at a scale other than the currency's, throws, unless the column has a scale column: with `{
 * scale: 'totalScale' }` (the table key of an integer column), the units are counted at each
 * value's own scale, written beside them as `{ total, totalScale: total.scale }`, and read back
 * with `scaledMoney(table.total)`.
 *
 *     total: moneyMinor('EUR')('total_minor').notNull()
 */
export function moneyMinor<const C extends CurrencyInput>(
  currency: C,
  options?: ScaleColumnOption<string>,
) {
  if (options !== undefined) {
    // an unknown code fails here, where the column is declared, not on the first query
    currencyExponent(currency);
  }
  // with a scale column, the units are counted at each value's own scale, which that column
  // records, and they are read from the "<units>:<scale>" text that scaledMoney selects
  const scaleOf = options === undefined ? () => undefined : (money: Money) => money.scale;

  return customType<{ data: Money<C>; driverData: string | number | bigint }>({
    dataType: () => 'integer',
    toDriver: (money) => minorToDriver(money, currency, scaleOf(money)),
    fromDriver: (value) =>
      options === undefined
        ? minorFromDriver(value, currency)
        : scaledFromDriver(value, currency, options),
  });
}

/**
 * A TEXT column holding the exact decimal string (`12.34`), read back as `Money<C>`. SQLite's
 * NUMERIC affinity would store some decimals as REAL and lose digits, so they are kept as text.
 * Writing another currency, or a value at a scale other than the currency's, throws.
 *
 *     price: moneyDecimal('EUR')('price').notNull()
 */
export function moneyDecimal<const C extends CurrencyInput>(currency: C) {
  // fail at the schema definition, not on the first query, for an unknown currency
  currencyExponent(currency);

  return customType<{ data: Money<C>; driverData: string }>({
    dataType: () => 'text',
    toDriver: (money) => decimalToDriver(money, currency, undefined),
    fromDriver: (value) => decimalFromDriver(value, currency),
  });
}

/**
 * A TEXT column holding `{"amount":"12.34","currency":"EUR"}`, with the currency in each value.
 * Pass a currency to fix it: then a value in another currency throws, on write and on read.
 *
 *     refund: moneyJson()('refund')
 */
export function moneyJson<const C extends CurrencyInput = CurrencyInput>(currency?: C) {
  return customType<{ data: Money<C>; driverData: string }>({
    dataType: () => 'text',
    toDriver: (money) => jsonToDriver(money, currency),
    fromDriver: (value) => jsonFromDriver(value, currency),
  });
}

/**
 * Reads a `moneyMinor` column that has a scale column, with its scale, as the column's Money (or
 * null for a NULL amount): `select({ total: scaledMoney(orders.total) })`. Such a column can't be
 * selected by itself, because it doesn't know its scale. A NULL scale throws on read.
 */
export function scaledMoney<T extends Column>(column: T): SQL<ScaledMoneyOf<T>> {
  return scaledMoneySql(
    column,
    (amount, scale) => sql`cast(${amount} as text) || ':' || coalesce(cast(${scale} as text), '')`,
  );
}
