import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';
import * as fn from '../src/fn.js';
import * as all from '../src/plugins/all.js';

// The core operations are methods in the root entry, and plain functions in /fn and /all.
const METHOD_FORMS = [
  'add',
  'subtract',
  'negate',
  'abs',
  'multiply',
  'divide',
  'round',
  'toScale',
  'compare',
  'equals',
  'identical',
  'lessThan',
  'lessThanOrEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'isZero',
  'isPositive',
  'isNegative',
  'sign',
  'min',
  'max',
  'clamp',
  'majorPart',
  'minorPart',
  'toDecimal',
  'toMinor',
  'toMinorNumber',
];

const ROOT_FUNCTIONS = [
  'money',
  'fromMinor',
  'zero',
  'fromJSON',
  'sum',
  'isMoney',
  'isMoneyIn',
  'assertCurrency',
  'ratio',
  'extendMoney',
];

describe('export surface', () => {
  it('the root entry has the constructors and list functions, not the method forms', () => {
    const names = Object.keys(root);
    expect(METHOD_FORMS.filter((name) => names.includes(name))).toEqual([]);
    expect(ROOT_FUNCTIONS.filter((name) => !names.includes(name))).toEqual([]);
  });

  it('/fn and /all have every method form and everything the root entry has', () => {
    for (const entry of [fn, all]) {
      const names = Object.keys(entry);
      const missing = [...METHOD_FORMS, ...Object.keys(root)].filter(
        (name) => !names.includes(name),
      );
      expect(missing).toEqual([]);
    }
  });
});

describe('schema entries', () => {
  it('/zod and /valibot export the same schema functions', async () => {
    const zod = await import('../src/zod.js');
    const valibot = await import('../src/valibot.js');
    expect(Object.keys(zod).sort()).toEqual(['moneyJSONSchema', 'moneySchema']);
    expect(Object.keys(valibot).sort()).toEqual(['moneyJSONSchema', 'moneySchema']);
  });

  it('/fn and /all do not include them, so neither needs zod or valibot installed', () => {
    for (const entry of [fn, all]) {
      expect(Object.keys(entry)).not.toContain('moneySchema');
    }
  });
});
