import { describe, expect, it } from 'vitest';
import { fromJSON, fromMinor, money, zero } from '../src/index.js';
import { convert } from '../src/convert.js';
import { exchangeRate } from '../src/rate.js';
import { fromScaled } from '../src/fixed.js';
import { fromStripe } from '../src/stripe.js';
import { fromAdyen } from '../src/adyen.js';
import { fromDineroObject, fromMinorUnits } from '../src/wire.js';

// A code no test registers, so the shared registry (Bun runs every file in one process) can't
// make it valid.
const UNKNOWN = 'QQV';
const unknown = /Unknown currency "QQV"/;

describe('every constructor checks the currency, with or without an explicit scale', () => {
  it('money and fromJSON', () => {
    expect(() => money('1', UNKNOWN)).toThrow(unknown);
    expect(() => money('1', UNKNOWN, { scale: 2 })).toThrow(unknown);
    expect(() => money(1, UNKNOWN, { scale: 0 })).toThrow(unknown);
    expect(() => fromJSON({ amount: '1', currency: UNKNOWN })).toThrow(unknown);
    expect(() => fromJSON({ amount: '1', currency: UNKNOWN }, { scale: 2 })).toThrow(unknown);
  });
  it('fromMinor and zero', () => {
    expect(() => fromMinor(1, UNKNOWN)).toThrow(unknown);
    expect(() => fromMinor(1, UNKNOWN, 2)).toThrow(unknown);
    expect(() => fromMinor(1n, UNKNOWN, 2)).toThrow(unknown);
    expect(() => zero(UNKNOWN)).toThrow(unknown);
    expect(() => zero(UNKNOWN, 2)).toThrow(unknown);
  });
  it('conversion into an unknown currency', () => {
    const eur = money('1', 'EUR');
    expect(() => convert(eur, UNKNOWN, '1.1')).toThrow(unknown);
    expect(() => convert(eur, UNKNOWN, '1.1', 'halfEven', { scale: 4 })).toThrow(unknown);
    expect(() =>
      exchangeRate('EUR', UNKNOWN, '1.1').convert(eur, 'halfEven', { scale: 4 }),
    ).toThrow(unknown);
  });
  it('processor and wire readers', () => {
    // Stripe and Adyen check their own currency lists first.
    expect(() => fromStripe(100, UNKNOWN)).toThrow(/QQV is not a Stripe presentment currency/);
    expect(() => fromAdyen({ value: 100, currency: UNKNOWN })).toThrow(
      /QQV is not in Adyen's currency table/,
    );
    expect(() => fromMinorUnits({ value: 100, currency: UNKNOWN })).toThrow(unknown);
    expect(() => fromDineroObject({ amount: 100, currency: UNKNOWN, precision: 2 })).toThrow(
      unknown,
    );
  });
  it('known currencies still accept any scale', () => {
    expect(fromMinor(1234, 'EUR', 3).toString()).toBe('1.234 EUR');
    expect(money('1', 'JPY', { scale: 2 }).toString()).toBe('1.00 JPY');
    expect(zero('KWD', 5).scale).toBe(5);
  });
});

describe('integer error messages', () => {
  it('suggest a bigint only for integers beyond 2^53', () => {
    expect(() => fromMinor(12.3, 'EUR')).toThrow('Minor units must be an integer, got 12.3');
    expect(() => fromMinor(Infinity, 'EUR')).toThrow(
      'Minor units must be an integer, got Infinity',
    );
    expect(() => fromMinor(-(2 ** 60), 'EUR')).toThrow(/must be a safe integer, .*; pass a bigint/);
    expect(() => fromScaled(1.5, 2)).toThrow('The scaled value must be an integer, got 1.5');
    expect(() => fromScaled(2 ** 60, 2)).toThrow(/must be a safe integer, .*; pass a bigint/);
  });
});
