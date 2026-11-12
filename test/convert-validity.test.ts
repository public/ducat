import '../src/plugins/core.js';
import { describe, expect, it } from 'vitest';
import { convert, convertDetailed } from '../src/convert.js';
import { money } from '../src/fn.js';
import { roundingPolicy } from '../src/policy.js';
import { exchangeRate, RateExpiredError } from '../src/rate.js';

// #270: every conversion that takes ConvertOptions applies strictValidity the same way.
const expired = exchangeRate('EUR', 'USD', '1.1', { validUntil: '2000-01-01T00:05:00Z' });
const current = exchangeRate('EUR', 'USD', '1.1', { validUntil: '2999-12-31' });
const strict = { strictValidity: true } as const;
const amount = money('1.00', 'EUR');
const policy = roundingPolicy({ rounding: 'halfEven' });

describe('strictValidity', () => {
  it.each([
    ['convert with a mode', () => convert(amount, expired, 'halfEven', strict)],
    ['convert with a policy', () => convert(amount, expired, policy, strict)],
    ['convertDetailed with a mode', () => convertDetailed(amount, expired, 'halfEven', strict)],
    ['convertDetailed with a policy', () => convertDetailed(amount, expired, policy, strict)],
    [
      'convertDetailed with the default mode',
      () => convertDetailed(amount, expired, undefined, strict),
    ],
  ])('%s refuses an expired rate', (_name, attempt) => {
    expect(attempt).toThrow(RateExpiredError);
    expect(attempt).toThrow('Exchange rate EUR→USD expired at 2000-01-01T00:05:00.000Z');
  });

  it('accepts a rate valid until a future date, in every form', () => {
    expect(convert(amount, current, 'halfEven', strict).toString()).toBe('1.10 USD');
    expect(convert(amount, current, policy, strict).toString()).toBe('1.10 USD');
    expect(convertDetailed(amount, current, 'halfEven', strict).value.toString()).toBe('1.10 USD');
    expect(convertDetailed(amount, current, policy, strict).value.toString()).toBe('1.10 USD');
  });

  it('reads no clock unless asked: an expired rate converts without strictValidity', () => {
    expect(convertDetailed(amount, expired, 'halfEven').value.toString()).toBe('1.10 USD');
    expect(
      convertDetailed(amount, expired, policy, { strictValidity: false }).value.toString(),
    ).toBe('1.10 USD');
  });
});
