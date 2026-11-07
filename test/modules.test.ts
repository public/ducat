import { describe, expect, it } from 'vitest';
import { extendMoney, money, type Money } from '../src/index.js';

// Each vitest file gets a fresh module graph, so here the core starts without any plugin installed.
// `bun test` shares one module cache across files, so the absence checks only hold under vitest.
const proto = Object.getPrototypeOf(money('1', 'EUR')) as Record<string, unknown>;
const hasFreshModules = !('Bun' in globalThis);

describe('opt-in modules', () => {
  it
    .skipIf(!hasFreshModules)
    .each(['allocate', 'split', 'addTax', 'convert', 'cashRound', 'format', 'toStripe', 'toAdyen'])(
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
    if (hasFreshModules) {
      expect('format' in proto).toBe(false);
    }
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

  it('extendMoney: the same owner may replace its own methods (a module loaded twice)', () => {
    extendMoney({ twice: () => 1 }, { owner: 'example/twice' });
    extendMoney({ twice: () => 2 }, { owner: 'example/twice' });
    expect((money('1', 'EUR') as Money & { twice(): number }).twice()).toBe(2);
    expect(() => extendMoney({ twice: () => 3 }, { owner: 'example/other' })).toThrow(/already defined/);
    expect(() => extendMoney({ twice: () => 3 })).toThrow(/already defined/);
  });

  it('extendMoney: names every object inherits are reserved, except toLocaleString', () => {
    expect(() => extendMoney({ valueOf: () => 0 })).toThrow(/reserved/);
    expect(() => extendMoney({ hasOwnProperty: () => true })).toThrow(/reserved/);
    extendMoney({ toLocaleString: () => 'local' });
    expect(money('1', 'EUR').toLocaleString()).toBe('local');
  });
});
