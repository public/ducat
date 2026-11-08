import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currencyExponent, isCurrency, money, toStripeAmount, toBraintree } from '../src/fn.js';
import { ISO_EXPONENTS } from '../src/currency.js';
import {
  defineHistoricCurrencies,
  historicCurrencies,
  historicCurrency,
  ISO_4217_LIST_THREE_PUBLISHED,
} from '../src/historic.js';

describe('historic currency table', () => {
  it('has the codes processors and old records still use, with ISO withdrawal months', () => {
    expect(historicCurrency('HRK')).toEqual({
      code: 'HRK',
      name: 'Kuna',
      numeric: '191',
      exponent: 2,
      withdrawn: '2023-01',
    });
    // withdrawn country by country: the last date counts
    expect(historicCurrency('ANG')?.withdrawn).toBe('2025-03');
    expect(historicCurrency('BGN')?.withdrawn).toBe('2026-01');
    for (const code of ['STD', 'ZWL', 'SLL', 'CUC', 'VEF', 'LTL', 'ZMK', 'ZWD', 'MRO', 'DEM']) {
      expect(historicCurrency(code)?.withdrawn).toMatch(/^\d{4}-\d{2}$/);
    }
    expect(ISO_4217_LIST_THREE_PUBLISHED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps the exponent ISO gave each code, not a later or rounded one', () => {
    // ISO listed these with 2 decimals even where the minor unit was unused in practice
    for (const code of ['SLL', 'STD', 'MRO', 'ZMK', 'ZWD', 'VEF']) {
      expect(historicCurrency(code)?.exponent).toBe(2);
    }
    for (const code of ['ITL', 'ESP', 'BEF', 'LUF', 'GRD', 'PTE', 'TRL', 'BYR']) {
      expect(historicCurrency(code)?.exponent).toBe(0);
    }
  });

  it('marks non-ISO codes by leaving out the ISO fields', () => {
    expect(historicCurrency('CNH')).toEqual({
      code: 'CNH',
      name: 'Chinese Yuan Renminbi (offshore)',
      exponent: 2,
    });
  });

  it('holds no current ISO code, and no inherited property name', () => {
    for (const entry of historicCurrencies()) {
      expect(entry.code in ISO_EXPONENTS).toBe(false);
    }
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(historicCurrency(name)).toBeUndefined();
    }
    expect(historicCurrency('EUR')).toBeUndefined();
  });

  it('agrees with List Three for every ISO code it has', () => {
    const xml = readFileSync(new URL('../data/iso4217-list-three.xml', import.meta.url), 'utf8');
    for (const entry of historicCurrencies()) {
      if (entry.numeric === undefined) {
        continue;
      }
      const listed = new RegExp(`<Ccy>${entry.code}</Ccy>\\s*<CcyNbr>${entry.numeric}</CcyNbr>`);
      expect(xml).toMatch(listed);
    }
  });
});

describe('defineHistoricCurrencies', () => {
  it('registers nothing until called, then lets Money hold the codes', () => {
    expect(isCurrency('ITL')).toBe(false);
    expect(() => money('1', 'ITL')).toThrow(RangeError);

    defineHistoricCurrencies(['ITL', 'HRK']);
    expect(currencyExponent('ITL')).toBe(0);
    expect(money('1500', 'ITL').toString()).toBe('1500 ITL');
    expect(money('7.53', 'HRK').minor).toBe(753);
    // only the codes asked for
    expect(isCurrency('DEM')).toBe(false);
    // again is harmless
    defineHistoricCurrencies(['HRK']);
  });

  it('checks every code before registering any', () => {
    expect(() => defineHistoricCurrencies(['ATS', 'EUR' as never])).toThrow(
      /EUR is not in the historic currency table/,
    );
    expect(isCurrency('ATS')).toBe(false);
  });

  it('registers them all, so processor listings of withdrawn codes load', () => {
    defineHistoricCurrencies();
    for (const entry of historicCurrencies()) {
      expect(currencyExponent(entry.code)).toBe(entry.exponent);
    }
    expect(toStripeAmount(money('12.34', 'STD'))).toBe(1234);
    expect(toBraintree(money('12.34', 'SLL'))).toBe('12.34');
  });
});
