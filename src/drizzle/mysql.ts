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
import { customType } from 'drizzle-orm/mysql-core';
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
  type DecimalColumnSize,
} from '../sql.js';

export { DEFAULT_DECIMAL_SIZE, type DecimalColumnSize } from '../sql.js';

/**
 * A BIGINT column of minor units in a fixed currency (`1234` is 12.34 EUR), read back as
 * `Money<C>`. Exact up to the column's limit of ±9.2·10^18 minor units. mysql2 returns BIGINT as a
 * number by default, which is exact only below 2^53; beyond that it throws, so set
 * `supportBigNumbers: true` (with `bigNumberStrings: true`) on the connection for larger amounts.
 * Writing another currency, or a value at a scale other than the currency's, throws.
 *
 *     total: moneyMinor('EUR')('total_minor').notNull()
 */
export function moneyMinor<const C extends CurrencyInput>(currency: C) {
  return customType<{ data: Money<C>; driverData: string | number | bigint }>({
    dataType: () => 'bigint',
    toDriver: (money) => minorToDriver(money, currency).toString(),
    fromDriver: (value) => minorFromDriver(value, currency),
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
