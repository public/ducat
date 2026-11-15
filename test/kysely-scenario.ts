// The Kysely money helpers against a real database, shared by test/kysely.test.ts (SQLite) and
// test/db/kysely.test.ts (Postgres and MySQL). Each dialect file supplies a connection and its DDL.
import {
  CamelCasePlugin,
  ParseJSONResultsPlugin,
  sql,
  type Dialect,
  type KyselyPlugin,
  type Kysely as KyselyType,
} from 'kysely';
import { Kysely } from 'kysely';
import { jsonArrayFrom as mysqlJsonArrayFrom } from 'kysely/helpers/mysql';
import { jsonArrayFrom as postgresJsonArrayFrom } from 'kysely/helpers/postgres';
import { jsonArrayFrom as sqliteJsonArrayFrom } from 'kysely/helpers/sqlite';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { CurrencyMismatchError, money, type CurrencyInput, type Money } from '../src/index.js';
import { identical } from '../src/fn.js';
import {
  fixed,
  moneyHelpers,
  MoneyResultPlugin,
  setDecimalMoney,
  setMoney,
  type DecimalAmountColumn,
  type MinorUnitsColumn,
  type MoneyDialect,
} from '../src/kysely.js';

export interface Schema {
  ducat_kysely_payments: {
    id: number;
    order_id: number;
    amount_minor: MinorUnitsColumn;
    currency: string | null;
  };
  ducat_kysely_ledger: {
    id: number;
    amount_minor: MinorUnitsColumn | null;
    currency: string | null;
  };
  ducat_kysely_orders: {
    id: number;
    total_minor: MinorUnitsColumn;
    price: DecimalAmountColumn | null;
  };
  ducat_kysely_scaled: {
    id: number;
    amount_minor: MinorUnitsColumn | null;
    currency: string;
    amount_scale: number | null;
  };
}

/** The same tables with camelCase names, for CamelCasePlugin. */
interface CamelSchema {
  ducatKyselyPayments: {
    id: number;
    orderId: number;
    amountMinor: MinorUnitsColumn;
    currency: string;
  };
}

export interface ScenarioOptions {
  readonly dialect: MoneyDialect;
  readonly makeDialect: () => Dialect;
  /** CREATE TABLE statements for each table in `Schema`. */
  readonly ddl: readonly string[];
  /** Whether the driver supports `stream()` (Postgres through pg-cursor). */
  readonly canStream: boolean;
}

const PAYMENTS = [
  { id: 1, order_id: 1, amount: money('5', 'USD') },
  { id: 2, order_id: 1, amount: money('500', 'JPY') },
  { id: 3, order_id: 2, amount: money('5.00', 'EUR') },
  { id: 4, order_id: 2, amount: money('92233720368547758.07', 'EUR') },
  { id: 5, order_id: 3, amount: money('-92233720368547758.08', 'EUR') },
  { id: 6, order_id: 3, amount: money('1.234', 'KWD') },
  { id: 7, order_id: 3, amount: money('90071992547409.93', 'EUR') },
];
// amounts above, at and below their currency's scale, beyond 2^53 units too
const SCALED = [
  money('1.005', 'EUR', { scale: 3 }),
  money('12.34', 'EUR'),
  money('12', 'EUR', { scale: 0 }),
  money('-0.1', 'EUR', { scale: 1 }),
  money('1.5', 'JPY', { scale: 1 }),
  money('1000', 'JPY'),
  money('0.000001', 'KWD', { scale: 6 }),
  money('-120', 'KWD', { scale: 0 }),
  money('9223372036.854775807', 'EUR', { scale: 9 }),
];
const ORDERS = [
  { id: 1, total: money('12.34', 'EUR'), price: money('9.99', 'EUR') },
  { id: 2, total: money('90071992547409.93', 'EUR'), price: null },
  { id: 3, total: money('0.01', 'EUR'), price: money('999999999999999.99', 'EUR') },
];

function show(values: readonly (Money | null)[]): string[] {
  return values.map(String);
}

export function kyselyScenario(name: string, enabled: boolean, options: ScenarioOptions): void {
  const { dialect, makeDialect, ddl, canStream } = options;
  const helpers = moneyHelpers(dialect);
  const jsonArrayFrom = {
    postgres: postgresJsonArrayFrom,
    mysql: mysqlJsonArrayFrom,
    sqlite: sqliteJsonArrayFrom,
  }[dialect];

  describe.skipIf(!enabled)(`Kysely money helpers on ${name}`, () => {
    let db: KyselyType<Schema>;

    beforeAll(async () => {
      // ParseJSONResultsPlugin first: SQLite returns nested JSON as text
      db = new Kysely<Schema>({
        dialect: makeDialect(),
        plugins: [new ParseJSONResultsPlugin(), new MoneyResultPlugin()],
      });
      await db.schema.dropTable('ducat_kysely_payments').ifExists().execute();
      await db.schema.dropTable('ducat_kysely_orders').ifExists().execute();
      await db.schema.dropTable('ducat_kysely_ledger').ifExists().execute();
      await db.schema.dropTable('ducat_kysely_scaled').ifExists().execute();
      for (const statement of ddl) {
        await sql.raw(statement).execute(db);
      }
      await db
        .insertInto('ducat_kysely_payments')
        .values(
          PAYMENTS.map((row) => ({
            id: row.id,
            order_id: row.order_id,
            ...setMoney(row.amount, 'amount_minor', 'currency'),
          })),
        )
        .execute();
      await db
        .insertInto('ducat_kysely_orders')
        .values(
          ORDERS.map((row) => ({
            id: row.id,
            ...setMoney(row.total, 'total_minor', fixed('EUR')),
            price:
              row.price === null ? null : setDecimalMoney(row.price, 'price', fixed('EUR')).price,
          })),
        )
        .execute();
    });

    afterAll(async () => {
      await db?.destroy();
    });

    it('selects Money exactly, at the BIGINT limits, typed by currency and nullability', async () => {
      const rows = await db
        .selectFrom('ducat_kysely_payments')
        .select((eb) => ['id', helpers.selectMoney(eb, 'amount_minor', 'currency').as('amount')])
        .orderBy('id')
        .execute();
      expectTypeOf(rows[0]!.amount).toEqualTypeOf<Money<CurrencyInput>>();
      expect(rows.every((row, index) => identical(row.amount, PAYMENTS[index]!.amount))).toBe(true);

      const orders = await db
        .selectFrom('ducat_kysely_orders')
        .select((eb) => [
          helpers.selectMoney(eb, 'total_minor', fixed('EUR')).as('total'),
          helpers.selectDecimalMoney(eb, 'price', fixed('EUR')).as('price'),
        ])
        .orderBy('id')
        .execute();
      expectTypeOf(orders[0]!.total).toEqualTypeOf<Money<'EUR'>>();
      expectTypeOf(orders[0]!.price).toEqualTypeOf<Money<'EUR'> | null>();
      expect(orders.map((row) => [String(row.total), String(row.price)])).toEqual(
        ORDERS.map((row) => [String(row.total), String(row.price)]),
      );
    });

    it("a scale column round-trips Money above, at and below its currency's scale", async () => {
      const scale = { scale: 'amount_scale' } as const;
      await db
        .insertInto('ducat_kysely_scaled')
        .values(
          SCALED.map((amount, index) => ({
            id: index + 1,
            ...setMoney(amount, 'amount_minor', 'currency', scale),
          })),
        )
        .execute();

      const rows = await db
        .selectFrom('ducat_kysely_scaled')
        .select((eb) => helpers.selectMoney(eb, 'amount_minor', 'currency', scale).as('amount'))
        .orderBy('id')
        .execute();
      expectTypeOf(rows[0]!.amount).toEqualTypeOf<Money<CurrencyInput> | null>();
      expect(rows).toHaveLength(SCALED.length);
      expect(rows.every((row, index) => identical(row.amount!, SCALED[index]!))).toBe(true);

      // with a fixed currency, and a qualified scale column
      const euros = await db
        .selectFrom('ducat_kysely_scaled as s')
        .select((eb) =>
          helpers
            .selectMoney(eb, 's.amount_minor', fixed('EUR'), { scale: 's.amount_scale' })
            .as('amount'),
        )
        .where('s.currency', '=', 'EUR')
        .orderBy('s.id')
        .execute();
      expectTypeOf(euros[0]!.amount).toEqualTypeOf<Money<'EUR'> | null>();
      expect(euros.map((row) => String(row.amount))).toEqual(
        SCALED.filter((amount) => amount.currency === 'EUR').map(String),
      );
    });

    it('a scale column: a NULL amount reads as null, and a NULL scale throws', async () => {
      await db
        .insertInto('ducat_kysely_scaled')
        .values([
          { id: 100, amount_minor: null, currency: 'EUR', amount_scale: null },
          { id: 101, amount_minor: '5', currency: 'EUR', amount_scale: null },
        ])
        .execute();
      const read = (id: number) =>
        db
          .selectFrom('ducat_kysely_scaled')
          .select((eb) =>
            helpers
              .selectMoney(eb, 'amount_minor', 'currency', { scale: 'amount_scale' })
              .as('amount'),
          )
          .where('id', '=', id)
          .executeTakeFirstOrThrow();

      expect((await read(100)).amount).toBeNull();
      await expect(read(101)).rejects.toThrow(/integer scale from 0 to 1000 in "scale", got null/);
      // without the scale column, the same units read at the currency's exponent
      const atIso = await db
        .selectFrom('ducat_kysely_scaled')
        .select((eb) => helpers.selectMoney(eb, 'amount_minor', 'currency').as('amount'))
        .where('id', '=', 101)
        .executeTakeFirstOrThrow();
      expect(String(atIso.amount)).toBe('0.05 EUR');
    });

    it('leaves raw columns raw: only helper expressions are Money', async () => {
      const row = await db
        .selectFrom('ducat_kysely_payments')
        .select(['amount_minor', 'currency'])
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      expectTypeOf(row.amount_minor).toEqualTypeOf<string | number | bigint>();
      expect(String(row.amount_minor)).toBe('500');
    });

    it('a union of minor-unit and decimal columns reads each by its own storage', async () => {
      const rows = await db
        .selectFrom('ducat_kysely_orders')
        .select((eb) => ['id', helpers.selectDecimalMoney(eb, 'price', fixed('EUR')).as('value')])
        .where('id', '=', 1)
        .unionAll((eb) =>
          eb
            .selectFrom('ducat_kysely_orders')
            .select((inner) => [
              'id',
              helpers.selectMoney(inner, 'total_minor', fixed('EUR')).as('value'),
            ])
            .where('id', '=', 1),
        )
        .execute();
      expect(show(rows.map((row) => row.value)).sort()).toEqual(['12.34 EUR', '9.99 EUR']);
    });

    it('compares currency and amount together: 5 USD is not 500 JPY or 5.00 EUR', async () => {
      const ids = async (operator: '=' | '<>' | '>=', amount: Money) =>
        (
          await db
            .selectFrom('ducat_kysely_payments')
            .select('id')
            .where((eb) => helpers.compareMoney(eb, 'amount_minor', 'currency', operator, amount))
            .orderBy('id')
            .execute()
        ).map((row) => Number(row.id));

      expect(await ids('=', money('5', 'USD'))).toEqual([1]);
      expect(await ids('=', money('500', 'JPY'))).toEqual([2]);
      expect(await ids('<>', money('5', 'USD'))).toEqual([2, 3, 4, 5, 6, 7]);
      expect(await ids('>=', money('5', 'EUR'))).toEqual([3, 4, 7]);
      // beyond 2^53: one cent apart must not compare equal through a double
      expect(await ids('=', money('90071992547409.93', 'EUR'))).toEqual([7]);
      expect(await ids('=', money('90071992547409.92', 'EUR'))).toEqual([]);

      expect(() =>
        db
          .selectFrom('ducat_kysely_orders')
          .select('id')
          .where((eb) =>
            helpers.compareMoney(eb, 'total_minor', fixed('EUR'), '=', money('1', 'USD')),
          ),
      ).toThrow(CurrencyMismatchError);
    });

    it('sums per currency, and refuses a sum across currencies', async () => {
      const perCurrency = await db
        .selectFrom('ducat_kysely_payments')
        .select((eb) => ['currency', helpers.sumMoney(eb, 'amount_minor', 'currency').as('total')])
        .where('id', 'in', [1, 2, 6])
        .groupBy('currency')
        .orderBy('currency')
        .execute();
      expect(show(perCurrency.map((row) => row.total))).toEqual([
        '500 JPY',
        '1.234 KWD',
        '5.00 USD',
      ]);

      const mixed = db
        .selectFrom('ducat_kysely_payments')
        .select((eb) => helpers.sumMoney(eb, 'amount_minor', 'currency').as('total'))
        .where('id', 'in', [1, 2]);
      await expect(mixed.execute()).rejects.toThrow(CurrencyMismatchError);

      // an amount without a currency is refused even when another row has no amount
      await db
        .insertInto('ducat_kysely_ledger')
        .values([
          { id: 1, amount_minor: '10000', currency: 'USD' },
          { id: 2, amount_minor: '20000', currency: null },
          { id: 3, amount_minor: null, currency: 'USD' },
          { id: 4, amount_minor: '500', currency: 'USD' },
          { id: 5, amount_minor: null, currency: 'EUR' },
        ])
        .execute();
      const ledgerSum = (ids: number[]) =>
        db
          .selectFrom('ducat_kysely_ledger')
          .select((eb) => helpers.sumMoney(eb, 'amount_minor', 'currency').as('total'))
          .where('id', 'in', ids)
          .executeTakeFirstOrThrow();
      await expect(ledgerSum([1, 2, 3])).rejects.toThrow(CurrencyMismatchError);
      // a currency with no amount isn't a second currency
      expect(String((await ledgerSum([1, 3, 4, 5])).total)).toBe('105.00 USD');

      const none = await db
        .selectFrom('ducat_kysely_payments')
        .select((eb) => helpers.sumMoney(eb, 'amount_minor', 'currency').as('total'))
        .where('id', '>', 100)
        .executeTakeFirstOrThrow();
      expect(none.total).toBeNull();

      const euros = await db
        .selectFrom('ducat_kysely_orders')
        .select((eb) => helpers.sumMoney(eb, 'total_minor', fixed('EUR')).as('total'))
        .executeTakeFirstOrThrow();
      expect(String(euros.total)).toBe('90071992547422.28 EUR');
    });

    it('converts Money in CTEs, subqueries and nested JSON', async () => {
      const viaCte = await db
        .with('big', (cte) =>
          cte
            .selectFrom('ducat_kysely_payments')
            .select((eb) => [
              'id',
              helpers.selectMoney(eb, 'amount_minor', 'currency').as('amount'),
            ])
            .where('id', '=', 4),
        )
        .selectFrom('big')
        .select('amount')
        .executeTakeFirstOrThrow();
      expect(String(viaCte.amount)).toBe('92233720368547758.07 EUR');

      const nested = await db
        .selectFrom('ducat_kysely_orders as o')
        .select((eb) => [
          'o.id',
          jsonArrayFrom(
            eb
              .selectFrom('ducat_kysely_payments as p')
              .select((inner) => [
                'p.id',
                helpers.selectMoney(inner, 'p.amount_minor', 'p.currency').as('amount'),
              ])
              .whereRef('p.order_id', '=', 'o.id')
              .orderBy('p.id'),
          ).as('payments'),
        ])
        .where('o.id', '=', 3)
        .executeTakeFirstOrThrow();
      const amounts = nested.payments.map((payment) => payment.amount);
      expect(amounts.every((amount) => (amount as unknown) instanceof Object)).toBe(true);
      expect(show(amounts)).toEqual([
        '-92233720368547758.08 EUR',
        '1.234 KWD',
        '90071992547409.93 EUR',
      ]);
    });

    it('converts every result of a repeated compiled query, and every stream chunk', async () => {
      const query = db
        .selectFrom('ducat_kysely_payments')
        .select((eb) => helpers.selectMoney(eb, 'amount_minor', 'currency').as('amount'))
        .orderBy('id');
      const compiled = query.compile();
      const [first, second] = await Promise.all([
        db.executeQuery(compiled),
        db.executeQuery(compiled),
      ]);
      expect(show(first.rows.map((row) => row.amount))).toEqual(
        show(PAYMENTS.map((row) => row.amount)),
      );
      expect(show(second.rows.map((row) => row.amount))).toEqual(
        show(PAYMENTS.map((row) => row.amount)),
      );
    });

    it.skipIf(!canStream)(
      'streams in several chunks, converting every row and no look-alike',
      async () => {
        // counts transformResult calls: one per streamed chunk
        let chunks = 0;
        const counter: KyselyPlugin = {
          transformQuery: (args) => args.node,
          transformResult: async (args) => {
            chunks++;
            return args.result;
          },
        };
        const streaming = new Kysely<Schema>({
          dialect: makeDialect(),
          plugins: [counter, new MoneyResultPlugin()],
        });
        // a value that looks like a marker, but without this process's nonce
        const forged = '{"$ducat":"minor","amount":"100000","currency":"USD"}';
        try {
          const query = streaming
            .selectFrom('ducat_kysely_payments')
            .select((eb) => [
              helpers.selectMoney(eb, 'amount_minor', 'currency').as('amount'),
              sql<string>`${forged}`.as('note'),
            ])
            .orderBy('id');
          const streamed: { amount: Money; note: string }[] = [];
          for await (const row of query.stream(2)) {
            streamed.push(row);
          }
          expect(show(streamed.map((row) => row.amount))).toEqual(
            show(PAYMENTS.map((row) => row.amount)),
          );
          expect(streamed.every((row) => row.note === forged)).toBe(true);
          expect(chunks).toBeGreaterThanOrEqual(Math.ceil(PAYMENTS.length / 2));
        } finally {
          await streaming.destroy();
        }
      },
    );

    it('works with CamelCasePlugin before or after it', async () => {
      for (const plugins of [
        [new CamelCasePlugin(), new MoneyResultPlugin()],
        [new MoneyResultPlugin(), new CamelCasePlugin()],
      ]) {
        const camel = new Kysely<CamelSchema>({ dialect: makeDialect(), plugins });
        try {
          const row = await camel
            .selectFrom('ducatKyselyPayments')
            .select((eb) => [
              'orderId',
              helpers.selectMoney(eb, 'amountMinor', 'currency').as('paidAmount'),
            ])
            .where('id', '=', 4)
            .executeTakeFirstOrThrow();
          expect(String(row.paidAmount)).toBe('92233720368547758.07 EUR');
          expect(Number(row.orderId)).toBe(2);
        } finally {
          await camel.destroy();
        }
      }
    });

    it('updates and upserts through setMoney, checking a fixed currency', async () => {
      await db
        .updateTable('ducat_kysely_orders')
        .set(setMoney(money('1.00', 'EUR'), 'total_minor', fixed('EUR')))
        .where('id', '=', 3)
        .execute();
      const row = await db
        .selectFrom('ducat_kysely_orders')
        .select((eb) => helpers.selectMoney(eb, 'total_minor', fixed('EUR')).as('total'))
        .where('id', '=', 3)
        .executeTakeFirstOrThrow();
      expect(String(row.total)).toBe('1.00 EUR');

      const dollars = money('1', 'USD') as unknown as Money<'EUR'>;
      expect(() => setMoney(dollars, 'total_minor', fixed('EUR'))).toThrow(CurrencyMismatchError);
    });
  });
}
