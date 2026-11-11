// The TypeORM transformers against a real database through a TypeORM DataSource.
// test/typeorm.test.ts runs this on SQLite (better-sqlite3); test/db/typeorm.test.ts on Postgres
// and MySQL when DUCAT_PG_URL and DUCAT_MYSQL_URL are set (CI runs both as service containers).
import {
  Between,
  DataSource,
  EntitySchema,
  Equal,
  In,
  IsNull,
  LessThan,
  MoreThan,
  type DataSourceOptions,
  type Repository,
} from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CurrencyMismatchError, money, type Money } from '../src/index.js';
import { identical } from '../src/fn.js';
import {
  decimalTransformer,
  fromRawDecimal,
  fromRawMinor,
  jsonTransformer,
  minorTransformer,
} from '../src/typeorm.js';

export type TypeormDialect = 'postgres' | 'mysql' | 'sqlite';

interface Order {
  id: number;
  total: Money<'EUR'>;
  price: Money<'EUR'> | null;
  refund: Money | null;
  fee: Money<'EUR'> | null;
}

// EUR amounts, including beyond 2^53 cents and at the BIGINT limits
const EURO_AMOUNTS = [
  '0.00',
  '12.34',
  '-0.01',
  '90071992547409.91',
  '90071992547409.93',
  '-90071992547409.93',
  '92233720368547758.07',
  '-92233720368547758.08',
];
// what fits NUMERIC(19,4): 15 integer digits
const fitsDecimal = (amount: string) => amount.replace('-', '').indexOf('.') <= 15;

const JSON_TYPES = { postgres: 'jsonb', mysql: 'json', sqlite: 'simple-json' } as const;

function orderSchema(dialect: TypeormDialect) {
  return new EntitySchema<Order>({
    name: 'Order',
    tableName: 'ducat_typeorm_orders',
    columns: {
      id: { type: 'int', primary: true },
      total: { type: 'bigint', name: 'total_minor', transformer: minorTransformer('EUR') },
      price:
        dialect === 'sqlite'
          ? { type: 'text', nullable: true, transformer: decimalTransformer('EUR') }
          : {
              type: 'decimal',
              precision: 19,
              scale: 4,
              nullable: true,
              transformer: decimalTransformer('EUR', { precision: 19, scale: 4 }),
            },
      refund: { type: JSON_TYPES[dialect], nullable: true, transformer: jsonTransformer() },
      // ten-thousandths of a euro
      fee: {
        type: 'bigint',
        name: 'fee_units',
        nullable: true,
        transformer: minorTransformer('EUR', { scale: 4 }),
      },
    },
  });
}

const show = (value: Money | null | undefined) => value?.toString() ?? String(value);

export function typeormScenario(
  name: string,
  enabled: boolean,
  dialect: TypeormDialect,
  options: () => DataSourceOptions,
): void {
  describe.skipIf(!enabled)(`TypeORM transformers on ${name}`, () => {
    let dataSource: DataSource;
    let orders: Repository<Order>;

    beforeAll(async () => {
      dataSource = new DataSource({
        ...options(),
        entities: [orderSchema(dialect)],
        synchronize: false,
      } as DataSourceOptions);
      await dataSource.initialize();
      await dataSource.query('DROP TABLE IF EXISTS ducat_typeorm_orders');
      await dataSource.synchronize();
      orders = dataSource.getRepository<Order>('Order');
    });

    afterAll(async () => {
      await dataSource?.destroy();
    });

    it('round-trips every column exactly, at the BIGINT limits too', async () => {
      await orders.clear();
      const rows = EURO_AMOUNTS.map((amount, index) => ({
        id: index + 1,
        total: money(amount, 'EUR'),
        price: fitsDecimal(amount) ? money(amount, 'EUR') : null,
        refund: index % 2 === 0 ? money('1.234', 'KWD') : money(amount, 'EUR'),
        fee: money('0.0001', 'EUR', { scale: 4 }),
      }));
      await orders.save(rows);

      const read = await orders.find({ order: { id: 'ASC' } });
      expect(read.map((row) => show(row.total))).toEqual(EURO_AMOUNTS.map((a) => `${a} EUR`));
      for (const [index, row] of read.entries()) {
        const written = rows[index]!;
        expect(identical(row.total, written.total)).toBe(true);
        expect(show(row.price)).toBe(show(written.price));
        expect(identical(row.refund!, written.refund)).toBe(true);
        expect(identical(row.fee!, written.fee)).toBe(true);
      }
    });

    it('keeps nulls, and writes only what changed', async () => {
      await orders.clear();
      await orders.save({ id: 1, total: money('5', 'EUR'), price: null, refund: null, fee: null });
      const row = await orders.findOneByOrFail({ id: 1 });
      expect([row.price, row.refund, row.fee]).toEqual([null, null, null]);
      expect(await orders.countBy({ refund: IsNull() })).toBe(1);

      row.total = money('6.50', 'EUR');
      row.refund = money('1', 'USD');
      await orders.save(row);
      const updated = await orders.findOneByOrFail({ id: 1 });
      expect([show(updated.total), show(updated.refund), updated.price]).toEqual([
        '6.50 EUR',
        '1.00 USD',
        null,
      ]);
    });

    it('takes Money in find operators', async () => {
      await orders.clear();
      const amounts = ['1.00', '2.50', '10.00', '-3.00'];
      await orders.save(
        amounts.map((amount, index) => ({
          id: index + 1,
          total: money(amount, 'EUR'),
          price: money(amount, 'EUR'),
          refund: null,
          fee: null,
        })),
      );
      const ids = async (where: object) =>
        (await orders.find({ where, order: { id: 'ASC' } })).map((row) => Number(row.id));

      expect(await ids({ total: MoreThan(money('2.00', 'EUR')) })).toEqual([2, 3]);
      expect(await ids({ total: LessThan(money('0', 'EUR')) })).toEqual([4]);
      expect(await ids({ total: Equal(money('10.00', 'EUR')) })).toEqual([3]);
      expect(await ids({ total: money('2.50', 'EUR') })).toEqual([2]);
      expect(await ids({ total: In([money('1', 'EUR'), money('-3', 'EUR')]) })).toEqual([1, 4]);
      expect(await ids({ total: Between(money('1.00', 'EUR'), money('2.50', 'EUR')) })).toEqual([
        1, 2,
      ]);
      if (dialect !== 'sqlite') {
        // SQLite compares TEXT decimals as text, so only the other two order them numerically
        expect(await ids({ price: MoreThan(money('2.00', 'EUR')) })).toEqual([2, 3]);
      }
      {
        // 2^53 + 1 and 2^53 + 2 cents round to the same double (#258)
        await orders.save([
          { id: 5, total: money('90071992547409.93', 'EUR'), price: null, refund: null, fee: null },
          { id: 6, total: money('90071992547409.94', 'EUR'), price: null, refund: null, fee: null },
        ]);
        expect(await ids({ total: Equal(money('90071992547409.93', 'EUR')) })).toEqual([5]);
        expect(await ids({ total: MoreThan(money('90071992547409.93', 'EUR')) })).toEqual([6]);
      }
      // a find operator can't take Money in another currency, or at another scale
      await expect(ids({ total: MoreThan(money('1', 'USD')) })).rejects.toThrow(
        CurrencyMismatchError,
      );
      await expect(ids({ total: MoreThan(money('1.001', 'EUR', { scale: 3 })) })).rejects.toThrow(
        'round() it to 2 decimals',
      );
    });

    it('refuses to write what the column would change', async () => {
      const base = { id: 99, price: null, refund: null, fee: null };
      await expect(orders.save({ ...base, total: money('1', 'USD') as never })).rejects.toThrow(
        CurrencyMismatchError,
      );
      await expect(
        orders.save({ ...base, total: money('1.005', 'EUR', { scale: 3 }) }),
      ).rejects.toThrow(RangeError);
      await expect(
        orders.save({ ...base, total: money('1', 'EUR'), fee: money('1.00', 'EUR') }),
      ).rejects.toThrow('round() it to 4 decimals');
      if (dialect !== 'sqlite') {
        // SQLite's TEXT column has no size to exceed
        await expect(
          orders.save({
            ...base,
            total: money('1', 'EUR'),
            price: money('1000000000000000', 'EUR'),
          }),
        ).rejects.toThrow('does not fit NUMERIC(19,4)');
      }
      expect(await orders.countBy({ id: 99 })).toBe(0);
    });

    it('reads aggregates from raw queries', async () => {
      await orders.clear();
      await orders.save(
        ['0.10', '0.20', '92233720368547758.07', '-92233720368547758.08'].map((amount, index) => ({
          id: index + 1,
          total: money(amount, 'EUR'),
          price: fitsDecimal(amount) ? money(amount, 'EUR') : null,
          refund: null,
          fee: null,
        })),
      );
      const raw = await orders
        .createQueryBuilder('o')
        .select('SUM(o.total_minor)', 'total')
        .addSelect('SUM(o.price)', 'price')
        .where('o.id <= 2')
        .getRawOne<{ total: unknown; price: unknown }>();
      expect(show(fromRawMinor(raw!.total, 'EUR'))).toBe('0.30 EUR');
      if (dialect === 'sqlite') {
        // SQLite sums TEXT as floats: refused, never trusted
        expect(() => fromRawDecimal(raw!.price, 'EUR')).toThrow(TypeError);
      } else {
        expect(show(fromRawDecimal(raw!.price, 'EUR'))).toBe('0.30 EUR');
      }

      // the two BIGINT limits sum to -1 cent; Postgres and MySQL sum BIGINT as exact decimals
      if (dialect !== 'sqlite') {
        const all = await orders
          .createQueryBuilder('o')
          .select('SUM(o.total_minor)', 'total')
          .where('o.id >= 3')
          .getRawOne<{ total: unknown }>();
        expect(show(fromRawMinor(all!.total, 'EUR'))).toBe('-0.01 EUR');
      }

      const none = await orders
        .createQueryBuilder('o')
        .select('SUM(o.total_minor)', 'total')
        .where('o.id > 100')
        .getRawOne<{ total: unknown }>();
      expect(() => fromRawMinor(none!.total, 'EUR')).toThrow('COALESCE');
      const zero = await orders
        .createQueryBuilder('o')
        .select('COALESCE(SUM(o.total_minor), 0)', 'total')
        .where('o.id > 100')
        .getRawOne<{ total: unknown }>();
      expect(show(fromRawMinor(zero!.total, 'EUR'))).toBe('0.00 EUR');
    });
  });
}
