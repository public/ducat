import { describe, expect, it } from 'vitest';
import { money, ratio } from '../src/index.js';
import { fixed } from '../src/fixed.js';

// The grammar of a decimal string: [+-]? digits ( . digits )? ( [eE] [+-]? digits )?
const accepted: [string, string][] = [
  ['12.34', '12.34'],
  ['-12.34', '-12.34'],
  ['+7', '7'],
  ['007.50', '7.50'],
  ['1e-7', '0.0000001'],
  ['1.5E3', '1500'],
  ['125e-2', '1.25'],
  ['1e+2', '100'],
  ['-0.5e1', '-5'],
];
const refused = [
  '.5',
  '5.',
  '-.5',
  '+',
  '-',
  '',
  ' 12.34',
  '12.34 ',
  '\t1',
  '1\n',
  ' 1e-7',
  '1e-7 ',
  '1,000',
  '1_000',
  '1 000',
  '١٢',
  '1e',
  '1e+',
  'e5',
  '1.2.3',
  '0x10',
  'Infinity',
  'NaN',
  '1.5e3.0',
];

describe('the decimal-string grammar', () => {
  it('fixed() accepts the grammar, keeping the scale', () => {
    for (const [input, expected] of accepted) {
      expect(fixed(input).toString()).toBe(expected);
    }
  });
  it('money() and ratio() accept the same strings', () => {
    for (const [input, expected] of accepted) {
      expect(money(input, 'EUR', { scale: 7 }).toDecimal()).toBe(
        fixed(expected).toScale(7).toString(),
      );
      expect(ratio(input)).toEqual(ratio(expected));
    }
  });
  it('refuses everything else, the same way in each, whitespace included', () => {
    for (const input of refused) {
      expect(() => money(input, 'EUR')).toThrow(SyntaxError);
    }
    for (const input of refused) {
      expect(() => fixed(input)).toThrow(SyntaxError);
    }
    for (const input of refused) {
      expect(() => ratio(input)).toThrow(SyntaxError);
    }
  });
  it('a ratio string is two decimals around a slash, without spaces', () => {
    expect(ratio('1/3')).toEqual(ratio(1, 3));
    expect(ratio('1.5/-2')).toEqual(ratio(-3, 4));
    expect(() => ratio(' 1/3')).toThrow(SyntaxError);
    expect(() => ratio('1 / 3')).toThrow(SyntaxError);
  });
  it('bounds the exponent and the decimal places it makes at 1000', () => {
    expect(fixed('1e1000').toString()).toBe(`1${'0'.repeat(1000)}`);
    expect(fixed('1e-1000').scale).toBe(1000);
    expect(() => fixed('1e1001')).toThrow(RangeError);
    expect(() => money('1e-1001', 'EUR', { rounding: 'halfEven' })).toThrow(RangeError);
  });
});
