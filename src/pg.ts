/**
 * `@ducatjs/money/pg`: node-postgres type parsers that keep NUMERIC and BIGINT exact, a Postgres
 * composite type for Money with a `sum` aggregate, and a guard for NUMERIC(p, s) columns.
 *
 *     import pg from 'pg';
 *     import { exactTypes } from '@ducatjs/money/pg';
 *
 *     const pool = new pg.Pool({ types: exactTypes(pg.types) });
 *
 * It imports nothing from pg at run time: pass `pg.types` in.
 */
import { currencyExponent } from './currency.js';
import { money as parseMoney, toDecimal, type CurrencyInput, type Money } from './money.js';
import { checkDecimalSize, type DecimalColumnSize } from './sql.js';

export { DEFAULT_DECIMAL_SIZE, type DecimalColumnSize } from './sql.js';

/** A text-format value parser, as node-postgres calls it. */
export type TypeParser = (text: string) => unknown;

/** The part of `pg.types` (or a client's `types` option) these parsers build on. */
export interface TypeParserSource {
  getTypeParser(oid: number, format?: 'text' | 'binary'): TypeParser;
}

/** The OIDs of a composite money type and its array type, from `moneyTypeOids`. */
export interface MoneyTypeOids {
  readonly oid: number;
  readonly arrayOid: number;
}

/** Options for `exactTypes`. */
export interface ExactTypesOptions {
  /** Also parse this composite money type (and its array) into Money. */
  readonly money?: MoneyTypeOids;
}

const INT8_OID = 20;
const NUMERIC_OID = 1700;
const INT8_ARRAY_OID = 1016;
const NUMERIC_ARRAY_OID = 1231;

const INTEGER_TEXT = /^-?\d+$/;
const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;

/**
 * BIGINT text as a bigint. node-postgres returns it as a string by default, which is exact but not
 * a number type the Money constructors accept.
 */
export function parseBigInt(text: string): bigint {
  if (!INTEGER_TEXT.test(text)) {
    throw new SyntaxError(`Expected BIGINT text, got "${text}"`);
  }
  return BigInt(text);
}

/**
 * NUMERIC text, checked and returned as the exact decimal string. Postgres NUMERIC can hold `NaN`
 * and `±Infinity`, which are not amounts, so they throw.
 */
export function parseNumeric(text: string): string {
  if (!NUMERIC_TEXT.test(text)) {
    throw new SyntaxError(`Expected a finite NUMERIC, got "${text}"`);
  }
  return text;
}

/**
 * Splits Postgres array text (`{1,2,NULL}`, `{{1,2},{3,4}}`, `{"(1.00,EUR)"}`) into nested arrays of
 * element text, with `null` for NULL. Quoted elements are unescaped.
 */
export function parseArray(text: string): unknown[] {
  let position = 0;

  // an array may start with explicit bounds, `[1:2]={...}`
  if (text.startsWith('[')) {
    position = text.indexOf('=') + 1;
  }

  function parseLevel(): unknown[] {
    if (text[position] !== '{') {
      throw new SyntaxError(`Malformed array text "${text}"`);
    }
    position++;
    const items: unknown[] = [];
    if (text[position] === '}') {
      position++;
      return items;
    }

    for (;;) {
      if (text[position] === '{') {
        items.push(parseLevel());
      } else if (text[position] === '"') {
        position++;
        let value = '';
        while (text[position] !== '"') {
          if (position >= text.length) {
            throw new SyntaxError(`Unterminated quote in array text "${text}"`);
          }
          if (text[position] === '\\') {
            position++;
          }
          value += text[position];
          position++;
        }
        position++;
        items.push(value);
      } else {
        const start = position;
        while (position < text.length && text[position] !== ',' && text[position] !== '}') {
          position++;
        }
        const value = text.slice(start, position);
        items.push(value === 'NULL' ? null : value);
      }

      if (text[position] === ',') {
        position++;
        continue;
      }
      if (text[position] === '}') {
        position++;
        return items;
      }
      throw new SyntaxError(`Malformed array text "${text}"`);
    }
  }

  const result = parseLevel();
  if (position !== text.length) {
    throw new SyntaxError(`Malformed array text "${text}"`);
  }
  return result;
}

function mapArray(items: unknown[], parseElement: (text: string) => unknown): unknown[] {
  return items.map((item) => {
    if (item === null) {
      return null;
    }
    if (Array.isArray(item)) {
      return mapArray(item, parseElement);
    }
    return parseElement(item as string);
  });
}

/**
 * Money from the text of the composite type, `(12.34,EUR)`. The amount keeps the scale it was
 * stored with, and never less than the currency's exponent.
 */
export function parseMoneyComposite(text: string): Money {
  const match = /^\((-?\d+(?:\.\d+)?)?,"?([^,"()]*)"?\)$/.exec(text);
  if (match === null) {
    throw new SyntaxError(`Expected (amount,currency) composite text, got "${text}"`);
  }
  const [, amount, currency] = match;
  if (amount === undefined || currency === '') {
    throw new TypeError(`A money composite needs both an amount and a currency, got "${text}"`);
  }

  const fractionDigits = amount.includes('.') ? amount.length - amount.indexOf('.') - 1 : 0;
  const scale = Math.max(fractionDigits, currencyExponent(currency!));
  return parseMoney(amount, currency!, { scale });
}

/**
 * The composite type's text for a query parameter: `(12.34,EUR)`, at the Money's own scale. Cast it
 * in SQL (`$1::ducat_money`) where Postgres can't infer the type.
 */
export function toMoneyComposite(money: Money): string {
  return `(${toDecimal(money)},${money.currency})`;
}

/**
 * Type parsers for node-postgres that never turn an amount into a float: BIGINT as bigint, NUMERIC
 * as an exact string (rejecting `NaN` and `Infinity`), their arrays the same way (pg's default
 * parses NUMERIC arrays as floats), and optionally the composite money type as Money. Every other
 * type uses `base`.
 *
 *     new pg.Pool({ types: exactTypes(pg.types, { money: await moneyTypeOids(client) }) })
 */
export function exactTypes(base: TypeParserSource, options?: ExactTypesOptions): TypeParserSource {
  const moneyOids = options?.money;

  return {
    getTypeParser(oid: number, format?: 'text' | 'binary'): TypeParser {
      // the binary format is only used when a query asks for it; leave it to pg
      if (format === 'binary') {
        return base.getTypeParser(oid, format);
      }
      if (oid === INT8_OID) {
        return parseBigInt;
      }
      if (oid === NUMERIC_OID) {
        return parseNumeric;
      }
      if (oid === INT8_ARRAY_OID) {
        return (text) => mapArray(parseArray(text), parseBigInt);
      }
      if (oid === NUMERIC_ARRAY_OID) {
        return (text) => mapArray(parseArray(text), parseNumeric);
      }
      if (moneyOids !== undefined && oid === moneyOids.oid) {
        return parseMoneyComposite;
      }
      if (moneyOids !== undefined && oid === moneyOids.arrayOid) {
        return (text) => mapArray(parseArray(text), parseMoneyComposite);
      }
      return base.getTypeParser(oid, format);
    },
  };
}

/** The default name of the composite money type. */
export const MONEY_TYPE_NAME = 'ducat_money';

const IDENTIFIER = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;

/**
 * The DDL for a composite money type, `(amount numeric, currency text)`, and a `sum` aggregate over
 * it that throws on mixed currencies. The amount is an unconstrained NUMERIC, so it keeps every
 * digit and its scale. Run the statements once, in order, e.g. in a migration.
 *
 *     for (const statement of moneyTypeSql()) await client.query(statement);
 *     SELECT sum(price) FROM items;   -- (37.50,EUR)
 */
export function moneyTypeSql(name: string = MONEY_TYPE_NAME): string[] {
  if (!IDENTIFIER.test(name)) {
    throw new RangeError(`"${name}" is not a plain lower-case SQL name (optionally schema.name)`);
  }
  const add = `${name}_add`;

  return [
    `CREATE TYPE ${name} AS (amount numeric, currency text)`,
    `CREATE FUNCTION ${add}(total ${name}, item ${name}) RETURNS ${name}
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF item IS NULL THEN
    RETURN total;
  END IF;
  IF total IS NULL THEN
    RETURN item;
  END IF;
  IF total.currency IS DISTINCT FROM item.currency THEN
    RAISE EXCEPTION 'cannot add % and % amounts', total.currency, item.currency
      USING ERRCODE = 'data_exception';
  END IF;
  RETURN ROW(total.amount + item.amount, total.currency)::${name};
END
$$`,
    `CREATE AGGREGATE sum(${name}) (SFUNC = ${add}, STYPE = ${name}, COMBINEFUNC = ${add}, PARALLEL = SAFE)`,
  ];
}

/** The part of a pg Client or Pool that `moneyTypeOids` uses. */
export interface Queryable {
  query(
    sql: string,
    values: unknown[],
  ): Promise<{ rows: { oid: number | string; typarray: number | string }[] }>;
}

/**
 * Looks up the OIDs of the composite money type, for `exactTypes`. Run it once at start-up on a
 * client without the money parser; OIDs differ between databases.
 */
export async function moneyTypeOids(
  client: Queryable,
  name: string = MONEY_TYPE_NAME,
): Promise<MoneyTypeOids> {
  const result = await client.query(
    'SELECT oid, typarray FROM pg_type WHERE oid = to_regtype($1)',
    [name],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new RangeError(`No type "${name}" in this database; run moneyTypeSql() first`);
  }
  return { oid: Number(row.oid), arrayOid: Number(row.typarray) };
}

/**
 * The exact decimal string for a NUMERIC(precision, scale) column, or a throw if Postgres would
 * change it: it rounds extra decimals silently on insert, and rejects too many integer digits.
 * Unlike the column types, any scale up to the column's is accepted, and trailing zeros beyond it
 * are dropped since they don't change the value.
 */
export function toNumeric<C extends CurrencyInput>(
  money: Money<C>,
  size: DecimalColumnSize,
): string {
  checkDecimalSize(money.currency, size);
  const decimal = toDecimal(money);
  const [integerPart, fraction = ''] = decimal.replace('-', '').split('.');

  const significantFraction = fraction.replace(/0+$/, '');
  if (significantFraction.length > size.scale) {
    throw new RangeError(
      `${money} has ${significantFraction.length} decimals; NUMERIC(${size.precision},${size.scale}) ` +
        `would round it to ${size.scale}`,
    );
  }

  // "0.12" has no integer digits: NUMERIC(4,4) holds it
  const integerDigits = integerPart === '0' ? 0 : integerPart!.length;
  if (integerDigits > size.precision - size.scale) {
    throw new RangeError(
      `${money} does not fit NUMERIC(${size.precision},${size.scale}), which holds ` +
        `${size.precision - size.scale} integer digits`,
    );
  }

  if (fraction.length <= size.scale) {
    return decimal;
  }
  const sign = decimal.startsWith('-') ? '-' : '';
  const kept = fraction.slice(0, size.scale);
  return kept === '' ? `${sign}${integerPart}` : `${sign}${integerPart}.${kept}`;
}
