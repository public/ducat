/**
 * `@ducatjs/money/kysely`: Money in Kysely queries, without the plugin having to understand query
 * shapes. A money value is selected as a self-describing JSON object built in SQL (marked, with the
 * amount as exact text and the currency), and `MoneyResultPlugin` turns exactly those objects into
 * Money, wherever they appear: unions, CTEs, subqueries, nested JSON, every `stream()` chunk, and
 * under `CamelCasePlugin`. A raw column is never typed as Money.
 *
 *     const money = moneyHelpers('postgres');
 *     const db = new Kysely<Database>({ dialect, plugins: [new MoneyResultPlugin()] });
 *
 *     await db.insertInto('payments').values({ id: 1, ...setMoney(fee, 'amount_minor', 'currency') });
 *     await db
 *       .selectFrom('payments')
 *       .select((eb) => money.selectMoney(eb, 'amount_minor', 'currency').as('fee'))
 *       .where((eb) => money.compareMoney(eb, 'amount_minor', 'currency', '>=', fee))
 *       .execute();
 */
import {
  sql,
  type ColumnType,
  type Expression,
  type ExpressionBuilder,
  type ExtractTypeFromReferenceExpression,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RawBuilder,
  type ReferenceExpression,
  type RootOperationNode,
  type SqlBool,
  type UnknownRow,
} from 'kysely';
import { currencyExponent } from './currency.js';
import { CurrencyMismatchError, type CurrencyInput, type Money } from './money.js';
import {
  checkCurrency,
  checkDecimalSize,
  checkIsoScale,
  decimalFromDriver,
  DEFAULT_DECIMAL_SIZE,
  type DecimalColumnSize,
  decimalToDriver,
  minorFromDriver,
  minorToDriver,
} from './sql.js';

export { DEFAULT_DECIMAL_SIZE, type DecimalColumnSize } from './sql.js';

/** The SQL dialects the helpers can build JSON objects and exact casts for. */
export type MoneyDialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * A BIGINT (SQLite INTEGER) column of minor units. Drivers return it as a string, a number or a
 * bigint; `setMoney` writes integer strings, which every driver binds exactly.
 */
export type MinorUnitsColumn = ColumnType<
  string | number | bigint,
  string | bigint,
  string | bigint
>;

/** A NUMERIC/DECIMAL (SQLite TEXT) column holding the exact decimal as a string. */
export type DecimalAmountColumn = ColumnType<string, string, string>;

/** A currency that is fixed for a column instead of stored in another column: `fixed('EUR')`. */
export interface FixedCurrency<C extends string> {
  readonly fixed: C;
}

/** Marks a column's currency as fixed: `selectMoney(eb, 'total_minor', fixed('EUR'))`. */
export function fixed<const C extends CurrencyInput>(currency: C): FixedCurrency<C> {
  // an unknown code fails here, where the column is described, not on the first query
  currencyExponent(currency);
  return { fixed: currency };
}

function isFixed(currency: unknown): currency is FixedCurrency<string> {
  return typeof currency === 'object' && currency !== null && 'fixed' in currency;
}

/** The comparison operators `compareMoney` supports. */
export type MoneyComparison = '=' | '<>' | '<' | '<=' | '>' | '>=';

const COMPARISONS: ReadonlySet<string> = new Set(['=', '<>', '<', '<=', '>', '>=']);

// The marker key of the JSON objects the helpers build. Its value carries a random nonce chosen
// when this module loads, so data that merely looks like a marker (a user's JSON column, a text
// value) is never read as money: forging one needs the nonce, which only appears in query text.
const MARKER = '$ducat';
const NONCE = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
  byte.toString(16).padStart(2, '0'),
).join('');
const MINOR_MARKER = `${NONCE}:minor`;
const DECIMAL_MARKER = `${NONCE}:decimal`;
// nested JSON deeper than this is left as it is, so a hostile document can't exhaust the stack
const MAX_DEPTH = 64;

type Storage = 'minor' | 'decimal';

function markerFor(storage: Storage): string {
  return storage === 'minor' ? MINOR_MARKER : DECIMAL_MARKER;
}

/** `Money<C>`, or `Money<C> | null` when the amount column is nullable. */
type MoneyFor<Amount, C extends string> = null extends Amount ? Money<C> | null : Money<C>;

// ---------------------------------------------------------------------------------------------
// Writes: plain column values, so inserts, updates and upserts need no query rewriting
// ---------------------------------------------------------------------------------------------

/**
 * Column values for an insert or update: the minor units as an integer string, and the currency
 * (unless it is fixed for the column, in which case the Money must be in it).
 *
 *     .values({ id: 1, ...setMoney(fee, 'amount_minor', 'currency') })
 *     .set(setMoney(total, 'total_minor', fixed('EUR')))
 */
export function setMoney<const A extends string, const K extends string>(
  money: Money,
  amount: A,
  currency: K,
): { [P in A | K]: string };
export function setMoney<const A extends string, const C extends string>(
  money: Money<NoInfer<C>>,
  amount: A,
  currency: FixedCurrency<C>,
): { [P in A]: string };
export function setMoney(
  money: Money,
  amount: string,
  currency: string | FixedCurrency<string>,
): Record<string, string> {
  if (isFixed(currency)) {
    return { [amount]: minorToDriver(money, currency.fixed).toString() };
  }
  return { [amount]: minorToDriver(money, undefined).toString(), [currency]: money.currency };
}

/**
 * Like `setMoney`, for a NUMERIC/DECIMAL amount column: the exact decimal. Pass the column's size
 * (NUMERIC(19,4) by default) so that a value it would round or clamp throws instead. On SQLite,
 * where decimals are TEXT, the size only limits what is written.
 */
export function setDecimalMoney<const A extends string, const K extends string>(
  money: Money,
  amount: A,
  currency: K,
  size?: DecimalColumnSize,
): { [P in A | K]: string };
export function setDecimalMoney<const A extends string, const C extends string>(
  money: Money<NoInfer<C>>,
  amount: A,
  currency: FixedCurrency<C>,
  size?: DecimalColumnSize,
): { [P in A]: string };
export function setDecimalMoney(
  money: Money,
  amount: string,
  currency: string | FixedCurrency<string>,
  size: DecimalColumnSize = DEFAULT_DECIMAL_SIZE,
): Record<string, string> {
  const decimal = decimalForColumn(money, isFixed(currency) ? currency.fixed : undefined, size);
  if (isFixed(currency)) {
    return { [amount]: decimal };
  }
  return { [amount]: decimal, [currency]: money.currency };
}

/**
 * The decimal for a NUMERIC(p, s) column, or a throw if the column would round or clamp it: its
 * scale must hold the currency's exponent, and the value must fit its integer digits.
 */
function decimalForColumn(
  money: Money,
  currency: string | undefined,
  size: DecimalColumnSize,
): string {
  checkDecimalSize(money.currency, size);
  return decimalToDriver(money, currency, size);
}

// ---------------------------------------------------------------------------------------------
// Reads, filters and sums: SQL expressions built per dialect
// ---------------------------------------------------------------------------------------------

/** How each dialect builds the JSON object and casts values exactly. */
interface DialectSql {
  jsonObject(fields: readonly [string, Expression<unknown>][]): RawBuilder<unknown>;
  asText(expression: Expression<unknown>): RawBuilder<string>;
  minorParameter(minor: bigint): Expression<unknown>;
  decimalParameter(decimal: string): Expression<unknown>;
  /** Whether decimals compare and add as numbers (not in SQLite, where they are TEXT). */
  readonly hasNumericDecimals: boolean;
}

function jsonObjectWith(functionName: string) {
  return (fields: readonly [string, Expression<unknown>][]): RawBuilder<unknown> => {
    const parts = fields.map(([key, value]) => sql`${sql.lit(key)}, ${value}`);
    return sql`${sql.raw(functionName)}(${sql.join(parts)})`;
  };
}

// MySQL compares a DECIMAL with a string as doubles, so parameters are cast to its widest DECIMAL
const MYSQL_DECIMAL_INTEGER_DIGITS = 35;
const MYSQL_DECIMAL_SCALE = 30;

const DIALECTS: Record<MoneyDialect, DialectSql> = {
  postgres: {
    // jsonb, which has equality, so UNION, DISTINCT and GROUP BY work on money values
    jsonObject: jsonObjectWith('jsonb_build_object'),
    asText: (expression) => sql<string>`cast(${expression} as text)`,
    minorParameter: (minor) => sql`cast(${minor.toString()} as bigint)`,
    decimalParameter: (decimal) => sql`cast(${decimal} as numeric)`,
    hasNumericDecimals: true,
  },
  mysql: {
    jsonObject: jsonObjectWith('json_object'),
    asText: (expression) => sql<string>`cast(${expression} as char)`,
    // a string compared with a BIGINT is compared as a double, which loses digits beyond 2^53
    minorParameter: (minor) => sql`cast(${minor.toString()} as signed)`,
    decimalParameter: (decimal) => {
      const [integerPart, fraction = ''] = decimal.replace('-', '').split('.');
      const fits =
        integerPart!.length <= MYSQL_DECIMAL_INTEGER_DIGITS &&
        fraction.length <= MYSQL_DECIMAL_SCALE;
      if (!fits) {
        throw new RangeError(`${decimal} is beyond MySQL's widest DECIMAL(65,30)`);
      }
      return sql`cast(${decimal} as decimal(65, 30))`;
    },
    hasNumericDecimals: true,
  },
  sqlite: {
    jsonObject: jsonObjectWith('json_object'),
    asText: (expression) => sql<string>`cast(${expression} as text)`,
    // a bound bigint is an INTEGER, which compares as a number even against a column without
    // affinity (a CTE or subquery column), where a string would compare as text
    minorParameter: (minor) => sql`${minor}`,
    decimalParameter: (decimal) => sql`${decimal}`,
    hasNumericDecimals: false,
  },
};

/** The money helpers for one dialect, from `moneyHelpers`. */
export interface MoneyHelpers {
  /**
   * The Money in an amount column of minor units, with the currency from a column or `fixed()`.
   * Typed `Money<C>`, or `Money<C> | null` for a nullable amount column; needs `MoneyResultPlugin`.
   *
   *     .select((eb) => money.selectMoney(eb, 'p.amount_minor', 'p.currency').as('paid'))
   */
  selectMoney<DB, TB extends keyof DB, RA extends ReferenceExpression<DB, TB>>(
    eb: ExpressionBuilder<DB, TB>,
    amount: RA,
    currency: ReferenceExpression<DB, TB>,
  ): RawBuilder<MoneyFor<ExtractTypeFromReferenceExpression<DB, TB, RA>, CurrencyInput>>;
  selectMoney<DB, TB extends keyof DB, RA extends ReferenceExpression<DB, TB>, C extends string>(
    eb: ExpressionBuilder<DB, TB>,
    amount: RA,
    currency: FixedCurrency<C>,
  ): RawBuilder<MoneyFor<ExtractTypeFromReferenceExpression<DB, TB, RA>, C>>;

  /** Like `selectMoney`, for a NUMERIC/DECIMAL (SQLite TEXT) amount column. */
  selectDecimalMoney<DB, TB extends keyof DB, RA extends ReferenceExpression<DB, TB>>(
    eb: ExpressionBuilder<DB, TB>,
    amount: RA,
    currency: ReferenceExpression<DB, TB>,
  ): RawBuilder<MoneyFor<ExtractTypeFromReferenceExpression<DB, TB, RA>, CurrencyInput>>;
  selectDecimalMoney<
    DB,
    TB extends keyof DB,
    RA extends ReferenceExpression<DB, TB>,
    C extends string,
  >(
    eb: ExpressionBuilder<DB, TB>,
    amount: RA,
    currency: FixedCurrency<C>,
  ): RawBuilder<MoneyFor<ExtractTypeFromReferenceExpression<DB, TB, RA>, C>>;

  /**
   * A condition comparing a stored amount with Money, currency and amount together. With a
   * currency column, `=` and the ordering comparisons also require the same currency, and `<>`
   * holds when either differs. With `fixed()`, Money in another currency throws.
   *
   *     .where((eb) => money.compareMoney(eb, 'amount_minor', 'currency', '>=', limit))
   */
  compareMoney<DB, TB extends keyof DB>(
    eb: ExpressionBuilder<DB, TB>,
    amount: ReferenceExpression<DB, TB>,
    currency: ReferenceExpression<DB, TB> | FixedCurrency<string>,
    operator: MoneyComparison,
    money: Money,
  ): Expression<SqlBool>;

  /**
   * Like `compareMoney`, for a NUMERIC/DECIMAL amount column of the given size (NUMERIC(19,4) by
   * default). SQLite allows only `=` and `<>`, which compare the text, so they match only values
   * written with `setDecimalMoney`.
   */
  compareDecimalMoney<DB, TB extends keyof DB>(
    eb: ExpressionBuilder<DB, TB>,
    amount: ReferenceExpression<DB, TB>,
    currency: ReferenceExpression<DB, TB> | FixedCurrency<string>,
    operator: MoneyComparison,
    money: Money,
    size?: DecimalColumnSize,
  ): Expression<SqlBool>;

  /**
   * The sum of an amount column as Money, or null over no rows. With a currency column, rows in
   * more than one currency (or an amount without a currency) make the result throw when read, so
   * group by the currency column to sum per currency.
   *
   *     .select((eb) => [money.sumMoney(eb, 'amount_minor', 'currency').as('total'), 'currency'])
   *     .groupBy('currency')
   */
  sumMoney<DB, TB extends keyof DB>(
    eb: ExpressionBuilder<DB, TB>,
    amount: ReferenceExpression<DB, TB>,
    currency: ReferenceExpression<DB, TB>,
  ): RawBuilder<Money | null>;
  sumMoney<DB, TB extends keyof DB, C extends string>(
    eb: ExpressionBuilder<DB, TB>,
    amount: ReferenceExpression<DB, TB>,
    currency: FixedCurrency<C>,
  ): RawBuilder<Money<C> | null>;

  /** Like `sumMoney`, for a NUMERIC/DECIMAL amount column. Not available on SQLite (TEXT). */
  sumDecimalMoney<DB, TB extends keyof DB>(
    eb: ExpressionBuilder<DB, TB>,
    amount: ReferenceExpression<DB, TB>,
    currency: ReferenceExpression<DB, TB>,
  ): RawBuilder<Money | null>;
  sumDecimalMoney<DB, TB extends keyof DB, C extends string>(
    eb: ExpressionBuilder<DB, TB>,
    amount: ReferenceExpression<DB, TB>,
    currency: FixedCurrency<C>,
  ): RawBuilder<Money<C> | null>;
}

// oxlint-disable-next-line typescript/no-explicit-any -- the helpers work for any database type
type AnyBuilder = ExpressionBuilder<any, any>;
// oxlint-disable-next-line typescript/no-explicit-any
type AnyReference = ReferenceExpression<any, any>;
type AnyCurrency = AnyReference | FixedCurrency<string>;

/** The read, filter and sum helpers for one SQL dialect. */
export function moneyHelpers(dialect: MoneyDialect): MoneyHelpers {
  const dialectSql = DIALECTS[dialect];
  if (dialectSql === undefined) {
    throw new RangeError(`Unknown dialect "${String(dialect)}"; use postgres, mysql or sqlite`);
  }

  function currencyExpression(eb: AnyBuilder, currency: AnyCurrency): Expression<unknown> {
    if (isFixed(currency)) {
      return sql.lit(currency.fixed);
    }
    return eb.ref(currency as string);
  }

  function select(
    storage: Storage,
    eb: AnyBuilder,
    amount: AnyReference,
    currency: AnyCurrency,
  ): RawBuilder<unknown> {
    const amountRef = eb.ref(amount as string);
    const object = dialectSql.jsonObject([
      [MARKER, sql.lit(markerFor(storage))],
      ['amount', dialectSql.asText(amountRef)],
      ['currency', currencyExpression(eb, currency)],
    ]);
    // a NULL amount stays NULL rather than becoming a marker without an amount
    return sql`case when ${amountRef} is null then null else ${object} end`;
  }

  function compare(
    storage: Storage,
    eb: AnyBuilder,
    amount: AnyReference,
    currency: AnyCurrency,
    operator: MoneyComparison,
    money: Money,
    size: DecimalColumnSize = DEFAULT_DECIMAL_SIZE,
  ): Expression<SqlBool> {
    if (!COMPARISONS.has(operator)) {
      throw new RangeError(`Unsupported comparison "${operator}"`);
    }
    const isEquality = operator === '=' || operator === '<>';
    if (storage === 'decimal' && !dialectSql.hasNumericDecimals && !isEquality) {
      throw new RangeError(
        'SQLite stores decimals as TEXT, which orders as text; compare minor units instead',
      );
    }
    if (isFixed(currency)) {
      checkCurrency(money, currency.fixed);
    }

    let value: Expression<unknown>;
    if (storage === 'minor') {
      value = dialectSql.minorParameter(minorToDriver(money, undefined));
    } else {
      value = dialectSql.decimalParameter(decimalForColumn(money, undefined, size));
    }
    const amountCondition = eb(eb.ref(amount as string), operator, value);

    if (isFixed(currency)) {
      return amountCondition;
    }
    const currencyRef = eb.ref(currency as string);
    if (operator === '<>') {
      return eb.or([eb(currencyRef, '<>', money.currency), amountCondition]);
    }
    return eb.and([eb(currencyRef, '=', money.currency), amountCondition]);
  }

  function sum(
    storage: Storage,
    eb: AnyBuilder,
    amount: AnyReference,
    currency: AnyCurrency,
  ): RawBuilder<unknown> {
    if (storage === 'decimal' && !dialectSql.hasNumericDecimals) {
      throw new RangeError("SQLite's sum() over TEXT decimals is a REAL; sum minor units instead");
    }
    const amountRef = eb.ref(amount as string);
    const fields: [string, Expression<unknown>][] = [
      [MARKER, sql.lit(markerFor(storage))],
      ['amount', dialectSql.asText(sql`sum(${amountRef})`)],
    ];

    if (isFixed(currency)) {
      fields.push(['currency', sql.lit(currency.fixed)]);
    } else {
      const currencyRef = eb.ref(currency as string);
      // only rows with an amount count: a row with a NULL amount adds nothing to the sum
      const currencyOfAmount = sql`case when ${amountRef} is not null then ${currencyRef} end`;
      fields.push(['currency', sql`min(${currencyOfAmount})`]);
      // more than one currency, or an amount without one: the reader throws
      const withoutCurrency = sql`count(case when ${amountRef} is not null and ${currencyRef} is null then 1 end)`;
      const isMixed = sql`${withoutCurrency} > 0 or count(distinct ${currencyOfAmount}) > 1`;
      fields.push(['mixed', sql`case when ${isMixed} then 1 else 0 end`]);
    }
    const object = dialectSql.jsonObject(fields);
    return sql`case when count(${amountRef}) = 0 then null else ${object} end`;
  }

  return {
    selectMoney: ((eb: AnyBuilder, amount: AnyReference, currency: AnyCurrency) =>
      select('minor', eb, amount, currency)) as MoneyHelpers['selectMoney'],
    selectDecimalMoney: ((eb: AnyBuilder, amount: AnyReference, currency: AnyCurrency) =>
      select('decimal', eb, amount, currency)) as MoneyHelpers['selectDecimalMoney'],
    compareMoney: (eb, amount, currency, operator, money) =>
      compare('minor', eb as AnyBuilder, amount, currency, operator, money),
    compareDecimalMoney: (eb, amount, currency, operator, money, size) =>
      compare('decimal', eb as AnyBuilder, amount, currency, operator, money, size),
    sumMoney: ((eb: AnyBuilder, amount: AnyReference, currency: AnyCurrency) =>
      sum('minor', eb, amount, currency)) as MoneyHelpers['sumMoney'],
    sumDecimalMoney: ((eb: AnyBuilder, amount: AnyReference, currency: AnyCurrency) =>
      sum('decimal', eb, amount, currency)) as MoneyHelpers['sumDecimalMoney'],
  };
}

// ---------------------------------------------------------------------------------------------
// The result plugin
// ---------------------------------------------------------------------------------------------

const SELECT_KEYS = ['$ducat', 'amount', 'currency'];
const SUM_KEYS = ['$ducat', 'amount', 'currency', 'mixed'];

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Whether the object is a marker built by this module: exactly the expected keys, with this
 * process's nonce. Anything else, however similar, is ordinary data.
 */
function isMarker(value: Record<string, unknown>): boolean {
  const marker = value[MARKER];
  if (marker !== MINOR_MARKER && marker !== DECIMAL_MARKER) {
    return false;
  }
  return hasExactly(value, SELECT_KEYS) || hasExactly(value, SUM_KEYS);
}

/** Money from one marker object, validating every field. */
function moneyFromMarker(marker: Record<string, unknown>): Money {
  const { amount, currency, mixed } = marker;

  if (mixed === 1 || mixed === true) {
    throw new CurrencyMismatchError('one currency', 'several, or an amount without a currency');
  }
  if (typeof currency !== 'string') {
    throw new TypeError(`A money value needs a currency, got ${String(currency)}`);
  }
  if (marker[MARKER] === MINOR_MARKER) {
    return minorFromDriver(amount, currency);
  }
  const parsed = decimalFromDriver(amount, currency);
  checkIsoScale(parsed);
  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A marker returned as text (SQLite's json_object, MySQL's JSON as a string), or undefined. */
function markerFromText(text: string): Record<string, unknown> | undefined {
  // cheap test first: only text carrying this process's nonce can be a marker
  if (!text.includes(NONCE)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isPlainObject(parsed) && isMarker(parsed) ? parsed : undefined;
}

/** The value with every money marker in it replaced by Money; other values are left as they are. */
function convertMarkers(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return value;
  }
  if (typeof value === 'string') {
    const marker = markerFromText(value);
    return marker === undefined ? value : moneyFromMarker(marker);
  }
  if (Array.isArray(value)) {
    let changed: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const converted = convertMarkers(value[i], depth + 1);
      if (converted !== value[i]) {
        changed ??= value.slice();
        changed[i] = converted;
      }
    }
    return changed ?? value;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  if (isMarker(value)) {
    return moneyFromMarker(value);
  }
  let changed: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    const converted = convertMarkers(value[key], depth + 1);
    if (converted !== value[key]) {
      // fromEntries defines own properties, so a "__proto__" key from JSON.parse stays a key
      changed ??= Object.fromEntries(Object.entries(value));
      changed[key] = converted;
    }
  }
  return changed ?? value;
}

/**
 * A Kysely plugin that turns the values built by `moneyHelpers` into Money, in every row and in
 * JSON nested inside rows. It keeps no state between queries and doesn't touch the query, so it
 * works with streams, prepared and repeated queries, and other plugins. For nested JSON that
 * SQLite returns as text (`jsonArrayFrom`), put `ParseJSONResultsPlugin` before it.
 */
export class MoneyResultPlugin implements KyselyPlugin {
  /** Leaves the query as it is. */
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }

  /** Converts the money values in every row. */
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const rows = convertMarkers(args.result.rows, 0) as UnknownRow[];
    if (rows === args.result.rows) {
      return args.result;
    }
    return { ...args.result, rows };
  }
}
