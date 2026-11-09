import { describe, expect, it } from 'vitest';
import { fromMinor, money, zero } from '../src/index.js';
import { round, toScale } from '../src/fn.js';
import { exact } from '../src/exact.js';
import { trimScale } from '../src/math.js';
import { roundingPolicy } from '../src/policy.js';
import { convert } from '../src/convert.js';
import { exchangeRate } from '../src/rate.js';
import { fixed, fromScaled } from '../src/fixed.js';

// Scales are integers from 0 to 1000. Rounding to tens or hundreds is an increment, never a
// negative scale.
const badScales = [-2, -1, 1.5, 1001, NaN, Infinity];
const message = (scale: number) => `Invalid scale ${scale}: use an integer from 0 to 1000`;

describe('every function taking a scale validates it the same way', () => {
  const chf = money('12345', 'CHF');
  const uses: [string, (scale: number) => unknown][] = [
    ['money', (scale) => money('1', 'CHF', { scale })],
    ['fromMinor', (scale) => fromMinor(1, 'CHF', scale)],
    ['zero', (scale) => zero('CHF', scale)],
    ['toScale', (scale) => toScale(chf, scale)],
    ['round', (scale) => round(chf, 'floor', scale)],
    ['Money#round', (scale) => chf.round('floor', scale)],
    ['ExactMoney#round', (scale) => exact(chf).round('floor', scale)],
    ['ExactMoney#isExact', (scale) => exact(chf).isExact(scale)],
    ['ExactMoney#roundWithResidual', (scale) => exact(chf).roundWithResidual('floor', scale)],
    ['trimScale', (scale) => trimScale(chf, scale)],
    ['roundingPolicy', (scale) => roundingPolicy({ scale, rounding: 'floor' })],
    ['convert', (scale) => convert(chf, 'EUR', '1.05', 'halfEven', { scale })],
    [
      'Rate#convert',
      (scale) => exchangeRate('CHF', 'EUR', '1.05').convert(chf, 'halfEven', { scale }),
    ],
    ['fixed', (scale) => fixed('1', { scale })],
    ['fromScaled', (scale) => fromScaled(1, scale)],
  ];
  for (const [name, use] of uses) {
    it(`${name} validates its scale`, () => {
      for (const scale of badScales) {
        expect(() => use(scale)).toThrow(RangeError);
        expect(() => use(scale)).toThrow(message(scale));
      }
      expect(() => use(0)).not.toThrow();
      expect(() => use(1000)).not.toThrow();
    });
  }

  it('ExactMoney#round names the scale, as Money#round does', () => {
    expect(() => exact(chf).round('floor', -2)).toThrow(
      'Invalid scale -2: use an integer from 0 to 1000',
    );
  });
});

it('money.ts keeps its local copy of the scale limit equal to MAX_DECIMAL_SCALE', async () => {
  const { readFileSync } = await import('node:fs');
  const { MAX_DECIMAL_SCALE } = await import('../src/decimal.js');
  const source = readFileSync(new URL('../src/money.ts', import.meta.url), 'utf8');
  expect(source).toContain(`const MAX_SCALE = ${MAX_DECIMAL_SCALE};`);
});
