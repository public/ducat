// every ISO 4217 code: this file builds Money from /fn-level modules, which don't register them
import '../src/plugins/iso.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cashUnit } from '../src/cash.js';
import {
  currencyFromNumeric,
  currencyName,
  currencySymbol,
  minorUnit,
  numericCode,
} from '../src/currencies.js';
import { ISO_EXPONENTS } from '../src/currency.js';
import { ISO_NUMERIC_CODES } from '../src/generated/iso4217-numeric.js';
import { currencyTerritories, territoryCurrencies } from '../src/territories.js';

describe('numeric codes', () => {
  it('map both ways, three digits as published', () => {
    expect(numericCode('EUR')).toBe('978');
    expect(numericCode('ALL')).toBe('008');
    expect(numericCode('XAU')).toBe('959');
    expect(numericCode('HRK')).toBeUndefined();
    expect(numericCode('toString')).toBeUndefined();
    expect(currencyFromNumeric('978')).toBe('EUR');
    expect(currencyFromNumeric(978)).toBe('EUR');
    expect(currencyFromNumeric('008')).toBe('ALL');
    expect(currencyFromNumeric('8')).toBe('ALL');
    expect(currencyFromNumeric(8)).toBe('ALL');
    expect(currencyFromNumeric(' 840 ')).toBe('USD');
    expect(currencyFromNumeric('000')).toBeUndefined();
  });

  it('reject what is not a numeric code', () => {
    for (const bad of ['', '1000', '97.8', '-1', 'EUR', 9.5, -8, 1000, Number.NaN]) {
      expect(() => currencyFromNumeric(bad)).toThrow(RangeError);
    }
  });

  it('round-trip for every active code, and every numeric code is unique', () => {
    const codes = Object.entries(ISO_NUMERIC_CODES);
    expect(codes.length).toBeGreaterThan(170);
    expect(new Set(codes.map(([, numeric]) => numeric)).size).toBe(codes.length);
    for (const [currency, numeric] of codes) {
      expect(numeric).toMatch(/^\d{3}$/);
      expect(currencyFromNumeric(numeric)).toBe(currency);
      expect(currencyFromNumeric(Number(numeric))).toBe(currency);
    }
    // every currency with an exponent has a numeric code
    expect(Object.keys(ISO_EXPONENTS).filter((code) => numericCode(code) === undefined)).toEqual(
      [],
    );
  });

  it('match the ISO 4217 List One snapshot', () => {
    const xml = readFileSync(new URL('../data/iso4217-list-one.xml', import.meta.url), 'utf8');
    for (const match of xml.matchAll(/<Ccy>([A-Z]{3})<\/Ccy>\s*<CcyNbr>(\d{3})<\/CcyNbr>/g)) {
      expect(numericCode(match[1]!)).toBe(match[2]);
    }
  });

  it('never return a code for an unassigned number (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), (numeric) => {
        const currency = currencyFromNumeric(numeric);
        if (currency !== undefined) {
          expect(Number(numericCode(currency))).toBe(numeric);
        }
      }),
    );
  });
});

describe('minor unit and smallest cash step', () => {
  it('follows the exponent', () => {
    expect(minorUnit('EUR')).toBe('0.01');
    expect(minorUnit('JPY')).toBe('1');
    expect(minorUnit('KWD')).toBe('0.001');
    expect(minorUnit('CLF')).toBe('0.0001');
    expect(() => minorUnit('ZZZ')).toThrow(RangeError);
  });

  it('cashUnit uses the cash rules, and the minor unit without one', () => {
    expect(cashUnit('CHF')).toBe('0.05');
    expect(cashUnit('SEK')).toBe('1.00');
    expect(cashUnit('DKK')).toBe('0.50');
    expect(cashUnit('EUR', { country: 'NL' })).toBe('0.05');
    expect(cashUnit('EUR')).toBe('0.01');
    // US penny production ended in 2025; that rule is backed only by secondary sources
    expect(cashUnit('USD')).toBe('0.05');
    expect(cashUnit('USD', { includeUnverified: false })).toBe('0.01');
    expect(cashUnit('GBP')).toBe('0.01');
    expect(cashUnit('JPY')).toBe('1');
    expect(() => cashUnit('ZZZ')).toThrow(RangeError);
  });
});

describe('names and symbols come from Intl', () => {
  it('names per locale', () => {
    expect(currencyName('EUR', 'en')).toBe(
      new Intl.DisplayNames('en', { type: 'currency' }).of('EUR'),
    );
    expect(currencyName('EUR', 'en')).toBe('Euro');
    expect(currencyName('CHF', 'fr')).toBe('franc suisse');
    expect(currencyName('QQQ', 'en')).toBeUndefined();
  });

  it('symbols per locale, standard and narrow', () => {
    expect(currencySymbol('EUR', 'en-US')).toBe('€');
    expect(currencySymbol('USD', 'en-US')).toBe('$');
    expect(currencySymbol('USD', 'en-CA')).toBe('US$');
    expect(currencySymbol('USD', 'en-CA', { display: 'narrow' })).toBe('$');
    expect(currencySymbol('QQQ', 'en-US')).toBe('QQQ');
  });
});

describe('territories (CLDR)', () => {
  it('lists the currencies a territory uses or used, newest first', () => {
    expect(territoryCurrencies('DE')).toEqual([
      { currency: 'EUR', from: '1999-01-01', tender: true },
      { currency: 'DEM', from: '1948-06-20', to: '2002-02-28', tender: true },
    ]);
    expect(territoryCurrencies('DE', { on: '1990-01-01' }).map((use) => use.currency)).toEqual([
      'DEM',
    ]);
    expect(territoryCurrencies('DE', { on: '2001-06-01' }).map((use) => use.currency)).toEqual([
      'EUR',
      'DEM',
    ]);
    expect(territoryCurrencies('DE', { on: '2026-11-08' }).map((use) => use.currency)).toEqual([
      'EUR',
    ]);
  });

  it('leaves non-tender codes out unless asked', () => {
    expect(territoryCurrencies('CH').map((use) => use.currency)).toEqual(['CHF']);
    expect(
      territoryCurrencies('CH', { includeNonTender: true }).map((use) => [
        use.currency,
        use.tender,
      ]),
    ).toEqual([
      ['CHF', true],
      ['CHE', false],
      ['CHW', false],
    ]);
  });

  it('goes the other way, and knows nothing of unknown territories', () => {
    expect(currencyTerritories('CHF', { on: '2026-11-08' })).toEqual(['CH', 'LI']);
    expect(currencyTerritories('EUR', { on: '2026-11-08' })).toContain('HR');
    expect(currencyTerritories('EUR', { on: '2020-01-01' })).not.toContain('HR');
    expect(currencyTerritories('DEM')).toContain('DE');
    expect(currencyTerritories('DEM', { on: '2026-11-08' })).toEqual([]);
    expect(territoryCurrencies('QQ')).toEqual([]);
    expect(territoryCurrencies('toString')).toEqual([]);
  });

  it('rejects a day that is not YYYY-MM-DD', () => {
    expect(() => territoryCurrencies('DE', { on: '2001-6-1' })).toThrow(
      "Invalid day 2001-6-1; expected 'YYYY-MM-DD'",
    );
    expect(() => currencyTerritories('EUR', { on: 'today' })).toThrow(RangeError);
  });

  it('every territory in use today has a current ISO currency', () => {
    for (const territory of ['US', 'GB', 'JP', 'FR', 'IN', 'BR', 'ZA', 'AU']) {
      const current = territoryCurrencies(territory, { on: '2026-11-08' });
      expect(current.length).toBeGreaterThan(0);
      expect(current.every((use) => use.currency in ISO_EXPONENTS)).toBe(true);
    }
  });
});
