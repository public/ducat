// Registration for real: vitest gives each file a fresh module registry and there is no global
// setup, so no ISO code is registered until this file imports one.
import { describe, expect, it } from 'vitest';
import { currencyExponent, ISO_EXPONENTS, isCurrency } from '../src/currency.js';
import { add, fromMinor, money, toDecimal } from '../src/fn.js';

// bun test shares one process across files, where another file has registered every code already
const shared = isCurrency('USD');

describe.skipIf(shared)('ISO registration under /fn', () => {
  it('starts with no ISO code', () => {
    expect(isCurrency('EUR')).toBe(false);
    expect(() => money('1', 'EUR')).toThrow(/Unknown currency "EUR".*@ducatjs\/money\/iso/);
  });

  it('@ducatjs/money/iso/<CODE> registers that code only', async () => {
    await import('../src/generated/iso/EUR.js');
    await import('../src/generated/iso/KWD.js');
    expect(toDecimal(add(fromMinor(1250, 'EUR'), fromMinor(1, 'EUR')))).toBe('12.51');
    expect(toDecimal(fromMinor(5, 'KWD'))).toBe('0.005');
    expect(isCurrency('USD')).toBe(false);
    expect(() => fromMinor(1, 'USD')).toThrow(/Unknown currency "USD"/);
  });

  it('@ducatjs/money/iso registers every code, with its ISO exponent', async () => {
    await import('../src/plugins/iso.js');
    for (const [code, exponent] of Object.entries(ISO_EXPONENTS)) {
      expect(currencyExponent(code)).toBe(exponent);
    }
  });
});

it('there is one per-code module per ISO 4217 code', async () => {
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(new URL('../src/generated/iso/', import.meta.url));
  expect(files.map((name) => name.replace(/\.ts$/, '')).sort()).toEqual(
    Object.keys(ISO_EXPONENTS).sort(),
  );
});
