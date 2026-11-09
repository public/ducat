import '../src/plugins/core.js'; // the tests below use the Money methods
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runs } from './fc-config.js';
import '../src/testing/vitest.js';
import { inspect } from 'node:util';
import { arbCurrency, arbMoney } from '../src/testing/arbitraries.js';
import { moneyEquality, moneySerializer } from '../src/testing/index.js';
import { currencyExponent, defineCurrency, fromMinor, money, type Money } from '../src/fn.js';
import '../src/plugins/allocate.js';

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
// Bun's expect has no equality testers or snapshot serializers yet (installMoneyMatchers skips
// them there), so those tests run under Vitest only.
const supportsRunnerHooks = !('Bun' in globalThis);

describe.skipIf(!supportsRunnerHooks)('value equality in toEqual', () => {
  it('ignores the scale and the number/bigint representation', () => {
    expect(money('1', 'EUR', { scale: 1 })).toEqual(money('1', 'EUR'));
    expect(money('1', 'EUR', { scale: 1 })).toStrictEqual(money('1', 'EUR'));
    const asBigint = Object.assign(Object.create(Object.getPrototypeOf(money('1', 'EUR'))), {
      currency: 'EUR',
      minor: 1234n,
      scale: 2,
    }) as Money;
    expect(fromMinor(1234, 'EUR')).toEqual(asBigint);
  });

  it('applies inside nested structures', () => {
    expect({ total: money('5', 'EUR'), parts: [money('2.5', 'EUR', { scale: 3 })] }).toEqual({
      total: money('5.00', 'EUR'),
      parts: [money('2.50', 'EUR')],
    });
  });

  it('still tells different amounts and currencies apart', () => {
    expect(money('1', 'EUR')).not.toEqual(money('1.01', 'EUR'));
    expect(money('1', 'EUR')).not.toEqual(money('1', 'USD'));
    expect(moneyEquality(1, 2)).toBeUndefined();
    // Money against anything else (a second copy's Money included) is left to the runner
    expect(moneyEquality(money('1', 'EUR'), { currency: 'EUR' })).toBeUndefined();
  });
});

describe('readable output', () => {
  it.skipIf(!supportsRunnerHooks)('serializes snapshots as the amount and currency', () => {
    expect(moneySerializer.test(money('1', 'EUR'))).toBe(true);
    expect(moneySerializer.test({ currency: 'EUR' })).toBe(false);
    expect({ price: money('12.34', 'EUR') }).toMatchInlineSnapshot(`
      {
        "price": 12.34 EUR,
      }
    `);
  });

  it('inspects as Money(12.34 EUR)', () => {
    expect(inspect(money('12.34', 'EUR'))).toBe('Money(12.34 EUR)');
    expect(inspect([money('1', 'JPY')])).toBe('[ Money(1 JPY) ]');
  });

  it('shows amounts in failure messages', () => {
    expect(() => expect(money('12.35', 'EUR')).toBeMoney('12.34', 'EUR')).toThrow(
      'expected 12.35 EUR to be 12.34 EUR',
    );
    // values JSON.stringify can't print still give a clean failure
    expect(() => expect({ minor: 1n }).toBeMoney('1', 'EUR')).toThrow(
      'expected { minor: 1n } to be 1.00 EUR',
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => expect(cyclic).toBeMoney('1', 'EUR')).toThrow(
      'expected { self: [Circular] } to be 1.00 EUR',
    );
    expect(() => expect(money('1', 'EUR')).not.toBeMoney('1', 'EUR')).toThrow(
      'expected 1.00 EUR not to be 1.00 EUR',
    );
  });
});

describe('matchers', () => {
  it('toBeMoney compares the value at any scale, and checks the currency', () => {
    expect(money('12.34', 'EUR')).toBeMoney('12.34', 'EUR');
    expect(money('12.340', 'EUR', { scale: 3 })).toBeMoney('12.34', 'EUR');
    expect(money('1.005', 'EUR', { scale: 3 })).toBeMoney('1.005', 'EUR');
    expect(money('12', 'JPY')).toBeMoney(12, 'JPY');
    expect(money('0.00000015', 'EUR', { scale: 8 })).toBeMoney('1.5e-7', 'EUR');
    expect(fromMinor(10n ** 30n, 'EUR')).toBeMoney(10n ** 28n, 'EUR');
    expect(money('12.34', 'EUR')).not.toBeMoney('12.34', 'USD');
    expect('12.34 EUR').not.toBeMoney('12.34', 'EUR');
  });

  it('toHaveCurrency', () => {
    expect(money('1', 'EUR')).toHaveCurrency('EUR');
    expect(money('1', 'EUR')).not.toHaveCurrency('USD');
    expect({ currency: 'EUR' }).not.toHaveCurrency('EUR');
  });

  it('the comparisons', () => {
    const one = money('1', 'EUR');
    const two = money('2', 'EUR');
    expect(two).toBeGreaterThanMoney(one);
    expect(two).toBeGreaterThanOrEqualMoney(money('2.000', 'EUR', { scale: 3 }));
    expect(one).toBeLessThanMoney(two);
    expect(one).toBeLessThanOrEqualMoney(one);
    expect(one).not.toBeGreaterThanMoney(two);
    // a different currency or a non-Money is a mistake in the test: it throws, even under .not
    expect(() => expect(money('5', 'USD')).not.toBeGreaterThanMoney(one)).toThrow(
      'cannot compare USD with EUR',
    );
    expect(() => expect(5).not.toBeLessThanMoney(one)).toThrow(TypeError);
    expect(() => expect(one).toBeGreaterThanMoney(two)).toThrow(
      'expected 1.00 EUR to be greater than 2.00 EUR',
    );
  });

  it('toSumTo checks that parts add up exactly', () => {
    const total = money('100', 'EUR');
    expect(total.split(3)).toSumTo(total);
    expect([money('33.33', 'EUR'), money('33.33', 'EUR')]).not.toSumTo(total);
    expect([]).not.toSumTo(total);
    expect(() => expect([money('50', 'EUR'), money('50', 'USD')]).not.toSumTo(total)).toThrow(
      TypeError,
    );
    expect(() => expect('100 EUR').not.toSumTo(total)).toThrow(TypeError);
    expect(() => expect([money('1', 'EUR')]).toSumTo(money('2', 'EUR'))).toThrow(
      'expected [1.00 EUR] to sum to 2.00 EUR; they sum to 1.00 EUR',
    );
  });

  it('work as asymmetric matchers', () => {
    expect({ total: money('12.340', 'EUR', { scale: 3 }) }).toEqual({
      total: expect.toBeMoney('12.34', 'EUR'),
    });
  });

  it('work as properties: every split sums to its total', () => {
    fc.assert(
      fc.property(arbMoney(), fc.integer({ min: 1, max: 12 }), (total, count) => {
        expect(total.split(count)).toSumTo(total);
      }),
      { numRuns: runs(200) },
    );
  });
});

describe('types', () => {
  it('the matchers are typed on expect', () => {
    expect(money('1', 'EUR')).toBeMoney('1', 'EUR');
    // @ts-expect-error toBeMoney needs a currency
    expect(() => expect(money('1', 'EUR')).toBeMoney('1')).toThrow(/Unknown currency/);
  });
});

describe('arbitraries', () => {
  it('cover the bigint range, unusual exponents and extra scale', () => {
    const samples = fc.sample(arbMoney(), { numRuns: 2000, seed: 1 });
    expect(samples.some((value) => typeof value.minor === 'bigint')).toBe(true);
    expect(samples.some((value) => typeof value.minor === 'number')).toBe(true);
    const exponents = new Set(samples.map((value) => currencyExponent(value.currency)));
    expect([...exponents].sort()).toEqual([0, 2, 3, 4]);
    expect(samples.some((value) => value.scale > currencyExponent(value.currency))).toBe(true);
    // within 1000 of 2^53
    expect(
      samples.some((value) => {
        const minor = BigInt(value.minor);
        const distance = minor > 0n ? minor - SAFE : -minor - SAFE;
        return distance >= -1000n && distance <= 1000n;
      }),
    ).toBe(true);
  });

  it('keep every value valid and within the bounds (property)', () => {
    fc.assert(
      fc.property(
        arbMoney({
          currency: 'EUR',
          min: '-10.005',
          max: '99.999',
          scale: fc.integer({ min: 0, max: 4 }),
        }),
        (value) => {
          expect(value.currency).toBe('EUR');
          expect(value).toBeGreaterThanOrEqualMoney(money('-10.005', 'EUR', { scale: 3 }));
          expect(value).toBeLessThanOrEqualMoney(money('99.999', 'EUR', { scale: 3 }));
          // the representation invariant
          const minor = BigInt(value.minor);
          expect(typeof value.minor === 'number').toBe(minor <= SAFE && minor >= -SAFE);
        },
      ),
      { numRuns: runs(300) },
    );
  });

  it('arbCurrency filters by exponent and rejects impossible requests', () => {
    const codes = fc.sample(arbCurrency({ exponents: [3] }), { numRuns: 100, seed: 2 });
    expect(codes.every((code) => currencyExponent(code) === 3)).toBe(true);
    expect(() => arbCurrency({ exponents: [9] })).toThrow(RangeError);
    // at scale 0 there is no whole yen between the bounds (at scale 1 or more there would be)
    expect(() =>
      fc.sample(arbMoney({ currency: 'JPY', min: '0.2', max: '0.8', scale: 0 }), 1),
    ).toThrow(RangeError);
    expect(() => fc.sample(arbMoney({ currency: 'EUR', scale: -1 }), 1)).toThrow(RangeError);
    expect(() => fc.sample(arbMoney({ currency: 'EUR', scale: 1.5 }), 1)).toThrow(RangeError);
    const allThree = fc.sample(arbCurrency({ all: true, exponents: [3] }), {
      numRuns: 200,
      seed: 3,
    });
    expect(allThree.every((code) => currencyExponent(code) === 3)).toBe(true);
    expect(new Set(allThree).size).toBeGreaterThan(3);
  });

  it('draw custom currencies when asked', () => {
    // a code no other test file registers: the registry is global, and Bun shares it
    defineCurrency('XTV', 6);
    const codes = fc.sample(arbCurrency({ extra: ['XTV'], exponents: [6] }), {
      numRuns: 20,
      seed: 4,
    });
    expect(new Set(codes)).toEqual(new Set(['XTV']));
    const values = fc.sample(arbMoney({ currency: 'XTV' }), { numRuns: 50, seed: 5 });
    expect(values.every((value) => value.currency === 'XTV' && value.scale >= 6)).toBe(true);
  });
});

describe('the Jest entry', () => {
  it('installs on the global expect', async () => {
    const extended: string[] = [];
    const fakeExpect = {
      extend: (matchers: object) => extended.push(...Object.keys(matchers)),
      addEqualityTesters: () => undefined,
      addSnapshotSerializer: () => undefined,
    };
    const holder = globalThis as { expect?: unknown };
    const previous = holder.expect;
    holder.expect = fakeExpect;
    try {
      await import('../src/testing/jest.js');
    } finally {
      // restore, not delete: Vitest with globals and bun test have their own global expect
      holder.expect = previous;
    }
    expect(extended).toContain('toBeMoney');
    expect(extended).toContain('toSumTo');
  });
});
