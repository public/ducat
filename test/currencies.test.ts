import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { currencyExponent, ISO_4217_PUBLISHED, ISO_EXPONENTS, ISO_NON_MONETARY } from '../src/index.js';

describe('ISO 4217 table', () => {
  it('generated table is up to date with data/', () => {
    execFileSync(process.execPath, ['scripts/gen-currencies.mjs', '--check']);
  });
  it('known exponents', () => {
    expect(ISO_4217_PUBLISHED).toBe('2026-09-17');
    const expect0 = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
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
  it('differences from CLDR (what Intl.NumberFormat shows by default) are the known ones', () => {
    const diffs: string[] = [];
    for (const [c, e] of Object.entries(ISO_EXPONENTS)) {
      let cldr: number;
      try { cldr = new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits!; } catch { continue; }
      if (cldr !== e) diffs.push(`${c}:${e}/${cldr}`);
    }
    // CLDR drops decimals that are not used in practice. We always use ISO (or a processor table).
    // The exact set depends on the engine's CLDR version, so only assert the stable core.
    for (const d of ['ALL:2/0', 'IQD:3/0', 'LAK:2/0', 'LBP:2/0', 'MMK:2/0', 'RSD:2/0', 'SOS:2/0', 'SYP:2/0', 'YER:2/0', 'IRR:2/0'])
      expect(diffs).toContain(d);
  });
});
