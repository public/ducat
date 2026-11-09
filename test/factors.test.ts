import { describe, expect, it } from 'vitest';
import { money, ratio, type Factor } from '../src/index.js';
import { exact } from '../src/exact.js';
import { fixed } from '../src/fixed.js';
import { addTax, discount, extractTax, percentage } from '../src/tax.js';
import { convert } from '../src/convert.js';
import { exchangeRate } from '../src/rate.js';

// Values untyped code passes as factors. Each used to fail later with an unrelated BigInt error, or
// came back from ratio() unchanged as if it were a Ratio.
const notFactors: [string, unknown][] = [
  ['a Fixed lookalike with a negative scale', { value: 5, scale: -1 }],
  ['a Fixed lookalike with a fractional scale', { value: 5, scale: 0.5 }],
  ['an object of numbers', { num: 1, den: 2 }],
  ['an empty object', {}],
  ['null', null],
  ['undefined as the only argument', undefined],
  ['a boolean', true],
  ['an array', [1, 2]],
  ['a Money', money('1', 'EUR')],
];
const message = /^Expected a number, bigint, decimal string, Ratio or Fixed, got /;

describe('values that are not factors throw a TypeError at the boundary', () => {
  const eur = money('10', 'EUR');
  const uses: [string, (factor: Factor) => unknown][] = [
    ['ratio', (factor) => ratio(factor)],
    ['ratio as a denominator', (factor) => ratio(1, factor)],
    ['Money#multiply', (factor) => eur.multiply(factor)],
    ['Money#divide', (factor) => eur.divide(factor)],
    ['ExactMoney#multiply', (factor) => exact(eur).multiply(factor)],
    ['ExactMoney#divide', (factor) => exact(eur).divide(factor)],
    ['Fixed#multiply', (factor) => fixed('2').multiply(factor as never)],
    ['percentage', (factor) => percentage(eur, factor)],
    ['discount', (factor) => discount(eur, factor)],
    ['addTax', (factor) => addTax(eur, factor)],
    ['extractTax', (factor) => extractTax(eur, factor)],
    ['convert', (factor) => convert(eur, 'USD', factor)],
    ['exchangeRate', (factor) => exchangeRate('EUR', 'USD', factor)],
    ['Rate#withMargin', (factor) => exchangeRate('EUR', 'USD', '1.1').withMargin(factor)],
  ];
  for (const [name, use] of uses) {
    for (const [label, value] of notFactors) {
      // undefined means "no denominator" or "default", not a bad factor, in a second position.
      if (name === 'ratio as a denominator' && value === undefined) {
        continue;
      }
      it(`${name} with ${label}`, () => {
        expect(() => use(value as Factor)).toThrow(TypeError);
        expect(() => use(value as Factor)).toThrow(message);
      });
    }
  }

  it('names what was passed', () => {
    expect(() => ratio(money('1', 'EUR') as never)).toThrow('got object 1.00 EUR');
    expect(() => ratio(null as never)).toThrow('got object null');
    expect(() => ratio(true as never)).toThrow('got boolean true');
  });

  it('a string that is not a decimal is a SyntaxError, as in money()', () => {
    expect(() => ratio('abc')).toThrow(SyntaxError);
    expect(() => eur.multiply('1,5')).toThrow('Invalid decimal string "1,5"');
    expect(() => percentage(eur, '10%')).toThrow(SyntaxError);
  });

  it('a hand-made Ratio of bigints is rebuilt, reduced and with its number fields', () => {
    const handMade = { num: 2n, den: 4n } as never;
    const rebuilt = ratio(handMade);
    expect([rebuilt.num, rebuilt.den, rebuilt.n, rebuilt.d]).toEqual([1n, 2n, 1, 2]);
    expect(eur.multiply(handMade).toString()).toBe('5.00 EUR');
    expect(() => ratio({ num: 1n, den: 0n } as never)).toThrow('Division by zero');
  });

  it('ratios from ratio() still pass through unchanged', () => {
    const half = ratio('1/2');
    expect(ratio(half)).toBe(half);
  });
});
