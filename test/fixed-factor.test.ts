import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { money, ratio, type Factor, type RoundingMode } from '../src/index.js';
import { exact } from '../src/exact.js';
import { fixed, fromScaled } from '../src/fixed.js';
import { addTax, discount, extractTax, percentage } from '../src/tax.js';
import { convert } from '../src/convert.js';
import { exchangeRate } from '../src/rate.js';

const modes: RoundingMode[] = ['halfExpand', 'halfEven', 'floor', 'ceil', 'trunc'];

describe('a Fixed is a factor', () => {
  it('gives the same results as its decimal string, wherever a factor goes', () => {
    const rate = fixed('0.0725');
    const eur = money('199.99', 'EUR');
    const pairs: [string, (factor: Factor) => unknown][] = [
      ['multiply', (factor) => eur.multiply(factor, 'halfEven').toString()],
      ['divide', (factor) => eur.divide(factor, 'halfEven').toString()],
      ['ratio', (factor) => ratio(factor)],
      ['ratio as a denominator', (factor) => ratio(1, factor)],
      ['ExactMoney#multiply', (factor) => exact(eur).multiply(factor).toString()],
      ['ExactMoney#divide', (factor) => exact(eur).divide(factor).toString()],
      ['Fixed#multiply', (factor) => fixed('3.5').multiply(factor, 'halfEven').toString()],
      ['percentage', (factor) => percentage(eur, factor).toString()],
      ['discount', (factor) => discount(eur, factor).toString()],
      ['addTax', (factor) => addTax(eur, factor).gross.toString()],
      ['extractTax', (factor) => extractTax(eur, factor).net.toString()],
      ['convert', (factor) => convert(eur, 'USD', factor, 'halfEven').toString()],
      ['exchangeRate', (factor) => exchangeRate('EUR', 'USD', factor).ratio],
      ['withMargin', (factor) => exchangeRate('EUR', 'USD', '1.1').withMargin(factor).ratio],
    ];
    const withFixed = pairs.map(([name, use]) => [name, use(rate)]);
    const withString = pairs.map(([name, use]) => [name, use('0.0725')]);
    expect(withFixed).toEqual(withString);
  });

  it('keeps every digit of its scale, and works beyond 2^53', () => {
    expect(ratio(fixed('0.50'))).toEqual(ratio('1/2'));
    expect(ratio(fixed('-1.075'))).toEqual(ratio('-1.075'));
    const big = fromScaled(2n ** 70n + 1n, 3);
    expect(ratio(big)).toEqual(ratio(`${2n ** 70n + 1n}/1000`));
    expect(fixed('0.0725').toRatio()).toEqual(ratio('29/400'));
  });

  it('a rate kept at a scale and rounding (fixed(v, { scale, rounding })) multiplies directly', () => {
    const rate = fixed(0.123456, { scale: 5, rounding: 'halfExpand' });
    expect(money('1000', 'CHF').multiply(rate).toString()).toBe('123.46 CHF');
    expect(exact(money('1000', 'CHF')).multiply(rate).round('floor').toString()).toBe('123.46 CHF');
  });

  it('property: a Fixed and its decimal string are the same factor', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.constantFrom(...modes),
        (scaled, scale, minor, mode) => {
          const factor = fromScaled(scaled, scale);
          const amount = money(String(minor), 'EUR');
          expect(ratio(factor)).toEqual(ratio(factor.toString()));
          expect(amount.multiply(factor, mode).toString()).toBe(
            amount.multiply(factor.toString(), mode).toString(),
          );
          if (scaled !== 0n) {
            expect(amount.divide(factor, mode).toString()).toBe(
              amount.divide(factor.toString(), mode).toString(),
            );
          }
        },
      ),
    );
  });
});
