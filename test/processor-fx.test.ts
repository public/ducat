import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { money } from '../src/index.js';
import { adyenRate } from '../src/adyen-fx.js';
import { impliedRate } from '../src/rate.js';
import { stripeImpliedRate, stripeRate } from '../src/stripe-fx.js';

const data = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));

describe('processor rates', () => {
  it('Stripe: the documented 10.00 EUR × 1.234 = 12.34 USD', () => {
    const [{ charge, balanceTransaction: bt }] = data('stripe-fx.json').vectors;
    const r = stripeRate(charge.currency, { ...bt, created: 1_794_000_000 })!;
    expect([r.from, r.to, r.toString(), r.source]).toEqual(['EUR', 'USD', '1.234', 'stripe']);
    expect(r.asOf).toBe('2026-11-06T21:20:00.000Z');
    expect(r.convert(money('10.00', 'EUR'), 'halfEven').toDecimal()).toBe('12.34');
    expect(stripeRate('eur', { amount: 1000, currency: 'eur', exchange_rate: null })).toBeUndefined();
    expect(stripeImpliedRate(money('10.00', 'EUR'), bt).toString()).toBe('1.234');
    // a zero-decimal settlement currency: 10.00 EUR -> 1768 JPY
    expect(stripeImpliedRate(money('10.00', 'EUR'), { amount: 1768, currency: 'jpy' }).toString()).toBe('176.8');
  });

  it('Adyen: settlement details Exchange Rate, gross to net', () => {
    const [{ row }] = data('adyen-fx.json').vectors;
    expect(adyenRate(row)?.toString()).toBe('1');
    const r = adyenRate({
      'Creation Date': '2026-11-06 14:03:11',
      'Gross Currency': 'EUR',
      'Net Currency': 'GBP',
      'Exchange Rate': '0.83415',
    })!;
    expect([r.from, r.to, r.toString(), r.source, r.asOf]).toEqual(['EUR', 'GBP', '0.83415', 'adyen', '2026-11-06']);
    expect(adyenRate({ 'Gross Currency': 'EUR' })).toBeUndefined();
    const usdEur = { 'Gross Currency': 'USD', 'Net Currency': 'EUR', 'Exchange Rate': '0.9' };
    // 23:30 in Los Angeles on the 6th is already the 7th in UTC
    expect(adyenRate({ ...usdEur, 'Creation Date': '2026-11-06 23:30:00', TimeZone: 'PST' })?.asOf).toBe(
      '2026-11-07T07:30:00.000Z',
    );
    expect(adyenRate({ ...usdEur, 'Creation Date': '2026-11-06 00:30:00', TimeZone: 'CET' })?.asOf).toBe(
      '2026-11-05T23:30:00.000Z',
    );
    expect(adyenRate({ ...usdEur, 'Creation Date': '2026-11-06 12:00', TimeZone: '+05:30' })?.asOf).toBe(
      '2026-11-06T06:30:00.000Z',
    );
    expect(adyenRate({ ...usdEur, 'Creation Date': '2026-11-06 12:00:00', TimeZone: 'GMT-3' })?.asOf).toBe(
      '2026-11-06T15:00:00.000Z',
    );
    // an ambiguous zone keeps the local day
    expect(adyenRate({ ...usdEur, 'Creation Date': '2026-11-06 23:30:00', TimeZone: 'IST' })?.asOf).toBe('2026-11-06');
  });

  it('impliedRate is the exact settled ÷ presented, refunds included', () => {
    expect(impliedRate(money('10.00', 'EUR'), money('12.34', 'USD')).toString()).toBe('1.234');
    expect(impliedRate(money('-3.00', 'EUR'), money('-1000', 'JPY')).toString()).toBe('1000/3');
    expect(() => impliedRate(money('0', 'EUR'), money('1', 'USD'))).toThrow(RangeError);
    expect(() => impliedRate(money('1', 'EUR'), money('-1', 'USD'))).toThrow(RangeError);
  });
});
