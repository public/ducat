import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromMinor, identical, money, RoundingError, type Money } from '../src/fn.js';
import {
  fromDineroObject,
  fromGoogleMoney,
  fromIso20022Amount,
  fromMinorUnits,
  toDineroObject,
  toGoogleMoney,
  toIso20022Amount,
  toMinorUnits,
} from '../src/wire.js';

const show = (amount: Money) => amount.toString();

describe('google.type.Money', () => {
  it('splits into units and nanos with one sign', () => {
    expect(toGoogleMoney(money('12.34', 'EUR'))).toEqual({
      currencyCode: 'EUR',
      units: '12',
      nanos: 340_000_000,
    });
    expect(toGoogleMoney(money('-1.75', 'EUR'))).toEqual({
      currencyCode: 'EUR',
      units: '-1',
      nanos: -750_000_000,
    });
    expect(toGoogleMoney(money('-0.5', 'EUR'))).toEqual({
      currencyCode: 'EUR',
      units: '0',
      nanos: -500_000_000,
    });
    expect(toGoogleMoney(money('0', 'EUR'))).toEqual({ currencyCode: 'EUR', units: '0', nanos: 0 });
    expect(toGoogleMoney(money('500', 'JPY')).units).toBe('500');
    expect(toGoogleMoney(money('1.123456789', 'EUR', { scale: 9 })).nanos).toBe(123_456_789);
  });

  it('rejects what it cannot hold', () => {
    expect(() => toGoogleMoney(money('1.0000000001', 'EUR', { scale: 10 }))).toThrow(RoundingError);
    expect(toGoogleMoney(money('1.0000000005', 'EUR', { scale: 10 }), 'halfExpand').nanos).toBe(1);
    expect(toGoogleMoney(money('1.0000000000', 'EUR', { scale: 10 })).nanos).toBe(0);
    expect(() => toGoogleMoney(fromMinor(2n ** 63n * 100n, 'EUR'))).toThrow(RangeError);
    expect(toGoogleMoney(fromMinor((2n ** 63n - 1n) * 100n, 'EUR')).units).toBe(
      String(2n ** 63n - 1n),
    );
  });

  it('reads the proto3 JSON form strictly', () => {
    expect(show(fromGoogleMoney({ currencyCode: 'EUR', units: '12', nanos: 340_000_000 }))).toBe(
      '12.34 EUR',
    );
    expect(show(fromGoogleMoney({ currencyCode: 'USD', units: 5 }))).toBe('5.00 USD');
    expect(show(fromGoogleMoney({ currencyCode: 'USD', nanos: -10_000_000 }))).toBe('-0.01 USD');
    expect(show(fromGoogleMoney({ currencyCode: 'USD', units: 3n }))).toBe('3.00 USD');
    const invalid = [
      { currencyCode: 'eur', units: '1' },
      { currencyCode: 'EUR', units: '1.5' },
      { currencyCode: 'EUR', units: ' 1' },
      { currencyCode: 'EUR', units: 1.5 },
      { currencyCode: 'EUR', units: '9223372036854775808' },
      { currencyCode: 'EUR', units: '1', nanos: 1_000_000_000 },
      { currencyCode: 'EUR', units: '1', nanos: 0.5 },
      { currencyCode: 'EUR', units: '1', nanos: -1 },
      { currencyCode: 'EUR', units: '-1', nanos: 1 },
    ];
    for (const value of invalid) {
      expect(() => fromGoogleMoney(value as never)).toThrow(/^Invalid google.type.Money/);
    }
    expect(() => fromGoogleMoney(null as never)).toThrow('Invalid google.type.Money');
  });

  it('keeps sub-minor precision only when asked', () => {
    const value = { currencyCode: 'EUR', units: '1', nanos: 5_000_000 };
    expect(() => fromGoogleMoney(value)).toThrow(RoundingError);
    expect(show(fromGoogleMoney(value, { scale: 3 }))).toBe('1.005 EUR');
    expect(show(fromGoogleMoney(value, { rounding: 'halfEven' }))).toBe('1.00 EUR');
  });

  it('round-trips exactly (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(2n ** 63n - 1n), max: 2n ** 63n - 1n }),
        fc.integer({ min: 0, max: 9 }),
        (minor, scale) => {
          const amount = fromMinor(minor, 'EUR', scale);
          const wire = toGoogleMoney(amount);
          expect(Math.sign(wire.nanos) * Math.sign(Number(wire.units))).not.toBe(-1);
          const back = fromGoogleMoney(wire, { scale });
          expect(back.equals(amount)).toBe(true);
        },
      ),
    );
  });
});

describe('ISO 20022 amounts', () => {
  it("writes the schema decimal, with the currency's decimals", () => {
    expect(toIso20022Amount(money('12.34', 'EUR'))).toEqual({ Ccy: 'EUR', value: '12.34' });
    expect(toIso20022Amount(money('1000', 'JPY'))).toEqual({ Ccy: 'JPY', value: '1000' });
    expect(toIso20022Amount(money('1.234', 'KWD')).value).toBe('1.234');
    expect(toIso20022Amount(money('0', 'EUR')).value).toBe('0.00');
    // the payment networks require the currency's minor unit, whatever the Money's scale
    expect(toIso20022Amount(money('12.34', 'EUR', { scale: 4 })).value).toBe('12.34');
    expect(toIso20022Amount(money('1000', 'JPY', { scale: 2 })).value).toBe('1000');
    expect(toIso20022Amount(money('12', 'EUR', { scale: 0 })).value).toBe('12.00');
    // other scales only on request
    expect(
      toIso20022Amount(money('1.12345', 'EUR', { scale: 5 }), 'unnecessary', { scale: 5 }).value,
    ).toBe('1.12345');
  });

  it('rejects what the schema rejects', () => {
    expect(() => toIso20022Amount(money('-1', 'EUR'))).toThrow(/can't be negative/);
    expect(() => toIso20022Amount(money('1.005', 'EUR', { scale: 3 }))).toThrow(RoundingError);
    expect(toIso20022Amount(money('1.005', 'EUR', { scale: 3 }), 'halfEven').value).toBe('1.00');
    expect(() => toIso20022Amount(money('1', 'EUR'), 'unnecessary', { scale: 6 })).toThrow(
      'ISO 20022 amounts have 0 to 5 decimals, not 6',
    );
    expect(toIso20022Amount(money('9999999999999999.99', 'EUR')).value).toBe('9999999999999999.99');
    // XSD counts digits in the value: trailing fractional zeros don't count
    expect(toIso20022Amount(money('10000000000000000.00', 'EUR')).value).toBe(
      '10000000000000000.00',
    );
    expect(() => toIso20022Amount(money('12345678901234567.89', 'EUR'))).toThrow(/18 digits/);
  });

  it('reads the schema decimal strictly', () => {
    expect(show(fromIso20022Amount({ Ccy: 'EUR', value: '12.34' }))).toBe('12.34 EUR');
    expect(show(fromIso20022Amount({ Ccy: 'EUR', value: '12' }))).toBe('12.00 EUR');
    expect(show(fromIso20022Amount({ Ccy: 'EUR', value: '0012.3400' }))).toBe('12.34 EUR');
    expect(show(fromIso20022Amount({ Ccy: 'KWD', value: '1.234' }))).toBe('1.234 KWD');
    expect(() => fromIso20022Amount({ Ccy: 'EUR', value: '12.345' })).toThrow(RoundingError);
    expect(show(fromIso20022Amount({ Ccy: 'EUR', value: '12.345' }, { scale: 3 }))).toBe(
      '12.345 EUR',
    );
    for (const value of [
      '',
      '-1',
      '+1',
      '1e3',
      ' 1',
      '1,00',
      '.5',
      '5.',
      '1.123456',
      '1'.repeat(19),
    ]) {
      expect(() => fromIso20022Amount({ Ccy: 'EUR', value })).toThrow(SyntaxError);
    }
    expect(() => fromIso20022Amount({ Ccy: 'eur', value: '1' })).toThrow(SyntaxError);
  });

  it('round-trips exactly (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 18n - 1n }),
        fc.integer({ min: 0, max: 5 }),
        (minor, scale) => {
          const amount = fromMinor(minor, 'EUR', scale);
          const back = fromIso20022Amount(toIso20022Amount(amount, 'unnecessary', { scale }), {
            scale,
          });
          expect(back.equals(amount)).toBe(true);
        },
      ),
    );
  });
});

describe('{ value, currency } in minor units', () => {
  it('converts at the ISO exponent', () => {
    expect(toMinorUnits(money('12.34', 'EUR'))).toEqual({ value: 1234, currency: 'EUR' });
    expect(toMinorUnits(money('500', 'JPY'))).toEqual({ value: 500, currency: 'JPY' });
    expect(toMinorUnits(money('-1.234', 'KWD'))).toEqual({ value: -1234, currency: 'KWD' });
    expect(show(fromMinorUnits({ value: 1234, currency: 'EUR' }))).toBe('12.34 EUR');
    expect(show(fromMinorUnits({ value: 10n ** 20n, currency: 'EUR' }))).toBe(
      '1000000000000000000.00 EUR',
    );
  });

  it('rejects what JSON numbers cannot hold exactly', () => {
    expect(() => toMinorUnits(money('1.005', 'EUR', { scale: 3 }))).toThrow(RoundingError);
    expect(toMinorUnits(money('1.005', 'EUR', { scale: 3 }), 'halfEven').value).toBe(100);
    expect(() => toMinorUnits(fromMinor(2n ** 60n, 'EUR'))).toThrow(RangeError);
    expect(() => fromMinorUnits({ value: 12.5, currency: 'EUR' })).toThrow(RangeError);
    expect(() => fromMinorUnits(null as never)).toThrow('Expected { value, currency }');
  });
});

describe("dinero.js 1's { amount, currency, precision }", () => {
  it('writes the Money as it is, at its scale', () => {
    expect(toDineroObject(money('12.34', 'EUR'))).toEqual({
      amount: 1234,
      currency: 'EUR',
      precision: 2,
    });
    expect(toDineroObject(money('1.2340', 'EUR', { scale: 4 }))).toEqual({
      amount: 12340,
      currency: 'EUR',
      precision: 4,
    });
    expect(toDineroObject(money('500', 'JPY'))).toEqual({
      amount: 500,
      currency: 'JPY',
      precision: 0,
    });
    expect(toDineroObject(money('-1.234', 'KWD')).amount).toBe(-1234);
    expect(Object.is(toDineroObject(money('-0', 'EUR')).amount, 0)).toBe(true);
    expect(() => toDineroObject(fromMinor(2n ** 60n, 'EUR'))).toThrow(RangeError);
    expect(toDineroObject(fromMinor(2 ** 53 - 1, 'EUR')).amount).toBe(2 ** 53 - 1);
  });

  it('reads at the precision it was written with', () => {
    expect(show(fromDineroObject({ amount: 1234, currency: 'EUR', precision: 2 }))).toBe(
      '12.34 EUR',
    );
    // dinero.js 1 gives every currency precision 2 unless told otherwise
    const yen = fromDineroObject({ amount: 500, currency: 'JPY', precision: 2 });
    expect(show(yen)).toBe('5.00 JPY');
    expect(yen.scale).toBe(2);
    expect(show(fromDineroObject({ amount: 12345, currency: 'EUR', precision: 4 }))).toBe(
      '1.2345 EUR',
    );
    expect(show(fromDineroObject({ amount: 7, currency: 'EUR', precision: 0 }))).toBe('7 EUR');
    expect(show(fromDineroObject({ amount: 10n ** 20n, currency: 'EUR', precision: 2 }))).toBe(
      '1000000000000000000.00 EUR',
    );
  });

  it('checks every field', () => {
    const wrongType: unknown[] = [
      null,
      'EUR 12.34',
      { amount: '1234', currency: 'EUR', precision: 2 },
      { amount: null, currency: 'EUR', precision: 2 },
      { currency: 'EUR', precision: 2 },
      { amount: 1234, currency: 'EUR' },
      { amount: 1234, currency: 'JPY' },
      { amount: 1234, currency: 'EUR', precision: '2' },
    ];
    for (const value of wrongType) {
      expect(() => fromDineroObject(value as never)).toThrow(TypeError);
    }
    const outOfRange: unknown[] = [
      { amount: 12.5, currency: 'EUR', precision: 2 },
      { amount: 2 ** 53, currency: 'EUR', precision: 2 },
      { amount: Number.NaN, currency: 'EUR', precision: 2 },
      { amount: 1234, precision: 2 },
      { amount: 1234, currency: 42, precision: 2 },
      { amount: 1234, currency: 'EUR', precision: -1 },
      { amount: 1234, currency: 'EUR', precision: 1.5 },
      { amount: 1234, currency: 'EUR', precision: 1001 },
      { amount: 1234, currency: 'EUR', precision: Number.NaN },
    ];
    for (const value of outOfRange) {
      expect(() => fromDineroObject(value as never)).toThrow(RangeError);
    }
    expect(() => fromDineroObject({ amount: 1234, currency: 'EUR' } as never)).toThrow(
      'A dinero.js precision must be a number, got undefined',
    );
    expect(() => fromDineroObject({ amount: 1234, currency: 'EUR', precision: 1001 })).toThrow(
      'Invalid scale 1001',
    );
  });

  it('round-trips exactly, scale included', () => {
    const currencies = ['EUR', 'JPY', 'KWD', 'CLF'] as const;
    fc.assert(
      fc.property(
        fc.maxSafeInteger(),
        fc.constantFrom(...currencies),
        fc.integer({ min: 0, max: 30 }),
        (amount, currency, precision) => {
          const object = { amount, currency, precision };
          const read = fromDineroObject(object);
          expect(toDineroObject(read)).toEqual({ amount: amount + 0, currency, precision });
          expect(identical(fromDineroObject(toDineroObject(read)), read)).toBe(true);
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(2n ** 52n), max: 2n ** 52n }),
        fc.constantFrom(...currencies),
        fc.integer({ min: 0, max: 30 }),
        (minor, currency, scale) => {
          const value = fromMinor(minor, currency, scale);
          expect(identical(fromDineroObject(toDineroObject(value)), value)).toBe(true);
        },
      ),
    );
  });
});
