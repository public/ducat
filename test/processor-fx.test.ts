import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { money } from '../src/index.js';
import { adyenRate } from '../src/adyen-fx.js';
import { impliedRate } from '../src/rate.js';
import { stripeImpliedRate, stripeRate } from '../src/stripe-fx.js';

function data(file: string) {
  return JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
}

describe('processor rates', () => {
  it('Stripe: the documented 10.00 EUR × 1.234 = 12.34 USD', () => {
    const [{ charge, balanceTransaction: transaction }] = data('stripe-fx.json').vectors;
    const eurUsd = stripeRate(charge.currency, { ...transaction, created: 1_794_000_000 })!;
    expect([eurUsd.from, eurUsd.to, eurUsd.toString(), eurUsd.source]).toEqual(['EUR', 'USD', '1.234', 'stripe']);
    expect(eurUsd.asOf).toBe('2026-11-06T21:20:00.000Z');
    expect(eurUsd.convert(money('10.00', 'EUR'), 'halfEven').toDecimal()).toBe('12.34');
    expect(stripeRate('eur', { amount: 1000, currency: 'eur', exchange_rate: null })).toBeUndefined();
    expect(stripeImpliedRate(money('10.00', 'EUR'), transaction).toString()).toBe('1.234');
    // a zero-decimal settlement currency: 10.00 EUR -> 1768 JPY
    const yen = { amount: 1768, currency: 'jpy' };
    expect(stripeImpliedRate(money('10.00', 'EUR'), yen).toString()).toBe('176.8');
  });

  it('Adyen: settlement details Exchange Rate, gross to net', () => {
    const [{ row }] = data('adyen-fx.json').vectors;
    expect(adyenRate(row)?.toString()).toBe('1');
    const eurGbp = adyenRate({
      'Creation Date': '2026-11-06 14:03:11',
      'Gross Currency': 'EUR',
      'Net Currency': 'GBP',
      'Exchange Rate': '0.83415',
    })!;
    const fields = [eurGbp.from, eurGbp.to, eurGbp.toString(), eurGbp.source, eurGbp.asOf];
    expect(fields).toEqual(['EUR', 'GBP', '0.83415', 'adyen', '2026-11-06']);
    expect(adyenRate({ 'Gross Currency': 'EUR' })).toBeUndefined();
    expect(adyenRate({ 'Gross Currency': 'EUR', 'Net Currency': '', 'Exchange Rate': '1' })).toBeUndefined();
    expect(adyenRate({ 'Gross Currency': 'EUR', 'Net Currency': 'GBP', 'Exchange Rate': ' ' })).toBeUndefined();
  });

  it('Adyen: Creation Date in UTC from the TimeZone column or the account zone', () => {
    const usdEur = { 'Gross Currency': 'USD', 'Net Currency': 'EUR', 'Exchange Rate': '0.9' };
    const asOf = (created: string, timeZone?: string, account?: string) => {
      const row =
        timeZone === undefined
          ? { ...usdEur, 'Creation Date': created }
          : { ...usdEur, 'Creation Date': created, TimeZone: timeZone };
      return adyenRate(row, account === undefined ? undefined : { timeZone: account })?.asOf;
    };
    // 23:30 in Los Angeles on the 6th is already the 7th in UTC
    expect(asOf('2026-11-06 23:30:00', 'PST')).toBe('2026-11-07T07:30:00.000Z');
    expect(asOf('2026-11-06 00:30:00', 'CET')).toBe('2026-11-05T23:30:00.000Z');
    expect(asOf('2026-11-06 12:00', '+05:30')).toBe('2026-11-06T06:30:00.000Z');
    expect(asOf('2026-11-06 12:00:00', 'GMT-3')).toBe('2026-11-06T15:00:00.000Z');
    // an ambiguous zone, or an offset no zone has, keeps the local day
    expect(asOf('2026-11-06 23:30:00', 'IST')).toBe('2026-11-06');
    expect(asOf('2026-11-06 23:30:00', '+99')).toBe('2026-11-06');
    expect(asOf('2026-11-06 23:30:00', '+05:75')).toBe('2026-11-06');
    // a literal CET in July is taken as +01:00; the account zone gives summer time
    expect(asOf('2026-07-06 12:00:00', 'CET')).toBe('2026-07-06T11:00:00.000Z');
    expect(asOf('2026-07-06 12:00:00', 'CET', 'Europe/Amsterdam')).toBe('2026-07-06T10:00:00.000Z');
    expect(asOf('2026-11-06 12:00:00', 'CET', 'Europe/Amsterdam')).toBe('2026-11-06T11:00:00.000Z');
    expect(asOf('2026-07-06 12:00:00', undefined, 'America/Los_Angeles')).toBe('2026-07-06T19:00:00.000Z');
    // across the autumn change: 03:30 on 25 October 2026 is after the clocks went back in Amsterdam
    expect(asOf('2026-10-25 03:30:00', undefined, 'Europe/Amsterdam')).toBe('2026-10-25T02:30:00.000Z');
    expect(() => asOf('2026-11-06 12:00:00', undefined, 'Mars/Olympus')).toThrow(RangeError);
  });

  it('impliedRate is the exact settled ÷ presented, refunds included', () => {
    expect(impliedRate(money('10.00', 'EUR'), money('12.34', 'USD')).toString()).toBe('1.234');
    expect(impliedRate(money('-3.00', 'EUR'), money('-1000', 'JPY')).toString()).toBe('1000/3');
    expect(() => impliedRate(money('0', 'EUR'), money('1', 'USD'))).toThrow(RangeError);
    expect(() => impliedRate(money('1', 'EUR'), money('-1', 'USD'))).toThrow(RangeError);
  });
});
