import { describe, expect, it } from 'vitest';
import { extendMoney, money, type Money } from '../src/index.js';

// Each vitest file gets a fresh module graph, so here the core starts without any plugin installed.
const proto = Object.getPrototypeOf(money('1', 'EUR')) as Record<string, unknown>;

describe('opt-in modules', () => {
  it.each(['allocate', 'split', 'addTax', 'convert', 'cashRound', 'format', 'toStripe', 'toAdyen'])(
    'the core alone has no %s method',
    (name) => {
      expect(name in proto).toBe(false);
    },
  );

  it('the core has its own methods', () => {
    expect(typeof proto.add).toBe('function');
  });

  it('importing a module installs its methods, non-enumerable, delegating to the free functions', async () => {
    const allocateModule = await import('../src/plugins/allocate.js');
    const total = money('100', 'EUR') as Money<'EUR'> & { split(count: number): Money<'EUR'>[] };
    expect(total.split(3).map(String)).toEqual(allocateModule.split(total, 3).map(String));
    expect(Object.keys(total)).toEqual(['currency', 'minor', 'scale']);
    expect('format' in proto).toBe(false);
    await import('../src/plugins/format.js');
    expect(typeof proto.format).toBe('function');
  });

  it('every module installs what it declares', async () => {
    await import('../src/plugins/all.js');
    const expected = [
      'allocate',
      'split',
      'instalments',
      'schedule',
      'chunk',
      'percentage',
      'discount',
      'addTax',
      'extractTax',
      'convert',
      'cashRound',
      'roundToIncrement',
      'format',
      'formatToParts',
      'toStripe',
      'toStripeAmount',
      'toAdyen',
      'toDecimalValue',
    ];
    const missing = expected.filter((name) => typeof proto[name] !== 'function');
    expect(missing).toEqual([]);
  });

  it('extendMoney: re-installing the same function is a no-op, a different one throws', () => {
    const half = function (this: Money) {
      return this.divide(2);
    };
    extendMoney({ half });
    extendMoney({ half });
    expect(String((money('3', 'EUR') as Money & { half(): Money }).half())).toBe('1.50 EUR');
    expect(() => extendMoney({ half: () => 0 })).toThrow(/already defined/);
    expect(() => extendMoney({ add: () => 0 })).toThrow(/already defined/);
  });
});
