import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, fromMinor, money } from '../src/index.js';
import { identical } from '../src/fn.js';
import {
  decimalTransformer,
  fromRawDecimal,
  fromRawMinor,
  jsonTransformer,
  minorTransformer,
} from '../src/typeorm.js';
import { typeormScenario } from './typeorm-scenario.js';

// INTEGER columns as bigints: better-sqlite3's default numbers lose digits beyond 2^53
typeormScenario('SQLite (better-sqlite3)', true, 'sqlite', () => ({
  type: 'better-sqlite3',
  database: ':memory:',
  driver: Database,
  prepareDatabase: (db: Database.Database) => {
    db.defaultSafeIntegers(true);
  },
}));

describe('TypeORM transformers', () => {
  it('pass null and undefined through, for nullable columns', () => {
    for (const transformer of [
      minorTransformer('EUR'),
      decimalTransformer('EUR'),
      jsonTransformer(),
    ]) {
      expect(transformer.to(null)).toBe(null);
      expect(transformer.to(undefined)).toBe(undefined);
      expect(transformer.from(null)).toBe(null);
      expect(transformer.from(undefined)).toBe(null);
    }
  });

  it('convert exactly both ways', () => {
    const minor = minorTransformer('EUR');
    expect(minor.to(money('12.34', 'EUR'))).toBe('1234');
    expect(minor.to(fromMinor(2n ** 63n - 1n, 'EUR'))).toBe(String(2n ** 63n - 1n));
    for (const value of ['1234', 1234, 1234n]) {
      expect(minor.from(value)!.toString()).toBe('12.34 EUR');
    }
    expect(() => minor.from(2 ** 53)).toThrow(RangeError);
    expect(() => minor.from('12.34')).toThrow(SyntaxError);

    const units = minorTransformer('EUR', { scale: 4 });
    expect(units.to(money('1.2345', 'EUR', { scale: 4 }))).toBe('12345');
    expect(identical(units.from('12345')!, money('1.2345', 'EUR', { scale: 4 }))).toBe(true);
    expect(() => units.to(money('1.23', 'EUR'))).toThrow('round() it to 4 decimals');

    const decimal = decimalTransformer('EUR');
    expect(decimal.to(money('-0.01', 'EUR'))).toBe('-0.01');
    expect(decimal.from('12.3400')!.toString()).toBe('12.34 EUR');
    expect(() => decimal.from(12.34)).toThrow(TypeError);
    expect(() => decimal.from('12.345')).toThrow(RangeError);

    const json = jsonTransformer();
    // an object: TypeORM serialises json, jsonb and simple-json columns itself
    expect(json.to(money('1.234', 'KWD'))).toEqual({ amount: '1.234', currency: 'KWD' });
    expect(json.from({ amount: '1.234', currency: 'KWD' })!.toString()).toBe('1.234 KWD');
    expect(json.from('{"amount":"5","currency":"JPY"}')!.toString()).toBe('5 JPY');
    expect(() => json.from(5)).toThrow(TypeError);
  });

  it('hold a column to its currency', () => {
    expect(() => minorTransformer('EUR').to(money('1', 'USD') as never)).toThrow(
      CurrencyMismatchError,
    );
    expect(() => decimalTransformer('EUR').to(money('1', 'USD') as never)).toThrow(
      CurrencyMismatchError,
    );
    const euros = jsonTransformer('EUR');
    expect(() => euros.to(money('1', 'USD') as never)).toThrow(CurrencyMismatchError);
    expect(() => euros.from({ amount: '1', currency: 'USD' })).toThrow(CurrencyMismatchError);
    expect(() => jsonTransformer().to(money('1.001', 'EUR', { scale: 3 }))).toThrow(RangeError);
  });

  it('check the column when it is declared', () => {
    expect(() => minorTransformer('QQV' as never)).toThrow('Unknown currency');
    expect(() => decimalTransformer('QQV' as never)).toThrow('Unknown currency');
    expect(() => jsonTransformer('QQV' as never)).toThrow('Unknown currency');
    expect(() => minorTransformer('EUR', { scale: -1 })).toThrow('Invalid scale -1');
    expect(() => minorTransformer('EUR', { scale: 1.5 })).toThrow('Invalid scale 1.5');
    expect(() => decimalTransformer('KWD', { precision: 19, scale: 2 })).toThrow('would round KWD');
    expect(() => decimalTransformer('EUR', { precision: 2, scale: 4 })).toThrow(
      'not a valid column size',
    );
    expect(() =>
      decimalTransformer('EUR', { precision: 4, scale: 2 }).to(money('100', 'EUR')),
    ).toThrow('does not fit NUMERIC(4,2)');
  });

  it('read raw aggregates strictly', () => {
    expect(fromRawMinor('1234', 'EUR').toString()).toBe('12.34 EUR');
    expect(fromRawMinor(1234n, 'EUR').toString()).toBe('12.34 EUR');
    expect(fromRawMinor('12345', 'EUR', { scale: 4 }).toString()).toBe('1.2345 EUR');
    expect(fromRawDecimal('24.6800', 'EUR').toString()).toBe('24.68 EUR');
    expect(() => fromRawMinor(null, 'EUR')).toThrow(TypeError);
    expect(() => fromRawMinor(undefined, 'EUR')).toThrow('COALESCE');
    expect(() => fromRawMinor('1234.5000', 'EUR')).toThrow(SyntaxError);
    expect(() => fromRawMinor(2 ** 53, 'EUR')).toThrow(RangeError);
    expect(() => fromRawMinor('1', 'EUR', { scale: -1 })).toThrow('Invalid scale -1');
    expect(() => fromRawDecimal(null, 'EUR')).toThrow('COALESCE');
    expect(() => fromRawDecimal(0.3, 'EUR')).toThrow(TypeError);
  });

  it('refuse a better-sqlite3 number that has lost digits', async () => {
    const { DataSource, EntitySchema } = await import('typeorm');
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      driver: Database,
      synchronize: true,
      entities: [
        new EntitySchema<{ id: number; total: unknown }>({
          name: 'Unsafe',
          columns: {
            id: { type: 'int', primary: true },
            total: { type: 'bigint', transformer: minorTransformer('EUR') },
          },
        }),
      ],
    });
    await dataSource.initialize();
    try {
      const repository = dataSource.getRepository('Unsafe');
      await repository.save({ id: 1, total: fromMinor(2n ** 53n + 1n, 'EUR') });
      // without defaultSafeIntegers, better-sqlite3 returns 2^53 + 1 as a float
      await expect(repository.findOneBy({ id: 1 })).rejects.toThrow(RangeError);
      await repository.save({ id: 2, total: money('12.34', 'EUR') });
      expect(String((await repository.findOneByOrFail({ id: 2 })).total)).toBe('12.34 EUR');
    } finally {
      await dataSource.destroy();
    }
  });
});
