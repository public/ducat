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
} from '../sql.js';

/**
 * An INTEGER column of minor units in a fixed currency (`1234` is 12.34 EUR), read back as
 * `Money<C>`. Exact up to SQLite's limit of ±9.2·10^18 minor units. better-sqlite3 returns integers
 * as numbers by default, which are exact only below 2^53; beyond that reading throws, so call
 * `defaultSafeIntegers(true)` on the database for larger amounts. Writing another currency, or a
 * value at a scale other than the currency's, throws.
 *
 *     total: moneyMinor('EUR')('total_minor').notNull()
 */
export function moneyMinor<const C extends CurrencyInput>(currency: C) {
  return customType<{ data: Money<C>; driverData: number | bigint }>({
    dataType: () => 'integer',
    toDriver: (money) => minorToDriver(money, currency),
    fromDriver: (value) => minorFromDriver(value, currency),
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
