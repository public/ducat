// data/cash-rounding.json against CLDR's cash data (data/cldr-cash.json, refreshed by
// scripts/fetch-cldr-cash.mjs), the second source. Every currency CLDR cash-rounds must have the same
// step in the table, unless the difference is listed below with the reason. The table also has
// rules CLDR lacks (AUD, NZD, EUR by country...): CLDR's list is incomplete, so those aren't checked.
// every ISO 4217 code: this file builds Money from /fn-level modules, which don't register them
import '../src/plugins/iso.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CASH_RULES, currencyDigits, currencyExponent, ISO_EXPONENTS } from '../src/fn.js';

interface CldrCash {
  readonly digits: number;
  readonly cashDigits: number;
  readonly cashRounding: number;
}
const cldr = JSON.parse(readFileSync(new URL('../data/cldr-cash.json', import.meta.url), 'utf8'))
  .currencies as Record<string, CldrCash>;

/**
 * Where the national source and CLDR disagree: the table follows the national source. `cldr` pins
 * CLDR's step (in minor units), so a CLDR update that changes it is noticed.
 */
const KNOWN_DIFFERENCES: Record<string, { cldr: number; reason: string }> = {
  AMD: { cldr: 100, reason: 'the smallest circulating coin is 10 dram (Central Bank of Armenia)' },
  CRC: { cldr: 100, reason: 'the smallest coin is 10 colones from 1 July 2026 (BCCR)' },
  TZS: { cldr: 100, reason: 'the smallest coin issued is 50 shillings (Bank of Tanzania)' },
  UZS: {
    cldr: 100,
    reason: 'the smallest circulating coin is 50 sum (Central Bank of Uzbekistan)',
  },
  MUR: {
    cldr: 100,
    reason:
      'no rule yet: the Bank of Mauritius does not list its coins, and secondary sources say the 5 ' +
      'cent coin still circulates, so whole rupees is not supported',
  },
};

/** CLDR's cash step for a currency, in its ISO minor units. */
function cldrStep(code: string, entry: CldrCash): number {
  const unitsOfLastDigit = entry.cashRounding === 0 ? 1 : entry.cashRounding;
  return unitsOfLastDigit * 10 ** (currencyExponent(code) - entry.cashDigits);
}

describe('cash rounding against CLDR', () => {
  it('every ISO currency CLDR cash-rounds has the same step in the table', () => {
    const disagreements: string[] = [];
    for (const [code, entry] of Object.entries(cldr)) {
      // withdrawn codes CLDR still carries (VEF)
      if (!(code in ISO_EXPONENTS)) {
        continue;
      }
      const step = cldrStep(code, entry);
      const steps = CASH_RULES.filter((rule) => rule.currency === code).map(
        (rule) => rule.increment,
      );
      const known = KNOWN_DIFFERENCES[code];
      if (known !== undefined) {
        if (step !== known.cldr) {
          disagreements.push(
            `${code}: CLDR now has ${step}, the listed difference says ${known.cldr}`,
          );
        }
        continue;
      }
      if (!steps.includes(step)) {
        const ours = steps.length === 0 ? 'no rule' : steps.join(', ');
        disagreements.push(`${code}: CLDR ${step} minor units, table ${ours}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('lists only differences that still exist', () => {
    for (const code of Object.keys(KNOWN_DIFFERENCES)) {
      expect([code, cldr[code] !== undefined]).toEqual([code, true]);
      const steps = CASH_RULES.filter((rule) => rule.currency === code).map(
        (rule) => rule.increment,
      );
      expect([code, steps.includes(cldrStep(code, cldr[code]!))]).toEqual([code, false]);
    }
  });

  it('currencyDigits for cash matches CLDR cashDigits where the steps agree', () => {
    for (const [code, entry] of Object.entries(cldr)) {
      if (!(code in ISO_EXPONENTS) || code in KNOWN_DIFFERENCES) {
        continue;
      }
      expect([code, currencyDigits(code, { usage: 'cash' })]).toEqual([code, entry.cashDigits]);
    }
  });
});

describe('currencyDigits', () => {
  it('is the ISO exponent by default, and the cash step decimals for cash', () => {
    expect(currencyDigits('SEK')).toBe(2);
    expect(currencyDigits('SEK', { usage: 'cash' })).toBe(0);
    expect(currencyDigits('CHF', { usage: 'cash' })).toBe(2);
    expect(currencyDigits('DKK', { usage: 'cash' })).toBe(2);
    expect(currencyDigits('UZS', { usage: 'cash' })).toBe(0);
    expect(currencyDigits('HUF', { usage: 'cash' })).toBe(0);
    expect(currencyDigits('JPY', { usage: 'cash' })).toBe(0);
    expect(currencyDigits('GBP', { usage: 'cash' })).toBe(2);
    // EUR has rules only by country, and none needs fewer decimals
    expect(currencyDigits('EUR', { usage: 'cash', country: 'NL' })).toBe(2);
    // unverified rules can be left out, as in cashRound
    expect(currencyDigits('INR', { usage: 'cash' })).toBe(0);
    expect(currencyDigits('INR', { usage: 'cash', includeUnverified: false })).toBe(2);
    expect(() => currencyDigits('XYZ')).toThrow(RangeError);
  });
});
