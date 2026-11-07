import '../src/plugins/all.js';
import { describe, expect, it } from 'vitest';
import { CASH_RULES, cashRound, cashRule, money, roundToIncrement, toDecimal } from '../src/fn.js';

const cr = (amt: string, cur: string, country?: string) =>
  toDecimal(cashRound(money(amt, cur), country ? { country } : undefined));

describe('cash rounding', () => {
  it('CHF to 0.05', () => {
    expect(['10.01', '10.02', '10.03', '10.04', '10.07', '10.08'].map((a) => cr(a, 'CHF'))).toEqual(
      ['10.00', '10.00', '10.05', '10.05', '10.05', '10.10'],
    );
  });
  it('SEK and NOK to whole kronor (1-49 down, 50-99 up)', () => {
    expect([cr('10.49', 'SEK'), cr('10.50', 'SEK'), cr('10.99', 'SEK')]).toEqual([
      '10.00',
      '11.00',
      '11.00',
    ]);
    expect([cr('10.49', 'NOK'), cr('10.50', 'NOK')]).toEqual(['10.00', '11.00']);
  });
  it('DKK to 0.50 (1-24 down, 25-74 to 50, 75-99 up)', () => {
    expect(['0.24', '0.25', '0.74', '0.75'].map((a) => cr(a, 'DKK'))).toEqual([
      '0.00',
      '0.50',
      '0.50',
      '1.00',
    ]);
  });
  it('CAD and AUD to 0.05, NZD to 0.10', () => {
    expect(
      ['1.01', '1.02', '1.03', '1.04', '1.06', '1.07', '1.08', '1.09'].map((a) => cr(a, 'CAD')),
    ).toEqual(['1.00', '1.00', '1.05', '1.05', '1.05', '1.05', '1.10', '1.10']);
    expect(cr('1.02', 'AUD')).toBe('1.00');
    expect([cr('1.04', 'NZD'), cr('1.05', 'NZD'), cr('1.06', 'NZD')]).toEqual([
      '1.00',
      '1.10',
      '1.10',
    ]);
  });
  it('HUF to 5 forint, CZK to whole koruna', () => {
    expect(['1', '2', '3', '4', '6', '7', '8', '9'].map((a) => cr(a, 'HUF'))).toEqual([
      '0.00',
      '0.00',
      '5.00',
      '5.00',
      '5.00',
      '5.00',
      '10.00',
      '10.00',
    ]);
    expect(cr('10.50', 'CZK')).toBe('11.00');
  });
  it('EUR only by country', () => {
    expect(cr('1.02', 'EUR')).toBe('1.02');
    expect(cr('1.02', 'EUR', 'BE')).toBe('1.00');
    expect(cr('1.03', 'EUR', 'NL')).toBe('1.05');
    expect(cr('1.03', 'EUR', 'DE')).toBe('1.03');
    expect(cashRule('EUR', 'FI')?.increment).toBe(5);
  });
  it('currencies without a rule are unchanged; unverified rules can be excluded', () => {
    expect(cr('1.01', 'GBP')).toBe('1.01');
    expect(toDecimal(cashRound(money('10.03', 'CHF'), { includeUnverified: false }))).toBe('10.03');
    expect(toDecimal(cashRound(money('10.49', 'SEK'), { includeUnverified: false }))).toBe('10.00');
  });
  it('roundToIncrement with any increment and mode', () => {
    expect(toDecimal(roundToIncrement(money('7.13', 'EUR'), money('0.25', 'EUR'), 'ceil'))).toBe(
      '7.25',
    );
    expect(toDecimal(roundToIncrement(money('-1.03', 'CHF'), money('0.05', 'CHF')))).toBe('-1.05');
    expect(toDecimal(roundToIncrement(money('1234', 'JPY'), money('100', 'JPY'), 'floor'))).toBe(
      '1200',
    );
  });
  it('every rule increment is a positive whole number of minor units', () => {
    for (const r of CASH_RULES) expect(Number.isInteger(r.increment) && r.increment > 0).toBe(true);
  });
});

describe('cashRule lookup', () => {
  // The linear scan cashRule used before it indexed the table by currency, kept as the reference.
  function scanReference(currency: string, country?: string) {
    let found: (typeof CASH_RULES)[number] | undefined;
    for (const rule of CASH_RULES) {
      if (rule.currency !== currency) {
        continue;
      }
      if (country !== undefined) {
        if (rule.countries.includes(country)) {
          return rule;
        }
      } else if (currency !== 'EUR') {
        found ??= rule;
      }
    }
    return found;
  }

  it('agrees with a full scan for every currency and country, including codes with no rule', () => {
    const currencies = [
      ...new Set(CASH_RULES.map((rule) => rule.currency)),
      'GBP',
      'JPY',
      'XXX',
      'toString',
      '',
    ];
    const countries = [
      undefined,
      ...new Set(CASH_RULES.flatMap((rule) => rule.countries)),
      'DE',
      'GB',
      'ZZ',
    ];
    const mismatches: string[] = [];
    for (const currency of currencies) {
      for (const country of countries) {
        if (cashRule(currency, country) !== scanReference(currency, country)) {
          mismatches.push(`${currency}/${country}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('has no rule for currencies without cash rounding, or for EUR without a country', () => {
    expect(cashRule('GBP')).toBeUndefined();
    expect(cashRule('JPY')).toBeUndefined();
    expect(cashRule('toString')).toBeUndefined();
    expect(cashRule('EUR')).toBeUndefined();
    expect(cashRule('EUR', 'DE')).toBeUndefined();
    expect(cashRule('CHF', 'DE')).toBeUndefined();
    expect(cashRule('EUR', 'NL')?.countries).toEqual(['NL']);
    expect(toDecimal(cashRound(money('1.03', 'GBP')))).toBe('1.03');
    expect(toDecimal(cashRound(money('1.03', 'EUR')))).toBe('1.03');
  });
});
