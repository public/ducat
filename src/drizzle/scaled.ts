// The scale column of Drizzle's `moneyMinor(currency, { scale })`, shared by the three dialects. A
// Drizzle column sees only its own value, so the amount column can't read its scale by itself:
// `scaledMoney(column)` selects the two columns as one text value, `"<units>:<scale>"`, which the
// amount column's reader turns into Money.
import { getTableColumns, sql, type Column, type SQL } from 'drizzle-orm';
import type { Money } from '../money.js';
import { minorFromDriver, readScale, type ScaleColumnOption } from '../sql.js';

const SCALED_TEXT = /^(-?\d+):(\d*)$/;

// What scaledMoney passes to a column's reader to ask for its scale column. Only a scaled
// moneyMinor column answers; every other column treats it as an ordinary (invalid) value.
const SCALE_PROBE: unique symbol = Symbol('ducat scale column');

/** Joins the amount and scale columns' SQL into the `"<units>:<scale>"` text. */
export type JoinAsText = (amount: SQL, scale: SQL) => SQL;

/**
 * The reader of a scaled `moneyMinor` column: Money from the text `scaledMoney` selects. A plain
 * integer (the column selected by itself) has lost its scale, so it throws instead of guessing.
 */
export function scaledFromDriver<C extends string>(
  value: unknown,
  currency: C,
  options: ScaleColumnOption<string>,
): Money<C> {
  if (value === SCALE_PROBE) {
    return options as never;
  }
  const match = typeof value === 'string' ? SCALED_TEXT.exec(value) : null;
  if (match === null) {
    throw new TypeError(
      `A moneyMinor column with the scale column "${options.scale}" can't be read by itself, ` +
        `got ${String(value)}; select it with scaledMoney(table.column)`,
    );
  }
  // an empty scale is a NULL scale column
  const scale = readScale(match[2] === '' ? null : Number(match[2]), options.scale);
  return minorFromDriver(match[1], currency, scale);
}

/** The data type of a column, or the data type or null when the column is nullable. */
export type ScaledMoneyOf<T extends Column> = T['_']['notNull'] extends true
  ? T['_']['data']
  : T['_']['data'] | null;

/**
 * The SQL that reads a scaled `moneyMinor` column with its scale column, as the column's Money:
 * NULL for a NULL amount, and an error on read for a NULL scale.
 */
export function scaledMoneySql<T extends Column>(
  column: T,
  join: JoinAsText,
): SQL<ScaledMoneyOf<T>> {
  let options: unknown;
  try {
    options = column.mapFromDriverValue(SCALE_PROBE);
  } catch {
    // a column that refuses the probe, such as moneyMinor without a scale column
    options = undefined;
  }
  const isScaled =
    typeof options === 'object' &&
    options !== null &&
    typeof (options as { scale?: unknown }).scale === 'string';
  if (!isScaled) {
    throw new TypeError(
      `scaledMoney needs a moneyMinor column with a scale column, got "${column.name}"`,
    );
  }

  const scaleKey = (options as ScaleColumnOption<string>).scale;
  const scaleColumn = (getTableColumns(column.table) as Record<string, Column | undefined>)[
    scaleKey
  ];
  if (scaleColumn === undefined) {
    throw new RangeError(`The table of "${column.name}" has no column "${scaleKey}" for its scale`);
  }
  const text = join(sql`${column}`, sql`${scaleColumn}`);
  return sql<ScaledMoneyOf<T>>`case when ${column} is null then null else ${text} end`.mapWith(
    column,
  );
}
