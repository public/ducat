/**
 * Prisma / SQL interop with no dependency on @prisma/client (works with any Decimal class that has
 * toFixed(): Prisma.Decimal, decimal.js, big.js).
 *
 * Storage options (see README "Databases"):
 *  1. two columns: amount_minor BIGINT + currency CHAR(3)
 *     -> minorMoneyField / toMinorColumns
 *  2. a DECIMAL/NUMERIC column (+ a currency column or constant)
 *     -> decimalMoneyField / toDecimalValue
 */
import { MAX_DECIMAL_SCALE } from './decimal.js';
import {
  fromMinor,
  money,
  toDecimal,
  toMinor,
  type CurrencyInput,
  type Money,
  type MoneyOptions,
} from './money.js';

/** Structural type of Prisma.Decimal / decimal.js / big.js values. */
export interface DecimalLike {
  toFixed(): string;
}

/**
 * Money from a Decimal (or decimal string) column. Exact; throws if it has more decimals than the
 * currency.
 */
export function fromDecimal<C extends CurrencyInput>(
  value: DecimalLike | string,
  currency: C,
  options?: MoneyOptions,
): Money<C> {
  return money(typeof value === 'string' ? value : value.toFixed(), currency, options);
}

/** A Decimal for a NUMERIC column: toDecimalValue(m, Prisma.Decimal). */
export function toDecimalValue<D>(money: Money, Decimal: new (value: string) => D): D {
  return new Decimal(toDecimal(money));
}

type Row<A extends string, V> = { [P in A]: V };

/** Options for `minorMoneyField` and `toMinorColumns`: a column that records each amount's scale. */
export interface ScaleColumnOption<S extends string> {
  /**
   * The integer column holding the number of decimals the minor units are counted in (2 for
   * cents). With it, any scale round-trips, and stored amounts keep their meaning even if a
   * currency's exponent changes.
   */
  readonly scale: S;
}

/** A scale read from a row: a safe, non-negative integer (a SMALLINT or INT column). */
function readScale(value: unknown, column: string): number {
  const scale = typeof value === 'bigint' ? Number(value) : value;
  // capped like parsed decimals: a corrupt row must not make toDecimal build a huge power of ten
  const isValid =
    typeof scale === 'number' &&
    Number.isInteger(scale) &&
    scale >= 0 &&
    scale <= MAX_DECIMAL_SCALE;
  if (!isValid) {
    throw new RangeError(
      `Expected an integer scale from 0 to ${MAX_DECIMAL_SCALE} in "${column}", got ${String(value)}`,
    );
  }
  return scale;
}

/**
 * A Prisma result-extension field that exposes a Money built from `amount_minor` + `currency`
 * columns, and optionally a scale column:
 *
 *     const db = new PrismaClient().$extends({
 *       result: { order: { total: minorMoneyField('totalMinor', 'currency') } },
 *     });
 *     (await db.order.findFirstOrThrow()).total   // Money
 *
 * Without a scale column the minor units are read at the currency's current exponent.
 */
export function minorMoneyField<const A extends string, const K extends string>(
  amount: A,
  currency: K,
): {
  needs: { [P in A | K]: true };
  compute: (row: Row<A, bigint | number> & Row<K, string>) => Money;
};
export function minorMoneyField<
  const A extends string,
  const K extends string,
  const S extends string,
>(
  amount: A,
  currency: K,
  options: ScaleColumnOption<S>,
): {
  needs: { [P in A | K | S]: true };
  compute: (row: Row<A, bigint | number> & Row<K, string> & Row<S, bigint | number>) => Money;
};
export function minorMoneyField(
  amount: string,
  currency: string,
  options?: ScaleColumnOption<string>,
): { needs: Record<string, true>; compute: (row: Record<string, unknown>) => Money } {
  if (options === undefined) {
    return {
      needs: { [amount]: true, [currency]: true },
      compute: (row) => fromMinor(row[amount] as bigint | number, row[currency] as string),
    };
  }

  const scaleColumn = options.scale;
  return {
    needs: { [amount]: true, [currency]: true, [scaleColumn]: true },
    compute: (row) =>
      fromMinor(
        row[amount] as bigint | number,
        row[currency] as string,
        readScale(row[scaleColumn], scaleColumn),
      ),
  };
}

/**
 * A Prisma result-extension field for a Decimal column, with the currency taken from another column
 * (`{ currencyField: 'currency' }`) or fixed (`{ currency: 'EUR' }`).
 */
export function decimalMoneyField<const A extends string, const K extends string>(
  amount: A,
  currency: { currencyField: K },
): { needs: { [P in A | K]: true }; compute: (row: Row<A, DecimalLike> & Row<K, string>) => Money };
export function decimalMoneyField<const A extends string, const C extends CurrencyInput>(
  amount: A,
  currency: { currency: C },
): { needs: { [P in A]: true }; compute: (row: Row<A, DecimalLike>) => Money<C> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decimalMoneyField(
  amount: string,
  currencySource: { currencyField: string } | { currency: string },
): { needs: Record<string, true>; compute: (row: any) => Money } {
  if ('currencyField' in currencySource) {
    return {
      needs: { [amount]: true, [currencySource.currencyField]: true },
      compute: (row: Record<string, unknown>) =>
        fromDecimal(row[amount] as DecimalLike, row[currencySource.currencyField] as string),
    };
  }
  return {
    needs: { [amount]: true },
    compute: (row: Record<string, unknown>) =>
      fromDecimal(row[amount] as DecimalLike, currencySource.currency),
  };
}

/**
 * Column values for writes: `data: { ...toMinorColumns(total, 'totalMinor', 'currency') }`.
 * Minor units are a bigint (Prisma BigInt). Without a scale column, throws if the value has a
 * non-standard scale, because the columns cannot record it. With `{ scale: 'amountScale' }`, any
 * scale is stored, next to the minor units it counts.
 */
export function toMinorColumns<const A extends string, const K extends string>(
  money: Money,
  amount: A,
  currency: K,
): Row<A, bigint> & Row<K, string>;
export function toMinorColumns<
  const A extends string,
  const K extends string,
  const S extends string,
>(
  money: Money,
  amount: A,
  currency: K,
  options: ScaleColumnOption<S>,
): Row<A, bigint> & Row<K, string> & Row<S, number>;
export function toMinorColumns(
  money: Money,
  amount: string,
  currency: string,
  options?: ScaleColumnOption<string>,
): Record<string, unknown> {
  if (options === undefined) {
    return { [amount]: toMinorAtIsoScale(money), [currency]: money.currency };
  }
  return { [amount]: toMinor(money), [currency]: money.currency, [options.scale]: money.scale };
}

function toMinorAtIsoScale(money: Money): bigint {
  const iso = fromMinor(0, money.currency).scale;
  if (money.scale !== iso) {
    throw new RangeError(
      `${money} has scale ${money.scale}; round() it to ${iso} decimals before storing minor units`,
    );
  }
  return toMinor(money);
}
