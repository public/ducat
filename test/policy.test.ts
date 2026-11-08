import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runs } from './fc-config.js';
import { divideAndRoundBigint } from '../src/generated/kernel.js';
import {
  addTax,
  assertScale,
  discount,
  extractTax,
  percentage,
  ratio,
  type RoundingPolicy,
  cashPolicy,
  CurrencyMismatchError,
  divide,
  fromMinor,
  isoPolicy,
  money,
  multiply,
  round,
  roundingPolicy,
  roundToIncrement,
  toScale,
  type Money,
  type RoundingMode,
} from '../src/fn.js';

const MODES: RoundingMode[] = [
  'halfEven',
  'halfExpand',
  'halfTrunc',
  'halfCeil',
  'halfFloor',
  'expand',
  'trunc',
  'ceil',
  'floor',
];

const show = (value: Money) => `${value.toString()} @${value.scale}`;

const policies = fc
  .record({
    policyScale: fc.integer({ min: 0, max: 6 }),
    increment: fc.constantFrom(1, 2, 5, 10, 25, 50, 100, 7),
    mode: fc.constantFrom(...MODES),
  })
  .map((parts) => ({
    ...parts,
    policy: roundingPolicy({
      scale: parts.policyScale,
      increment: parts.increment,
      rounding: parts.mode,
    }),
  }));

const factors = fc.oneof(
  fc.constantFrom('1.075', '0.3', '-2.5', '1/3', '-22/7', '7', '0'),
  fc.integer({ min: -1000, max: 1000 }),
  fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
);

/**
 * minor·10^-scale × num/den rounded to `increment` units at `policyScale`, straight through the
 * proved bigint kernel: an implementation independent of the policy code.
 */
function reference(
  minor: bigint,
  scale: number,
  num: bigint,
  den: bigint,
  policyScale: number,
  increment: number,
  mode: RoundingMode,
): Money {
  let dividend = minor * num;
  let divisor = den * BigInt(increment);
  if (policyScale > scale) {
    dividend *= 10n ** BigInt(policyScale - scale);
  } else {
    divisor *= 10n ** BigInt(scale - policyScale);
  }
  if (divisor < 0n) {
    dividend = -dividend;
    divisor = -divisor;
  }
  return fromMinor(
    divideAndRoundBigint(dividend, divisor, mode) * BigInt(increment),
    'EUR',
    policyScale,
  );
}

describe('roundingPolicy', () => {
  it('rounds to its scale, increment and mode', () => {
    const fourHalfEven = roundingPolicy({ scale: 4, rounding: 'halfEven' });
    expect(show(round(money('1.000050', 'EUR', { scale: 6 }), fourHalfEven))).toBe('1.0000 EUR @4');
    const fiveCents = roundingPolicy({ increment: 5 });
    expect(show(round(money('10.03', 'CHF'), fiveCents))).toBe('10.05 CHF @2');
    expect(show(round(money('10.02', 'CHF'), fiveCents))).toBe('10.00 CHF @2');
    expect(show(round(money('-10.025', 'CHF', { scale: 3 }), fiveCents))).toBe('-10.05 CHF @2');
    expect(show(fiveCents(money('10.074', 'CHF', { scale: 3 })))).toBe('10.05 CHF @2');
  });

  it('is accepted wherever a rounding mode is', () => {
    const cash = cashPolicy('CHF');
    expect(show(multiply(money('10.00', 'CHF'), '1.077', cash))).toBe('10.75 CHF @2');
    expect(show(money('10.00', 'CHF').multiply('1.077', cash))).toBe('10.75 CHF @2');
    expect(show(divide(money('10.00', 'CHF'), 3, cash))).toBe('3.35 CHF @2');
    expect(show(multiply(money('1.01', 'CHF'), 3, cash))).toBe('3.05 CHF @2');
    expect(show(multiply(money('1.01', 'EUR'), 3, roundingPolicy({ scale: 4 })))).toBe(
      '3.0300 EUR @4',
    );
    expect(show(money('10.03', 'CHF').round(cash))).toBe('10.05 CHF @2');
    const tax = addTax(money('10.00', 'CHF'), '8.1', cash);
    expect([tax.net, tax.tax, tax.gross].map(String)).toEqual([
      '10.00 CHF',
      '0.80 CHF',
      '10.80 CHF',
    ]);
  });

  it('multiply and divide match an independent bigint reference (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 22n), max: 10n ** 22n }),
        fc.integer({ min: 0, max: 5 }),
        factors,
        policies,
        (minor, scale, factor, { policy, policyScale, increment, mode }) => {
          const amount = fromMinor(minor, 'EUR', scale);
          const asRatio = ratio(factor);
          const product = multiply(amount, factor, policy);
          expect(show(product)).toBe(
            show(reference(minor, scale, asRatio.num, asRatio.den, policyScale, increment, mode)),
          );
          if (asRatio.num !== 0n) {
            const quotient = divide(amount, factor, policy);
            expect(show(quotient)).toBe(
              show(reference(minor, scale, asRatio.den, asRatio.num, policyScale, increment, mode)),
            );
          }
        },
      ),
      { numRuns: runs(500) },
    );
  });

  it('every operation lands on the policy’s scale and increment (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 22n), max: 10n ** 22n }),
        fc.integer({ min: 0, max: 5 }),
        fc.constantFrom('7.7', '20', '8.1', '12.5', '0', '33.333', '-5'),
        policies,
        (minor, scale, percent, { policy }) => {
          const amount = fromMinor(minor, 'EUR', scale);
          const results = [
            round(amount, policy),
            multiply(amount, '1.075', policy),
            multiply(amount, 3, policy),
            divide(amount, 3, policy),
            percentage(amount, percent, policy),
            discount(amount, percent, policy),
            addTax(amount, percent, policy).gross,
            extractTax(amount, percent, policy).net,
          ];
          for (const result of results) {
            assertScale(result, policy);
          }
        },
      ),
      { numRuns: runs(400) },
    );
  });

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 22n), max: 10n ** 22n }),
        fc.integer({ min: 0, max: 8 }),
        policies,
        (minor, scale, { policy }) => {
          const once = policy(fromMinor(minor, 'EUR', scale));
          expect(show(policy(once))).toBe(show(once));
        },
      ),
      { numRuns: runs(300) },
    );
  });

  it('keeps the tax parts exact (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom('7.7', '20', '8.1', '12.5', '0', '33.333'),
        policies,
        (minor, scale, percent, { policy, policyScale, increment, mode }) => {
          const amount = fromMinor(minor, 'EUR', scale);
          const percentRatio = ratio(percent);
          const added = addTax(amount, percent, policy);
          expect(added.net.add(added.tax).equals(added.gross)).toBe(true);
          const grossRatio = ratio(
            100n * percentRatio.den + percentRatio.num,
            100n * percentRatio.den,
          );
          expect(show(added.gross)).toBe(
            show(
              reference(minor, scale, grossRatio.num, grossRatio.den, policyScale, increment, mode),
            ),
          );
          const extracted = extractTax(amount, percent, policy);
          expect(extracted.net.add(extracted.tax).equals(amount)).toBe(true);
          const priceRatio = ratio(
            100n * percentRatio.den - percentRatio.num,
            100n * percentRatio.den,
          );
          expect(show(discount(amount, percent, policy))).toBe(
            show(
              reference(minor, scale, priceRatio.num, priceRatio.den, policyScale, increment, mode),
            ),
          );
        },
      ),
      { numRuns: runs(300) },
    );
  });

  it('matches roundToIncrement and the plain modes (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
        fc.integer({ min: 3, max: 6 }),
        fc.constantFrom(1, 5, 10, 50),
        fc.constantFrom(...MODES),
        (minor, scale, increment, mode) => {
          const amount = fromMinor(minor, 'EUR', scale);
          for (const policyScale of [0, 1, 2, 3, scale]) {
            if (policyScale > scale) {
              continue;
            }
            const policy = roundingPolicy({ scale: policyScale, increment, rounding: mode });
            const step = fromMinor(increment, 'EUR', policyScale);
            const expected = toScale(roundToIncrement(amount, step, mode), policyScale);
            expect(show(round(amount, policy))).toBe(show(expected));
            if (increment === 1) {
              expect(show(round(amount, policy))).toBe(show(round(amount, mode, policyScale)));
            }
          }
        },
      ),
      { numRuns: runs(400) },
    );
  });

  it('with an increment of 1 and no scale, multiply agrees with the mode alone', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
        fc.constantFrom('1.075', '0.333', '-2.5', '1/3', '7'),
        fc.constantFrom(...MODES),
        (minor, factor, mode) => {
          const amount = fromMinor(minor, 'EUR');
          const policy = roundingPolicy({ rounding: mode });
          expect(show(multiply(amount, factor, policy))).toBe(show(multiply(amount, factor, mode)));
        },
      ),
      { numRuns: runs(300) },
    );
  });

  it('keeps unnecessary strict', () => {
    const strict = roundingPolicy({ scale: 2, rounding: 'unnecessary' });
    expect(show(round(money('1.230', 'EUR', { scale: 3 }), strict))).toBe('1.23 EUR @2');
    expect(() => round(money('1.235', 'EUR', { scale: 3 }), strict)).toThrow(RangeError);
  });

  it('rejects invalid options up front', () => {
    expect(() => roundingPolicy({ scale: -1 })).toThrow(RangeError);
    expect(() => roundingPolicy({ scale: 1.5 })).toThrow(RangeError);
    expect(() => roundingPolicy({ increment: 0 })).toThrow(RangeError);
    expect(() => roundingPolicy({ increment: 2.5 })).toThrow(RangeError);
    expect(() => roundingPolicy({ rounding: 'halfUp' as RoundingMode })).toThrow(RangeError);
  });

  it('is immutable and stores nothing on the amounts it rounds', () => {
    const policy = roundingPolicy({ scale: 3 });
    expect(Object.isFrozen(policy)).toBe(true);
    const rounded = policy(money('1.23456', 'EUR', { scale: 5 }));
    expect(Object.keys(rounded).sort()).toEqual(['currency', 'minor', 'scale']);
  });

  it('is an operation for with()', () => {
    const cash = cashPolicy('CHF');
    expect(show(money('10.00', 'CHF').multiply('1.077', 'unnecessary').with(cash))).toBe(
      '10.75 CHF @2',
    );
  });

  it('never takes the integer fast path of multiply or divide', () => {
    const fourDecimals = roundingPolicy({ scale: 4 });
    expect(show(divide(money('10', 'EUR'), 4, fourDecimals))).toBe('2.5000 EUR @4');
    expect(show(divide(money('10', 'EUR'), 3, fourDecimals))).toBe('3.3333 EUR @4');
    expect(show(multiply(money('10', 'EUR'), 2, fourDecimals))).toBe('20.0000 EUR @4');
  });

  it('only accepts policies built by roundingPolicy, not any function', () => {
    const lookalike = Object.assign((value: Money) => value, {
      scale: 2,
      increment: 1,
      rounding: 'halfEven' as const,
      currency: undefined,
    }) as unknown as RoundingPolicy;
    expect(() => multiply(money('1', 'EUR'), '1.5', lookalike)).toThrow(TypeError);
  });

  it('works as a function over lists', () => {
    const amounts = [money('1.234', 'EUR', { scale: 3 }), money('5.675', 'EUR', { scale: 3 })];
    expect(amounts.map(isoPolicy).map(String)).toEqual(['1.23 EUR', '5.68 EUR']);
  });
});

describe('isoPolicy', () => {
  it('rounds to each currency’s exponent, half up', () => {
    expect(show(isoPolicy(money('1.5', 'JPY', { scale: 1 })))).toBe('2 JPY @0');
    expect(show(isoPolicy(money('1.0005', 'KWD', { scale: 4 })))).toBe('1.001 KWD @3');
    expect(show(isoPolicy(money('-1.005', 'EUR', { scale: 3 })))).toBe('-1.01 EUR @2');
  });
});

describe('assertScale', () => {
  it('passes only at the policy’s scale and increment', () => {
    assertScale(money('1.23', 'EUR'), isoPolicy);
    expect(() => assertScale(money('1.23', 'EUR', { scale: 3 }), isoPolicy)).toThrow(RangeError);
    expect(() => assertScale(money('1', 'JPY', { scale: 2 }), isoPolicy)).toThrow(RangeError);
    assertScale(money('10.05', 'CHF'), cashPolicy('CHF'));
    expect(() => assertScale(money('10.03', 'CHF'), cashPolicy('CHF'))).toThrow(RangeError);
    assertScale(fromMinor(10n ** 30n * 5n, 'CHF'), cashPolicy('CHF'));
    expect(() => assertScale(fromMinor(10n ** 30n + 1n, 'CHF'), cashPolicy('CHF'))).toThrow(
      RangeError,
    );
  });

  it('holds for anything the policy produced (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.constantFrom(...MODES),
        (minor, scale, policyScale, increment, mode) => {
          const policy = roundingPolicy({ scale: policyScale, increment, rounding: mode });
          assertScale(policy(fromMinor(minor, 'EUR', scale)), policy);
        },
      ),
      { numRuns: runs(300) },
    );
  });
});

describe('cashPolicy', () => {
  it('uses the cash-rounding table', () => {
    expect(show(cashPolicy('SEK')(money('10.49', 'SEK')))).toBe('10.00 SEK @2');
    expect(show(cashPolicy('EUR', { country: 'NL' })(money('10.03', 'EUR')))).toBe('10.05 EUR @2');
    expect(show(cashPolicy('CHF', { rounding: 'floor' })(money('10.09', 'CHF')))).toBe(
      '10.05 CHF @2',
    );
  });

  it('throws without a rule, and for amounts in another currency', () => {
    expect(() => cashPolicy('EUR')).toThrow(RangeError);
    expect(() => cashPolicy('XXX')).toThrow(RangeError);
    expect(() => cashPolicy('CHF')(money('1', 'EUR'))).toThrow(CurrencyMismatchError);
    expect(() => multiply(money('1', 'EUR'), 2, cashPolicy('CHF'))).toThrow(CurrencyMismatchError);
    expect(() => assertScale(money('1', 'EUR'), cashPolicy('CHF'))).toThrow(CurrencyMismatchError);
  });

  it('always returns the currency’s scale, where cashRound keeps a larger one', async () => {
    const { cashRound } = await import('../src/cash.js');
    const fine = money('10.034', 'CHF', { scale: 3 });
    expect(show(cashPolicy('CHF')(fine))).toBe('10.05 CHF @2');
    expect(show(cashRound(fine))).toBe('10.050 CHF @3');
  });

  it('agrees with cashRound (property)', async () => {
    const { cashRound } = await import('../src/cash.js');
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.constantFrom('CHF', 'SEK', 'DKK', 'CAD', 'HUF', 'NOK'),
        (minor, currency) => {
          const amount = fromMinor(minor, currency);
          expect(show(cashPolicy(currency)(amount))).toBe(show(cashRound(amount)));
        },
      ),
      { numRuns: runs(300) },
    );
  });
});
