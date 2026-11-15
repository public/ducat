/**
 * `@ducatjs/money/drizzle/mysql`: Drizzle ORM column types for MySQL and MariaDB (mysql2,
 * PlanetScale). Selects return `Money`, inserts and updates accept it, and the currency is part of
 * the column's type.
 *
 *     import { mysqlTable } from 'drizzle-orm/mysql-core';
 *     import { moneyMinor } from '@ducatjs/money/drizzle/mysql';
 *
 *     const orders = mysqlTable('orders', { total: moneyMinor('EUR')('total_minor').notNull() });
 */
import { sql, type Column, type SQL } from 'drizzle-orm';
import { customType } from 'drizzle-orm/mysql-core';
import { currencyExponent } from '../currency.js';
import type { CurrencyInput, Money, MoneyJSON } from '../money.js';
import {
  checkDecimalSize,
  decimalFromDriver,
  decimalToDriver,
  DEFAULT_DECIMAL_SIZE,
  jsonFromDriver,
  jsonToDriver,
  minorFromDriver,
  minorToDriver,
  type ScaleColumnOption,
  type DecimalColumnSize,
} from '../sql.js';
import { scaledFromDriver, scaledMoneySql, type ScaledMoneyOf } from './scaled.js';

export { DEFAULT_DECIMAL_SIZE, type DecimalColumnSize, type ScaleColumnOption } from '../sql.js';

/**
 * A BIGINT column of minor units in a fixed currency (`1234` is 12.34 EUR), read back as
 * `Money<C>`. Exact up to the column's limit of ±9.2·10^18 minor units. mysql2 returns BIGINT as a
 * number by default, which is exact only below 2^53; beyond that it throws, so set
 * `supportBigNumbers: true` (with `bigNumberStrings: true`) on the connection for larger amounts.
 * Writing another currency, or a value at a scale other than the currency's, throws, unless the
 * column has a scale column: with `{ scale: 'totalScale' }` (the table key of an integer column),
 * the units are counted at each value's own scale, written beside them as `{ total, totalScale:
 * total.scale }`, and read back with `scaledMoney(table.total)`.
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
    dataType: () => 'bigint',
    toDriver: (money) => minorToDriver(money, currency, scaleOf(money)).toString(),
    fromDriver: (value) =>
      options === undefined
        ? minorFromDriver(value, currency)
        : scaledFromDriver(value, currency, options),
  });
}

/**
 * A DECIMAL(precision, scale) column, DECIMAL(19,4) by default, read back as `Money<C>`. The driver
 * must return DECIMAL as a string (mysql2's default; don't set `decimalNumbers`): a number has been
 * through a float and throws. Writing a value the column could not hold unchanged throws (outside
 * strict mode MySQL would clamp it), and so does a column scale below the currency's exponent.
 *
 *     price: moneyDecimal('EUR', { precision: 19, scale: 4 })('price').notNull()
 */
export function moneyDecimal<const C extends CurrencyInput>(
  currency: C,
  size: DecimalColumnSize = DEFAULT_DECIMAL_SIZE,
) {
  checkDecimalSize(currency, size);

  return customType<{ data: Money<C>; driverData: string }>({
    dataType: () => `decimal(${size.precision}, ${size.scale})`,
    toDriver: (money) => decimalToDriver(money, currency, size),
    fromDriver: (value) => decimalFromDriver(value, currency),
  });
}

/**
 * A JSON column holding `{"amount":"12.34","currency":"EUR"}`, with the currency in each value.
 * Pass a currency to fix it: then a value in another currency throws, on write and on read.
 *
 *     refund: moneyJson()('refund')
 */
export function moneyJson<const C extends CurrencyInput = CurrencyInput>(currency?: C) {
  return customType<{ data: Money<C>; driverData: string | MoneyJSON }>({
    dataType: () => 'json',
    toDriver: (money) => jsonToDriver(money, currency),
    // mysql2 parses JSON columns itself; other drivers may return the text
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
    (amount, scale) => sql`concat(${amount}, ':', coalesce(${scale}, ''))`,
  );
}
