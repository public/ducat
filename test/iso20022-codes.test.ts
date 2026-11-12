import '../src/plugins/iso.js';
import { describe, expect, it } from 'vitest';
import { defineCryptoCurrencies } from '../src/crypto.js';
import { defineHistoricCurrencies } from '../src/historic.js';
import { defineCurrency, fromMinor, money } from '../src/fn.js';
import { fromIso20022Amount, toIso20022Amount } from '../src/wire.js';

// #273: ISO 20022's ActiveOrHistoricCurrencyCode is ISO 4217, current or withdrawn.
describe('ISO 20022 amounts name only ISO 4217 codes', () => {
  it('refuses a registered non-ISO code such as BTC, both ways', () => {
    defineCryptoCurrencies(['BTC']);
    expect(() => toIso20022Amount(fromMinor(1, 'BTC', 2), 'halfEven')).toThrow(
      'ISO 20022 amounts need an ISO 4217 code, got BTC (a withdrawn code needs defineHistoricCurrencies)',
    );
    expect(() => fromIso20022Amount({ Ccy: 'BTC', value: '1' })).toThrow(RangeError);
  });

  it('refuses CNH, which ISO never published, even from /historic', () => {
    defineHistoricCurrencies(['CNH']);
    expect(() => toIso20022Amount(money('1', 'CNH'))).toThrow(/got CNH/);
    expect(() => fromIso20022Amount({ Ccy: 'CNH', value: '1' })).toThrow(/got CNH/);
  });

  it('accepts a withdrawn ISO code (HRK) once /historic registers it', () => {
    defineHistoricCurrencies(['HRK']);
    expect(toIso20022Amount(money('12.50', 'HRK'))).toEqual({ Ccy: 'HRK', value: '12.50' });
    expect(fromIso20022Amount({ Ccy: 'HRK', value: '12.5' }).toString()).toBe('12.50 HRK');
  });

  it('accepts the ISO codes without a currency, such as XAU, as ISO 4217 lists them', () => {
    // XAU is in List One with "N.A." minor units, so ducat holds it only once a program defines it
    // with the decimals it uses (troy ounces to 3 places here). It is ISO 4217, so ISO 20022 may
    // name it.
    defineCurrency('XAU', 3);
    expect(toIso20022Amount(money('1.5', 'XAU'))).toEqual({ Ccy: 'XAU', value: '1.500' });
    expect(fromIso20022Amount({ Ccy: 'XAU', value: '10' }).toString()).toBe('10.000 XAU');
  });

  it('still reads and writes current codes', () => {
    expect(toIso20022Amount(money('12.34', 'EUR'))).toEqual({ Ccy: 'EUR', value: '12.34' });
    expect(fromIso20022Amount({ Ccy: 'JPY', value: '1000' }).toString()).toBe('1000 JPY');
  });
});
