import '../src/plugins/all.js';
import { describe, expect, it } from 'vitest';
import { defineCurrency } from '../src/fn.js';
defineCurrency('BTC', 8);
import fc from 'fast-check';
import {
  add,
  addTax,
  convert,
  discount,
  equals,
  exchangeRate,
  extractTax,
  fromMinor,
  money,
  percentage,
  toDecimal,
  type Money,
} from '../src/fn.js';

const d = (m: Money) => toDecimal(m);
const gbp = (s: string) => money(s, 'GBP');

describe('percentages, tax and discounts', () => {
  it('percentage', () => {
    expect(d(percentage(money('80', 'EUR'), '12.5'))).toBe('10.00');
    expect(d(percentage(money('9.99', 'EUR'), 15, 'halfEven'))).toBe('1.50');
    expect(d(percentage(money('9.99', 'EUR'), 15))).toBe('1.50'); // 1.4985, default halfExpand
    expect(() => percentage(money('9.99', 'EUR'), 15, 'unnecessary')).toThrow();
  });
  it('UK VAT 20%: exclusive and inclusive', () => {
    const t = addTax(gbp('10'), 20);
    expect([d(t.net), d(t.tax), d(t.gross)]).toEqual(['10.00', '2.00', '12.00']);
    const x = extractTax(gbp('12'), 20, 'halfEven');
    expect([d(x.net), d(x.tax)]).toEqual(['10.00', '2.00']);
    // HMRC VAT fraction 1/6 of a VAT-inclusive 9.99: net 8.325 -> 8.32 (halfEven) / 8.33 (halfExpand)
    expect(d(extractTax(gbp('9.99'), 20, 'halfEven').tax)).toBe('1.67');
    expect(d(extractTax(gbp('9.99'), 20, 'halfExpand').net)).toBe('8.33');
  });
  it('German 19% and reduced 7%', () => {
    expect(d(extractTax(money('119', 'EUR'), 19, 'halfExpand').net)).toBe('100.00');
    expect(d(extractTax(money('10.70', 'EUR'), 7, 'halfExpand').tax)).toBe('0.70');
    expect(d(addTax(money('0.99', 'EUR'), '19', 'halfExpand').tax)).toBe('0.19');
  });
  it('property: tax breakdowns always add up', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e12 }),
        fc.constantFrom('20', '19', '7', '5.5', '8.1', '0', '25', '17.5'),
        (amt, rate) => {
          const g = fromMinor(amt, 'EUR');
          const x = extractTax(g, rate, 'halfEven');
          expect(equals(add(x.net, x.tax), g)).toBe(true);
          const a = addTax(g, rate, 'halfEven');
          expect(equals(add(a.net, a.tax), a.gross)).toBe(true);
        },
      ),
    );
  });
  it('discount', () => {
    expect(d(discount(money('19.99', 'EUR'), 10, 'halfEven'))).toBe('17.99');
    expect(d(discount(money('19.99', 'EUR'), '33.33', 'halfEven'))).toBe('13.33');
  });
});

describe('currency conversion', () => {
  it('converts with an exact rate string and one rounding', () => {
    expect(d(convert(money('100', 'EUR'), 'USD', '1.0832', 'halfEven'))).toBe('108.32');
    expect(d(convert(money('100', 'EUR'), 'JPY', '162.457', 'halfEven'))).toBe('16246');
    expect(d(convert(money('1000', 'JPY'), 'KWD', '0.002034', 'halfEven'))).toBe('2.034');
    expect(d(convert(money('1', 'BTC', { scale: 8 }), 'USD', '67250.12345678', 'halfEven'))).toBe(
      '67250.12',
    );
    expect(() => convert(money('1', 'EUR'), 'USD', '0')).toThrow();
    expect(d(convert(money('1', 'EUR'), 'USD', '1.0832'))).toBe('1.08'); // default halfExpand
    expect(() => convert(money('1', 'EUR'), 'USD', '1.0832', 'unnecessary')).toThrow();
  });
  it('exchangeRate pins the pair', () => {
    const r = exchangeRate('EUR', 'USD', '1.25');
    expect(d(r.convert(money('10', 'EUR')))).toBe('12.50');
    expect(d(r.inverse().convert(money('12.50', 'USD')))).toBe('10.00');
    // @ts-expect-error a EUR→USD rate cannot convert GBP
    expect(() => r.convert(money('1', 'GBP'))).toThrow();
  });
});
