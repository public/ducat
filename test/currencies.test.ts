import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  currencyExponent,
  format,
  fromMinor,
  ISO_4217_PUBLISHED,
  ISO_EXPONENTS,
  ISO_NON_MONETARY,
} from '../src/index.js';

describe('ISO 4217 table', () => {
  it('generated table is up to date with data/', () => {
    execFileSync(process.execPath, ['scripts/gen-currencies.mjs', '--check']);
  });
  it('known exponents', () => {
    expect(ISO_4217_PUBLISHED).toBe('2026-09-17');
    const expect0 = [
      'BIF',
      'CLP',
      'DJF',
      'GNF',
      'ISK',
      'JPY',
      'KMF',
      'KRW',
      'PYG',
      'RWF',
      'UGX',
      'UYI',
      'VND',
      'VUV',
      'XAF',
      'XOF',
      'XPF',
    ];
    const expect3 = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
    const expect4 = ['CLF', 'UYW'];
    for (const [c, e] of Object.entries(ISO_EXPONENTS)) {
      const want = expect0.includes(c) ? 0 : expect3.includes(c) ? 3 : expect4.includes(c) ? 4 : 2;
      expect([c, e]).toEqual([c, want]);
    }
    expect(currencyExponent('ZWG')).toBe(2);
    expect(currencyExponent('XCG')).toBe(2);
    expect(() => currencyExponent('HRK')).toThrow(); // withdrawn 2023
    expect(() => currencyExponent('BGN')).toThrow(); // withdrawn 2026 (Bulgaria joined the euro)
    expect(ISO_NON_MONETARY).toContain('XAU');
  });
  it('format() shows ISO digits on every engine, whatever CLDR default the engine has', () => {
    // Engines disagree on Intl's default currency digits: V8 (CLDR) shows ALL, IQD, LAK, RSD, ... with
    // 0 decimals; JSC (Bun/Safari) shows ISO digits. We never rely on the default.
    for (const [c, e] of Object.entries(ISO_EXPONENTS)) {
      let s: string;
      try {
        s = format(fromMinor(123456, c), 'en-US', { currencyDisplay: 'code', useGrouping: false });
      } catch {
        continue;
      }
      const digits = /\.(\d+)/.exec(s)?.[1]?.length ?? 0;
      expect([c, digits]).toEqual([c, e]);
    }
  });
});
