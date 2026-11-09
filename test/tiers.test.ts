import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exact, sumExact } from '../src/exact.js';
import { CurrencyMismatchError, fromMinor, money, ratio, sum, type Money } from '../src/money.js';
import { fixed } from '../src/fixed.js';
import { roundingPolicy } from '../src/policy.js';
import { tieredPrice, type PriceTier, type TiersMode } from '../src/pricing.js';
import { runs } from './fc-config.js';

const usd = (amount: string): Money<'USD'> => money(amount, 'USD');
const show = (amount: Money): string => amount.toString();

// Stripe's tiered-pricing guide (docs.stripe.com/subscriptions/pricing-models/tiered-pricing): 1-5
// at 7 USD, 6-10 at 6.5 USD, 11+ at 6 USD, and the flat-rate example with five tiers
const fonts: PriceTier<'USD'>[] = [
  { upTo: 5, unitAmount: usd('7') },
  { upTo: 10, unitAmount: usd('6.50') },
  { upTo: 'inf', unitAmount: usd('6') },
];
const withFlat: PriceTier<'USD'>[] = [
  { upTo: 5, unitAmount: usd('5'), flatAmount: usd('10') },
  { upTo: 10, unitAmount: usd('4'), flatAmount: usd('20') },
  { upTo: 15, unitAmount: usd('3'), flatAmount: usd('30') },
  { upTo: 20, unitAmount: usd('2'), flatAmount: usd('40') },
  { upTo: 'inf', unitAmount: usd('1'), flatAmount: usd('50') },
];

describe("tieredPrice: Stripe's documented examples", () => {
  it('volume', () => {
    const totals = [1, 5, 6, 20, 25].map((quantity) =>
      show(tieredPrice(quantity, { mode: 'volume', tiers: fonts }).total),
    );
    expect(totals).toEqual(['7.00 USD', '35.00 USD', '39.00 USD', '120.00 USD', '150.00 USD']);
  });

  it('graduated', () => {
    const totals = [1, 5, 6, 20, 25].map((quantity) =>
      show(tieredPrice(quantity, { mode: 'graduated', tiers: fonts }).total),
    );
    expect(totals).toEqual(['7.00 USD', '35.00 USD', '41.50 USD', '127.50 USD', '157.50 USD']);
    // "35 USD for the first 5 fonts and 6.5 USD for the 6th font"
    const six = tieredPrice(6, { mode: 'graduated', tiers: fonts });
    expect(six.lines.map((line) => [line.tier, line.quantity, show(line.amount)])).toEqual([
      [0, '5', '35.00 USD'],
      [1, '1', '6.50 USD'],
    ]);
  });

  it('flat amounts: 12 units, and quantity 0 bills the first flat amount', () => {
    expect(show(tieredPrice(12, { mode: 'volume', tiers: withFlat }).total)).toBe('66.00 USD');
    const graduated = tieredPrice(12, { mode: 'graduated', tiers: withFlat });
    // (5 × 5 + 10) + (5 × 4 + 20) + (2 × 3 + 30) = 111
    expect(show(graduated.total)).toBe('111.00 USD');
    expect(graduated.lines.map((line) => show(line.amount))).toEqual([
      '35.00 USD',
      '40.00 USD',
      '36.00 USD',
    ]);
    for (const mode of ['volume', 'graduated'] as const) {
      expect(show(tieredPrice(0, { mode, tiers: withFlat }).total)).toBe('10.00 USD');
    }
  });
});

describe('tieredPrice', () => {
  it('bounds are inclusive: the 5th unit is in the first tier, the 6th in the second', () => {
    expect(tieredPrice(5, { mode: 'volume', tiers: fonts }).lines[0]!.tier).toBe(0);
    expect(tieredPrice(6, { mode: 'volume', tiers: fonts }).lines[0]!.tier).toBe(1);
    expect(tieredPrice(10, { mode: 'graduated', tiers: fonts }).lines).toHaveLength(2);
  });

  it('sub-cent unit prices and decimal quantities are exact, rounded once at the end', () => {
    const metered: PriceTier<'EUR'>[] = [
      { upTo: '1000', unitAmount: money('0.0015', 'EUR', { scale: 4 }) },
      { upTo: 'inf', unitAmount: money('0.0011', 'EUR', { scale: 4 }) },
    ];
    // 1000 × 0.0015 + 333.3 × 0.0011 = 1.5 + 0.36663 = 1.86663
    const price = tieredPrice('1333.3', {
      mode: 'graduated',
      tiers: metered,
      rounding: 'halfEven',
    });
    expect(String(price.exact)).toBe('186663/100000 EUR');
    expect(show(price.total)).toBe('1.87 EUR');
    expect(price.lines.map((line) => [line.quantity, show(line.amount)])).toEqual([
      ['1000', '1.50 EUR'],
      ['333.3', '0.37 EUR'],
    ]);
    // rounding each line on its own would give 1.50 + 0.37 too, but here it would not: the
    // running total keeps the lines summing to the total
    const thirds: PriceTier<'EUR'>[] = [
      { upTo: 1, unitAmount: money('0.005', 'EUR', { scale: 3 }) },
      { upTo: 2, unitAmount: money('0.005', 'EUR', { scale: 3 }) },
      { upTo: 'inf', unitAmount: money('0.005', 'EUR', { scale: 3 }) },
    ];
    const split = tieredPrice(3, { mode: 'graduated', tiers: thirds, rounding: 'halfExpand' });
    expect(show(split.total)).toBe('0.02 EUR');
    expect(split.lines.map((line) => show(line.amount))).toEqual([
      '0.01 EUR',
      '0.00 EUR',
      '0.01 EUR',
    ]);
  });

  it('a rounding policy rounds the total and the lines', () => {
    const tiers: PriceTier<'CHF'>[] = [
      { upTo: 'inf', unitAmount: money('0.333', 'CHF', { scale: 3 }) },
    ];
    const cash = roundingPolicy({ increment: 5 });
    expect(show(tieredPrice(10, { mode: 'volume', tiers, rounding: cash }).total)).toBe('3.35 CHF');
  });

  it('rejects bad tiers and quantities', () => {
    const options = { mode: 'graduated', tiers: fonts } as const;
    expect(() => tieredPrice(-1, options)).toThrow('must not be negative');
    expect(() => tieredPrice(1, { mode: 'stairs' as TiersMode, tiers: fonts })).toThrow(
      'Invalid tiers mode',
    );
    expect(() => tieredPrice(1, { mode: 'volume', tiers: [] })).toThrow('at least one tier');
    expect(() => tieredPrice(1, { mode: 'volume', tiers: [{ upTo: 'inf' }] })).toThrow(
      'unitAmount or a flatAmount',
    );
    expect(() =>
      tieredPrice(1, {
        mode: 'volume',
        tiers: [{ upTo: 'inf', unitAmount: usd('1') }, { upTo: 5 }],
      }),
    ).toThrow('Tier 0 is open (upTo inf), but only the last tier can be');
    expect(() =>
      tieredPrice(1, {
        mode: 'volume',
        tiers: [
          { upTo: 5, unitAmount: usd('1') },
          { upTo: 5, unitAmount: usd('1') },
        ],
      }),
    ).toThrow("Tier bounds must increase: tier 1's upTo 5 is not above tier 0's 5");
    expect(() =>
      tieredPrice(1, { mode: 'volume', tiers: [{ upTo: 0, unitAmount: usd('1') }] }),
    ).toThrow("Tier bounds must increase: tier 0's upTo 0 is not above 0");
    expect(() =>
      tieredPrice(6, { mode: 'volume', tiers: [{ upTo: 5, unitAmount: usd('1') }] }),
    ).toThrow('beyond the last tier');
    const mixed = [
      { upTo: 5, unitAmount: usd('1') as Money },
      { upTo: 'inf', unitAmount: money('1', 'EUR') as Money },
    ] as PriceTier<string>[];
    expect(() => tieredPrice(1, { mode: 'volume', tiers: mixed })).toThrow(CurrencyMismatchError);
  });
});

describe('tieredPrice for real tier tables', () => {
  const meters: PriceTier<'EUR'>[] = [
    { upTo: 10, unitAmount: money('2', 'EUR') },
    { upTo: 100, unitAmount: money('1.50', 'EUR'), flatAmount: money('5', 'EUR') },
  ];

  it("beyondLastTier: 'cap' charges nothing past the last bound, in both modes", () => {
    const graduated = tieredPrice(250, { mode: 'graduated', tiers: meters, beyondLastTier: 'cap' });
    expect(show(graduated.total)).toBe(
      show(tieredPrice(100, { mode: 'graduated', tiers: meters }).total),
    );
    expect(show(graduated.total)).toBe('160.00 EUR'); // 10 × 2 + 90 × 1.50 + 5
    expect(graduated.lines.map((line) => line.quantity)).toEqual(['10', '90']);
    const volume = tieredPrice(250, { mode: 'volume', tiers: meters, beyondLastTier: 'cap' });
    expect(show(volume.total)).toBe('155.00 EUR'); // 100 × 1.50 + 5
    // within the tiers, 'cap' changes nothing
    expect(
      show(tieredPrice(50, { mode: 'volume', tiers: meters, beyondLastTier: 'cap' }).total),
    ).toBe(show(tieredPrice(50, { mode: 'volume', tiers: meters }).total));
    expect(() => tieredPrice(250, { mode: 'volume', tiers: meters })).toThrow(
      "The quantity 250 is beyond the last tier (upTo 100); pass { beyondLastTier: 'cap' } to charge nothing past it",
    );
    expect(() =>
      tieredPrice(1, { mode: 'volume', tiers: meters, beyondLastTier: 'clamp' as never }),
    ).toThrow("Invalid beyondLastTier clamp; use 'throw' or 'cap'");
  });

  it("an open last tier is 'inf', null or Infinity", () => {
    const totals = (['inf', null, Infinity] as const).map((upTo) =>
      show(
        tieredPrice(1000, {
          mode: 'graduated',
          tiers: [
            { upTo: 10, unitAmount: usd('1') },
            { upTo, unitAmount: usd('0.50') },
          ],
        }).total,
      ),
    );
    expect(totals).toEqual(['505.00 USD', '505.00 USD', '505.00 USD']);
    expect(() =>
      tieredPrice(1, {
        mode: 'volume',
        tiers: [
          { upTo: null, unitAmount: usd('1') },
          { upTo: 5, unitAmount: usd('1') },
        ],
      }),
    ).toThrow('Tier 0 is open (upTo null), but only the last tier can be');
    expect(() =>
      tieredPrice(1, {
        mode: 'volume',
        tiers: [
          { upTo: Infinity, unitAmount: usd('1') },
          { upTo: 5, unitAmount: usd('1') },
        ],
      }),
    ).toThrow('Tier 0 is open (upTo Infinity), but only the last tier can be');
  });

  it('fractional quantities: decimal strings, a/b strings, ratios, exactly', () => {
    const tiers: PriceTier<'EUR'>[] = [
      { upTo: '50.5', unitAmount: money('0.30', 'EUR') },
      { upTo: 'inf', unitAmount: money('0.20', 'EUR') },
    ];
    const third = tieredPrice('250/3', { mode: 'graduated', tiers });
    // 50.5 × 0.30 + (250/3 − 50.5) × 0.20 = 15.15 + 6.5666… = 21.7166…
    expect(show(third.total)).toBe('21.72 EUR');
    expect(third.lines.map((line) => line.quantity)).toEqual(['50.5', '197/6']);
    expect(
      third.exact.equals(exact(money('15.15', 'EUR')).add(exact(money('197', 'EUR')).divide(30))),
    ).toBe(true);
    expect(show(tieredPrice('250/3', { mode: 'volume', tiers }).total)).toBe('16.67 EUR');
    expect(show(tieredPrice(ratio(250, 3), { mode: 'volume', tiers }).total)).toBe('16.67 EUR');
    expect(show(tieredPrice(fixed('12.250'), { mode: 'volume', tiers }).total)).toBe('3.68 EUR');
    expect(tieredPrice(fixed('12.250'), { mode: 'volume', tiers }).lines[0]!.quantity).toBe(
      '12.25',
    );
    expect(show(tieredPrice('12.25', { mode: 'volume', tiers }).total)).toBe('3.68 EUR');
    expect(() => tieredPrice('-1/3', { mode: 'volume', tiers })).toThrow('must not be negative');
  });

  it('volume tiers chosen by one quantity, charged by another', () => {
    // tier by meter count, priced per kWh used, with the tier's flat fee once
    const perKwh: PriceTier<'EUR'>[] = [
      { upTo: 1, unitAmount: money('0.30', 'EUR'), flatAmount: money('10', 'EUR') },
      { upTo: 'inf', unitAmount: money('0.25', 'EUR'), flatAmount: money('25', 'EUR') },
    ];
    const bill = tieredPrice(3, { mode: 'volume', tiers: perKwh, chargeQuantity: '1234.5' });
    expect(bill.lines.map((line) => [line.tier, line.quantity])).toEqual([[1, '1234.5']]);
    expect(show(bill.total)).toBe('333.63 EUR'); // 1234.5 × 0.25 + 25, half up
    // flat-fee tiers: only a flatAmount, so the charge quantity doesn't matter
    const flat: PriceTier<'EUR'>[] = [
      { upTo: 5, flatAmount: money('49', 'EUR') },
      { upTo: 'inf', flatAmount: money('99', 'EUR') },
    ];
    expect(show(tieredPrice(7, { mode: 'volume', tiers: flat, chargeQuantity: 1000 }).total)).toBe(
      '99.00 EUR',
    );
    expect(() => tieredPrice(3, { mode: 'graduated', tiers: perKwh, chargeQuantity: 10 })).toThrow(
      "chargeQuantity needs mode 'volume'",
    );
    expect(() => tieredPrice(3, { mode: 'volume', tiers: perKwh, chargeQuantity: '-1' })).toThrow(
      'Invalid chargeQuantity -1; it must not be negative',
    );
  });
});

describe('tieredPrice properties', () => {
  const amounts = fc.bigInt({ min: 0n, max: 10n ** 6n });
  const tierList = fc
    .array(
      fc.record({
        width: fc.integer({ min: 1, max: 1000 }),
        unit: amounts,
        flat: fc.option(amounts, { nil: undefined }),
        scale: fc.integer({ min: 2, max: 5 }),
      }),
      { minLength: 1, maxLength: 6 },
    )
    .map((specs) => {
      let bound = 0;
      return specs.map((spec, i): PriceTier<'EUR'> => {
        bound += spec.width;
        const isLast = i === specs.length - 1;
        return {
          upTo: isLast ? 'inf' : bound,
          unitAmount: fromMinor(spec.unit, 'EUR', spec.scale),
          ...(spec.flat === undefined ? {} : { flatAmount: fromMinor(spec.flat, 'EUR') }),
        };
      });
    });
  const modes = fc.constantFrom('graduated', 'volume' as const);
  const roundings = fc.constantFrom('halfEven', 'halfExpand', 'floor', 'ceil' as const);

  it('a line can be a whole cent off its exact charge, and the lines still sum to the total', () => {
    const price = tieredPrice(2, {
      mode: 'graduated',
      tiers: [
        { upTo: 1, unitAmount: money('746.295', 'EUR', { scale: 3 }) },
        { upTo: 'inf', unitAmount: money('0', 'EUR'), flatAmount: money('762.19', 'EUR') },
      ],
      rounding: 'halfEven',
    });
    expect(price.lines.map((line) => line.amount.toDecimal())).toEqual(['746.30', '762.18']);
    expect(price.total.toDecimal()).toBe('1508.48');
  });

  it('the lines sum to the total, and the exact lines sum to the exact total', () => {
    fc.assert(
      fc.property(
        tierList,
        fc.integer({ min: 0, max: 10_000 }),
        modes,
        roundings,
        (tiers, quantity, mode, rounding) => {
          const price = tieredPrice(quantity, { mode, tiers, rounding });
          expect(sum(price.lines.map((line) => line.amount)).toMinor()).toBe(price.total.toMinor());
          expect(sumExact(price.lines.map((line) => line.exact)).equals(price.exact)).toBe(true);
          expect(price.total.toMinor()).toBe(price.exact.round(rounding).toMinor());
          // every line is within one cent of its exact charge: a line is the difference of two
          // rounded running totals, each off by at most half a cent under a half mode, so a line
          // can be off by a whole cent (746.295 + 762.19, halfEven: 746.30, then 762.18), and by
          // less than one under floor or ceil
          for (const line of price.lines) {
            const gap = line.exact.subtract(exact(line.amount));
            expect(gap.compare(exact(fromMinor(1, 'EUR'))) <= 0).toBe(true);
            expect(gap.compare(exact(fromMinor(-1, 'EUR'))) >= 0).toBe(true);
          }
        },
      ),
      { numRuns: runs(200) },
    );
  });

  it('graduated units add up to the quantity, and graduated never falls as the quantity grows', () => {
    fc.assert(
      fc.property(tierList, fc.integer({ min: 0, max: 10_000 }), (tiers, quantity) => {
        const price = tieredPrice(quantity, { mode: 'graduated', tiers });
        const units = price.lines.reduce((total, line) => total + Number(line.quantity), 0);
        expect(units).toBe(quantity);
        const next = tieredPrice(quantity + 1, { mode: 'graduated', tiers });
        expect(next.exact.compare(price.exact) >= 0).toBe(true);
      }),
      { numRuns: runs(200) },
    );
  });

  it('one tier: graduated and volume agree, and the price is quantity × unit + flat', () => {
    fc.assert(
      fc.property(amounts, amounts, fc.integer({ min: 0, max: 10_000 }), (unit, flat, quantity) => {
        const tiers: PriceTier<'EUR'>[] = [
          { upTo: 'inf', unitAmount: fromMinor(unit, 'EUR'), flatAmount: fromMinor(flat, 'EUR') },
        ];
        const graduated = tieredPrice(quantity, { mode: 'graduated', tiers });
        const volume = tieredPrice(quantity, { mode: 'volume', tiers });
        expect(graduated.total.toMinor()).toBe(unit * BigInt(quantity) + flat);
        expect(volume.total.toMinor()).toBe(graduated.total.toMinor());
      }),
      { numRuns: runs(100) },
    );
  });
});
