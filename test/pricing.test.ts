import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromMinor, money, type RoundingMode } from '../src/fn.js';
import { priceEnding } from '../src/pricing.js';

const eur = (amount: string) => money(amount, 'EUR');

describe('priceEnding', () => {
  it('rounds up to .99 by default', () => {
    const charm = priceEnding({ ending: '0.99' });
    expect(charm(eur('23.41')).toString()).toBe('23.99 EUR');
    expect(eur('23.99').with(charm).toString()).toBe('23.99 EUR');
    expect(eur('24.00').with(charm).toString()).toBe('24.99 EUR');
    expect(eur('0').with(charm).toString()).toBe('0.99 EUR');
  });

  it('rounds down and to the nearest', () => {
    const down = priceEnding({ ending: '0.95', rounding: 'floor' });
    expect(down(eur('23.41')).toString()).toBe('22.95 EUR');
    expect(down(eur('23.95')).toString()).toBe('23.95 EUR');
    const nearest = priceEnding({ ending: '0.99', rounding: 'halfCeil' });
    expect(nearest(eur('23.41')).toString()).toBe('22.99 EUR');
    expect(nearest(eur('23.49')).toString()).toBe('23.99 EUR');
    expect(nearest(eur('23.48')).toString()).toBe('22.99 EUR');
  });

  it('supports coarse steps: 9.90 in tens, the nearest 5, the next 10', () => {
    const ninetyCents = priceEnding({ ending: '9.90', step: 10 });
    expect(ninetyCents(eur('23.41')).toString()).toBe('29.90 EUR');
    expect(ninetyCents(eur('9.00')).toString()).toBe('9.90 EUR');
    const fives = priceEnding({ ending: 0, step: 5, rounding: 'halfCeil' });
    expect(fives(eur('22.49')).toString()).toBe('20.00 EUR');
    expect(fives(eur('22.50')).toString()).toBe('25.00 EUR');
    const tens = priceEnding({ ending: 0, step: 10 });
    expect(tens(eur('20.01')).toString()).toBe('30.00 EUR');
    expect(tens(eur('20')).toString()).toBe('20.00 EUR');
  });

  it('supports several endings per unit through a sub-unit step', () => {
    const halves = priceEnding({ ending: '0.49', step: '0.5' });
    expect(halves(eur('23.41')).toString()).toBe('23.49 EUR');
    expect(halves(eur('23.50')).toString()).toBe('23.99 EUR');
  });

  it('works for negative amounts, whole-unit currencies and sub-minor scales', () => {
    const charm = priceEnding({ ending: '0.99' });
    expect(charm(eur('-1.50')).toString()).toBe('-1.01 EUR');
    const yen = priceEnding({ ending: 80, step: 100 });
    expect(yen(money('1234', 'JPY')).toString()).toBe('1280 JPY');
    expect(charm(money('1.2345', 'EUR', { scale: 4 })).toString()).toBe('1.9900 EUR');
  });

  it('is exact beyond the safe-integer range', () => {
    const charm = priceEnding({ ending: '0.99' });
    const huge = fromMinor(10n ** 30n + 1n, 'EUR');
    expect(charm(huge).minor).toBe(10n ** 30n + 99n);
    const nearMax = fromMinor(Number.MAX_SAFE_INTEGER - 50, 'EUR');
    expect(charm(nearMax).minor).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 8n);
  });

  it("'unnecessary' throws unless the price already has the ending", () => {
    const strict = priceEnding({ ending: '0.99', rounding: 'unnecessary' });
    expect(strict(eur('3.99')).toString()).toBe('3.99 EUR');
    expect(() => strict(eur('3.98'))).toThrow('Rounding necessary');
  });

  it('describes itself', () => {
    const rule = priceEnding({ ending: '9.9', step: 10 });
    expect([rule.ending, rule.step, rule.rounding]).toEqual(['9.9', '10', 'ceil']);
  });

  it('rejects endings that need more decimals than the amount has', () => {
    const charm = priceEnding({ ending: '0.99' });
    expect(() => charm(money('100', 'JPY'))).toThrow(
      'A price ending 0.99 in steps of 1 needs more than 0 decimal places for JPY',
    );
  });

  it('checks its options', () => {
    expect(() => priceEnding({ ending: '1' })).toThrow(/less than the step 1/);
    expect(() => priceEnding({ ending: '-0.01' })).toThrow(/at least 0/);
    expect(() => priceEnding({ ending: '0', step: 0 })).toThrow(
      'Invalid step 0; it must be positive',
    );
    expect(() => priceEnding({ ending: '0', step: '-5' })).toThrow(/must be positive/);
    expect(() => priceEnding({ ending: 0.99 })).toThrow("pass a decimal string such as '0.99'");
    expect(() => priceEnding({ ending: 'abc' })).toThrow('Invalid decimal string "abc"');
    expect(() => priceEnding({ ending: null as never })).toThrow('Invalid ending null');
    expect(() => priceEnding({ ending: '0.99', rounding: 'up' as never })).toThrow(
      'Invalid rounding mode up',
    );
  });
});

describe('properties', () => {
  const minor = fc.oneof(
    fc.integer({ min: -1e9, max: 1e9 }),
    fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
    fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
  );
  // step in cents (1 cent to 1000.00), ending below it
  const rule = fc
    .bigInt({ min: 1n, max: 100_000n })
    .chain((step) => fc.tuple(fc.constant(step), fc.bigInt({ min: 0n, max: step - 1n })));
  const cents = (units: bigint) => (Number(units) / 100).toFixed(2);
  const directional: RoundingMode[] = ['ceil', 'floor', 'halfCeil', 'halfEven', 'trunc', 'expand'];

  it('lands on an allowed price, the nearest one in the chosen direction', () => {
    fc.assert(
      fc.property(minor, rule, fc.constantFrom(...directional), (value, [step, ending], mode) => {
        const price = fromMinor(value, 'EUR');
        const result = priceEnding({ ending: cents(ending), step: cents(step), rounding: mode })(
          price,
        );
        const before = BigInt(value);
        const after = BigInt(result.minor);
        // on the lattice ending + k × step
        const offset = (((after - ending) % step) + step) % step;
        expect(offset).toBe(0n);
        // less than one step away
        const distance = after - before;
        expect(distance < step && distance > -step).toBe(true);
        if (mode === 'ceil') {
          expect(after >= before).toBe(true);
        }
        if (mode === 'floor') {
          expect(after <= before).toBe(true);
        }
        if (mode === 'halfCeil') {
          expect(2n * distance <= step && 2n * distance > -step).toBe(true);
        }
        expect(result.scale).toBe(2);
      }),
    );
  });

  it('leaves prices that already have the ending alone', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), rule, (k, [step, ending]) => {
        const price = fromMinor(ending + k * step, 'EUR');
        for (const mode of directional) {
          const rounded = priceEnding({ ending: cents(ending), step: cents(step), rounding: mode });
          expect(rounded(price).minor).toBe(price.minor);
        }
      }),
    );
  });
});
