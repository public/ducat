/**
 * Prisma / SQL interop with no dependency on @prisma/client (works with any Decimal class that has
 * toFixed(): Prisma.Decimal, decimal.js, big.js).
 *
 * Storage options (see README "Databases"):
 *  1. two columns: amount_minor BIGINT + currency CHAR(3)       -> minorMoneyField / toMinorColumns
 *  2. a DECIMAL/NUMERIC column (+ a currency column or constant) -> decimalMoneyField / toDecimalValue
 */
import { fromMinor, money, toDecimal, toMinor, type CurrencyInput, type Money, type MoneyOptions } from './money.js';

/** Structural type of Prisma.Decimal / decimal.js / big.js values. */
export interface DecimalLike {
  toFixed(): string;
}

/** Money from a Decimal (or decimal string) column. Exact; throws if it has more decimals than the currency. */
export function fromDecimal<C extends CurrencyInput>(value: DecimalLike | string, currency: C, options?: MoneyOptions): Money<C> {
  return money(typeof value === 'string' ? value : value.toFixed(), currency, options);
}

/** A Decimal for a NUMERIC column: toDecimalValue(m, Prisma.Decimal). */
export function toDecimalValue<D>(m: Money, Decimal: new (value: string) => D): D {
  return new Decimal(toDecimal(m));
}

type Row<A extends string, V> = { [P in A]: V };

/**
 * A Prisma result-extension field that exposes a Money built from `amount_minor` + `currency` columns:
 *
 *     const db = new PrismaClient().$extends({
 *       result: { order: { total: minorMoneyField('totalMinor', 'currency') } },
 *     });
 *     (await db.order.findFirstOrThrow()).total   // Money
 */
export function minorMoneyField<const A extends string, const K extends string>(amount: A, currency: K) {
  return {
    needs: { [amount]: true, [currency]: true } as { [P in A | K]: true },
    compute: (row: Row<A, bigint | number> & Row<K, string>): Money => fromMinor(row[amount], row[currency]),
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
export function decimalMoneyField(amount: string, c: { currencyField: string } | { currency: string }): { needs: Record<string, true>; compute: (row: any) => Money } {
  if ('currencyField' in c) {
    return {
      needs: { [amount]: true, [c.currencyField]: true },
      compute: (row: Record<string, unknown>) => fromDecimal(row[amount] as DecimalLike, row[c.currencyField] as string),
    };
  }
  return { needs: { [amount]: true }, compute: (row: Record<string, unknown>) => fromDecimal(row[amount] as DecimalLike, c.currency) };
}

/**
 * Column values for writes: `data: { ...toMinorColumns(total, 'totalMinor', 'currency') }`.
 * Minor units are a bigint (Prisma BigInt). Throws if the value has a non-standard scale, because
 * the column cannot record it.
 */
export function toMinorColumns<const A extends string, const K extends string>(m: Money, amount: A, currency: K): Row<A, bigint> & Row<K, string> {
  return { [amount]: toMinorAtIsoScale(m), [currency]: m.currency } as Row<A, bigint> & Row<K, string>;
}

function toMinorAtIsoScale(m: Money): bigint {
  const iso = fromMinor(0, m.currency).scale;
  if (m.scale !== iso) throw new RangeError(`${m} has scale ${m.scale}; round() it to ${iso} decimals before storing minor units`);
  return toMinor(m);
}
