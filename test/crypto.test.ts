import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cryptoUnit,
  cryptoUnits,
  defineCryptoCurrencies,
  fromBaseUnits,
  toBaseUnits,
} from '../src/crypto.js';
import { add, currencyExponent, divide, money, multiply, RoundingError, sum } from '../src/fn.js';
import { ISO_EXPONENTS } from '../src/currency.js';

defineCryptoCurrencies();

describe('the crypto table', () => {
  it('has the native currencies and tokens with their decimals and base units', () => {
    expect(cryptoUnit('BTC')).toEqual({
      code: 'BTC',
      name: 'Bitcoin',
      decimals: 8,
      baseUnit: 'satoshi',
      network: 'Bitcoin',
    });
    expect(cryptoUnit('ETH')?.decimals).toBe(18);
    expect(cryptoUnit('ETH')?.baseUnit).toBe('wei');
    expect(cryptoUnit('SOL')?.decimals).toBe(9);
    expect(cryptoUnit('USDC')).toMatchObject({ decimals: 6, network: 'Ethereum' });
    expect(cryptoUnit('USDC')?.contract).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(cryptoUnit('DAI')?.decimals).toBe(18);
    expect(cryptoUnit('toString')).toBeUndefined();
    expect(cryptoUnit('XRP')).toBeUndefined();
  });

  it('matches its snapshot, and no code clashes with ISO 4217', () => {
    const snapshot = JSON.parse(
      readFileSync(new URL('../data/crypto-units.json', import.meta.url), 'utf8'),
    ) as { units: Record<string, { decimals: number }> };
    for (const unit of cryptoUnits()) {
      expect(unit.decimals).toBe(snapshot.units[unit.code]!.decimals);
      expect(unit.code in ISO_EXPONENTS).toBe(false);
    }
    expect(cryptoUnits().length).toBe(Object.keys(snapshot.units).length);
  });

  it('registers codes with their decimals, and checks every code first', () => {
    expect(currencyExponent('BTC')).toBe(8);
    expect(currencyExponent('ETH')).toBe(18);
    expect(() => defineCryptoCurrencies(['BTC', 'XRP' as never])).toThrow(
      'XRP is not in the crypto currency table',
    );
    // registering again is harmless
    defineCryptoCurrencies(['BTC']);
  });
});

describe('base units', () => {
  it('converts both ways', () => {
    expect(toBaseUnits(money('1', 'BTC'))).toBe(100_000_000n);
    expect(toBaseUnits(money('0.00000001', 'BTC'))).toBe(1n);
    expect(toBaseUnits(money('1.5', 'ETH'))).toBe(1_500_000_000_000_000_000n);
    expect(toBaseUnits(money('-0.000000000000000001', 'ETH'))).toBe(-1n);
    expect(fromBaseUnits('100000000', 'BTC').toString()).toBe('1.00000000 BTC');
    expect(fromBaseUnits(1n, 'ETH').toString()).toBe('0.000000000000000001 ETH');
    expect(fromBaseUnits(250, 'USDC').toString()).toBe('0.000250 USDC');
    expect(fromBaseUnits('-5', 'SOL').toString()).toBe('-0.000000005 SOL');
    expect(fromBaseUnits('0', 'ETH').toString()).toBe('0.000000000000000000 ETH');
    expect(fromBaseUnits(BigInt('0x1bc16d674ec80000'), 'ETH').toString()).toBe(
      '2.000000000000000000 ETH',
    );
  });

  it('works at any scale, but never splits a base unit', () => {
    expect(toBaseUnits(money('1', 'BTC', { scale: 2 }))).toBe(100_000_000n);
    expect(toBaseUnits(money('0.000000010', 'BTC', { scale: 9 }))).toBe(1n);
    expect(() => toBaseUnits(money('0.000000015', 'BTC', { scale: 9 }))).toThrow(RoundingError);
    expect(toBaseUnits(money('12.34', 'EUR'))).toBe(1234n);
  });

  it('parses strings strictly', () => {
    for (const bad of [
      '',
      ' 1',
      '1 ',
      '+1',
      '01',
      '-0x1',
      '0x10',
      '1.0',
      '1e18',
      '1_000',
      '1,000',
      '--1',
      '-',
      '1'.repeat(1002),
    ]) {
      expect(() => fromBaseUnits(bad, 'ETH')).toThrow(SyntaxError);
    }
    expect(() => fromBaseUnits(1.5, 'ETH')).toThrow(RangeError);
    expect(() => fromBaseUnits('1', 'XRP')).toThrow(RangeError);
  });
});

describe('18-decimal arithmetic stays exact', () => {
  const wei = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });

  it('add, sum and base units agree with bigint arithmetic (property)', () => {
    fc.assert(
      fc.property(wei, wei, wei, (first, second, third) => {
        const amounts = [first, second, third].map((units) => fromBaseUnits(units, 'ETH'));
        expect(toBaseUnits(add(amounts[0]!, amounts[1]!))).toBe(first + second);
        expect(toBaseUnits(sum(amounts))).toBe(first + second + third);
        expect(fromBaseUnits(String(first), 'ETH').minor == first).toBe(true);
        expect(toBaseUnits(fromBaseUnits(first, 'ETH'))).toBe(first);
      }),
    );
  });

  it('multiply and divide round once at 18 decimals (property)', () => {
    fc.assert(
      fc.property(wei, fc.integer({ min: 1, max: 1000 }), (units, divisor) => {
        const amount = fromBaseUnits(units, 'ETH');
        const quotient = toBaseUnits(divide(amount, divisor, 'trunc'));
        expect(quotient).toBe(units / BigInt(divisor));
        expect(toBaseUnits(multiply(amount, divisor))).toBe(units * BigInt(divisor));
      }),
    );
  });

  it('keeps every wei of a large balance', () => {
    const balance = money('123456789.123456789123456789', 'ETH');
    expect(toBaseUnits(balance)).toBe(123_456_789_123_456_789_123_456_789n);
    expect(balance.add(fromBaseUnits(1n, 'ETH')).toDecimal()).toBe('123456789.123456789123456790');
  });
});
