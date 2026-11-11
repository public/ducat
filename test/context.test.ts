import '../src/plugins/iso.js'; // /fn registers no currencies
import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CurrencyMismatchError,
  currencyContext,
  equals,
  format,
  fromMinor,
  identical,
  money,
  parse,
  zero,
  type Money,
  type MoneyOf,
} from '../src/fn.js';

const eur = currencyContext('EUR', { locale: 'nl-NL', parse });

describe('currencyContext', () => {
  it('binds the plain functions to its currency', () => {
    expect(eur.currency).toBe('EUR');
    expect(eur.locale).toBe('nl-NL');
    expect(identical(eur.money('12.34'), money('12.34', 'EUR'))).toBe(true);
    expect(identical(eur.money('1.5', { scale: 4 }), money('1.5', 'EUR', { scale: 4 }))).toBe(true);
    expect(eur.money('1.005', { rounding: 'halfEven' }).toString()).toBe('1.00 EUR');
    expect(() => eur.money('1.005')).toThrow('more than 2 decimal places');
    expect(eur.fromMinor(1234).toString()).toBe('12.34 EUR');
    expect(eur.fromMinor(12345n, 4).toString()).toBe('1.2345 EUR');
    expect(identical(eur.zero(), zero('EUR'))).toBe(true);
    expect(eur.zero(3).scale).toBe(3);
  });

  it('formats and parses in its locale', () => {
    const amount = eur.money('-1234.5');
    expect(eur.format(amount)).toBe(format(amount, 'nl-NL'));
    expect(eur.format(amount, { currencyDisplay: 'code' })).toBe(
      format(amount, 'nl-NL', { currencyDisplay: 'code' }),
    );
    expect(eur.parse('€ 1.234,50').toString()).toBe('1234.50 EUR');
    expect(identical(eur.parse('€ 1.234,50'), parse('€ 1.234,50', 'EUR', 'nl-NL'))).toBe(true);
    // a misplaced group separator is refused, as parse() refuses it, unless lenient
    expect(() => eur.parse('1.5')).toThrow(SyntaxError);
    expect(eur.parse('1.5', { lenient: true }).toString()).toBe('15.00 EUR');

    // without a locale, the runtime's, as format(m) without one
    const usd = currencyContext('USD');
    expect(usd.locale).toBe(undefined);
    expect(usd.format(usd.money('5'))).toBe(format(money('5', 'USD')));
  });

  it('reads back what it formats', () => {
    fc.assert(
      fc.property(fc.integer({ min: -(10 ** 14), max: 10 ** 14 }), (cents) => {
        const amount = eur.fromMinor(cents);
        expect(identical(eur.parse(eur.format(amount)), amount)).toBe(true);
      }),
    );
  });

  it('agrees with the functions it binds', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.nat(20),
        (minor, scale) => {
          expect(identical(eur.fromMinor(minor, scale), fromMinor(minor, 'EUR', scale))).toBe(true);
        },
      ),
    );
  });

  it('narrows with is()', () => {
    const values: unknown[] = [money('1', 'EUR'), money('1', 'USD'), '1 EUR', null];
    expect(values.map((value) => eur.is(value))).toEqual([true, false, false, false]);
    const value: unknown = money('2', 'EUR');
    if (eur.is(value)) {
      expectTypeOf(value).toEqualTypeOf<Money<'EUR'>>();
    }
  });

  it('is a frozen plain object, and nothing global', () => {
    expect(Object.isFrozen(eur)).toBe(true);
    expect(() => {
      (eur as { currency: string }).currency = 'USD';
    }).toThrow(TypeError);
    const jpy = currencyContext('JPY', { locale: 'ja-JP' });
    expect(jpy.zero().toString()).toBe('0 JPY');
    expect(eur.zero().toString()).toBe('0.00 EUR');
    // the functions themselves still take any currency
    expect(money('1', 'USD').toString()).toBe('1.00 USD');
    expect(equals(currencyContext('EUR').money('1'), eur.money('1'))).toBe(true);
  });

  it('parses only when given parse', () => {
    const formatOnly = currencyContext('EUR', { locale: 'nl-NL' });
    expect('parse' in formatOnly).toBe(false);
    // @ts-expect-error no parse without { parse }
    expect(formatOnly.parse).toBe(undefined);
    expectTypeOf(eur.parse('1')).toEqualTypeOf<Money<'EUR'>>();
    expect(Object.keys(eur).sort()).toEqual(
      ['currency', 'format', 'fromMinor', 'is', 'locale', 'money', 'parse', 'zero'].sort(),
    );
  });

  it('checks the currency, the locale and parse when it is made', () => {
    expect(() => currencyContext('QQV' as never)).toThrow('Unknown currency');
    expect(() => currencyContext('EUR', { locale: 'not a locale' })).toThrow(RangeError);
    expect(() => currencyContext('EUR', { parse: 'yes' as never })).toThrow(TypeError);
  });

  it('types its values as Money in its currency', () => {
    expectTypeOf(eur.money('1')).toEqualTypeOf<Money<'EUR'>>();
    expectTypeOf(eur.fromMinor(1)).toEqualTypeOf<Money<'EUR'>>();
    expectTypeOf<MoneyOf<typeof eur>>().toEqualTypeOf<Money<'EUR'>>();
    const usd = money('1', 'USD');
    // @ts-expect-error a USD amount in the EUR context
    expect(() => eur.format(usd)).toThrow(CurrencyMismatchError);
  });
});
