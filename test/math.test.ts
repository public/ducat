import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { add, fromMinor, money, multiply, type Money, type RoundingMode } from '../src/fn.js';
import { roundingPolicy } from '../src/policy.js';
import '../src/plugins/math.js';
import { average, divideToIntegral, ratioOf, remainder, trimScale } from '../src/plugins/math.js';

const eur = (amount: string, scale?: number) =>
  scale === undefined ? money(amount, 'EUR') : money(amount, 'EUR', { scale });
const big = (value: number | bigint) => BigInt(value);

describe('average', () => {
  it('divides the exact sum once', () => {
    expect(average([eur('10'), eur('10'), eur('10.01')]).toString()).toBe('10.00 EUR');
    expect(average([eur('0.01'), eur('0.02')]).toString()).toBe('0.02 EUR');
    expect(average([eur('0.01'), eur('0.02')], 'halfEven').toString()).toBe('0.02 EUR');
    expect(average([eur('0.01'), eur('0.02')], 'trunc').toString()).toBe('0.01 EUR');
    expect(average([eur('-0.01'), eur('-0.02')]).toString()).toBe('-0.02 EUR');
  });

  it('keeps a sub-minor scale from the list', () => {
    const small = eur('0.003', 3);
    expect(average([eur('0.01'), eur('0.01'), eur('0.02')]).toString()).toBe('0.01 EUR');
    expect(average([small, small, small, eur('0.000', 3)]).toString()).toBe('0.002 EUR');
  });

  it('works at the largest scale in the list, and with a policy', () => {
    expect(average([eur('1'), eur('1.005', 3)]).toString()).toBe('1.003 EUR');
    const cents = roundingPolicy({ scale: 2, rounding: 'halfEven' });
    expect(average([eur('1'), eur('1.005', 3)], cents).toString()).toBe('1.00 EUR');
  });

  it('rejects an empty list and mixed currencies', () => {
    expect(() => average([] as Money<'EUR'>[])).toThrow('average() of an empty list');
    expect(() => average([eur('1'), money('1', 'USD')] as never)).toThrow(/Currency mismatch/);
  });
});

describe('ratioOf', () => {
  it('is the exact, reduced share', () => {
    const third = ratioOf(eur('1'), eur('3'));
    expect([third.num, third.den]).toEqual([1n, 3n]);
    const share = eur('25').ratioOf(eur('100'));
    expect([share.num, share.den]).toEqual([1n, 4n]);
    const negative = ratioOf(eur('-1.5'), eur('0.5'));
    expect([negative.num, negative.den]).toEqual([-3n, 1n]);
  });

  it('aligns scales and handles bigints', () => {
    const mixed = ratioOf(eur('1.005', 3), eur('2'));
    expect([mixed.num, mixed.den]).toEqual([201n, 400n]);
    const huge = ratioOf(fromMinor(10n ** 30n, 'EUR'), fromMinor(3, 'EUR'));
    expect([huge.num, huge.den]).toEqual([10n ** 30n, 3n]);
  });

  it('multiplying the total by the share gives the part back', () => {
    expect(multiply(eur('300'), ratioOf(eur('7.77'), eur('300'))).toString()).toBe('7.77 EUR');
  });

  it('rejects a zero denominator, other currencies and non-Money', () => {
    expect(() => ratioOf(eur('1'), eur('0'))).toThrow('Division by zero');
    expect(() => ratioOf(eur('1'), money('1', 'USD') as never)).toThrow(/Currency mismatch/);
    expect(() => ratioOf(eur('1'), { currency: 'EUR', minor: 1, scale: 2 } as never)).toThrow(
      'Expected Money, got object',
    );
  });
});

describe('divideToIntegral and remainder', () => {
  it('truncate toward zero, with the remainder taking the dividend sign', () => {
    const three = eur('3');
    expect(divideToIntegral(eur('10'), three)).toBe(3);
    expect(remainder(eur('10'), three).toString()).toBe('1.00 EUR');
    expect(divideToIntegral(eur('-10'), three)).toBe(-3);
    expect(remainder(eur('-10'), three).toString()).toBe('-1.00 EUR');
    expect(divideToIntegral(eur('10'), eur('-3'))).toBe(-3);
    expect(remainder(eur('10'), eur('-3')).toString()).toBe('1.00 EUR');
    expect(eur('9.99').divideToIntegral(eur('2.50'))).toBe(3);
    expect(eur('9.99').remainder(eur('2.50')).toString()).toBe('2.49 EUR');
  });

  it('never returns -0', () => {
    expect(Object.is(divideToIntegral(eur('-1'), eur('3')), 0)).toBe(true);
    expect(Object.is(remainder(eur('-3'), eur('3')).minor, 0)).toBe(true);
  });

  it('aligns scales: the remainder has the larger scale', () => {
    expect(divideToIntegral(eur('1'), eur('0.003', 3))).toBe(333);
    expect(remainder(eur('1'), eur('0.003', 3)).toString()).toBe('0.001 EUR');
  });

  it('use bigints when the quotient is not a safe integer', () => {
    expect(divideToIntegral(fromMinor(10n ** 30n, 'EUR'), fromMinor(7, 'EUR'))).toBe(
      10n ** 30n / 7n,
    );
    expect(remainder(fromMinor(10n ** 30n, 'EUR'), fromMinor(7, 'EUR')).minor).toBe(
      Number(10n ** 30n % 7n),
    );
    expect(divideToIntegral(fromMinor(10n ** 30n, 'EUR'), fromMinor(10n ** 20n, 'EUR'))).toBe(
      10 ** 10,
    );
  });

  it('are exact next to the safe-integer limit', () => {
    // the quotient is just below 1, where a float division could round up to 1
    const almost = fromMinor(Number.MAX_SAFE_INTEGER - 1, 'EUR');
    expect(divideToIntegral(almost, fromMinor(Number.MAX_SAFE_INTEGER, 'EUR'))).toBe(0);
  });

  it('reject a zero divisor and other currencies', () => {
    expect(() => divideToIntegral(eur('1'), eur('0'))).toThrow('Division by zero');
    expect(() => remainder(eur('1'), eur('0', 4))).toThrow('Division by zero');
    expect(() => remainder(eur('1'), money('1', 'USD') as never)).toThrow(/Currency mismatch/);
  });
});

describe('trimScale', () => {
  it('drops trailing zeros down to the currency exponent', () => {
    expect(trimScale(eur('1.2300', 4)).scale).toBe(2);
    expect(trimScale(eur('1.2300', 4)).toString()).toBe('1.23 EUR');
    expect(trimScale(eur('1.2340', 4)).toString()).toBe('1.234 EUR');
    expect(trimScale(eur('1.2345', 4)).toString()).toBe('1.2345 EUR');
    expect(trimScale(eur('0', 6)).toString()).toBe('0.00 EUR');
    expect(trimScale(money('5', 'JPY', { scale: 3 })).toString()).toBe('5 JPY');
  });

  it('goes below the exponent only when asked, and never adds digits', () => {
    expect(eur('12.00').trimScale(0).toString()).toBe('12 EUR');
    expect(eur('12.50').trimScale(0).toString()).toBe('12.5 EUR');
    const coarse = eur('12', 0);
    expect(trimScale(coarse)).toBe(coarse);
    const exact = eur('1.23');
    expect(trimScale(exact)).toBe(exact);
  });

  it('trims bigint amounts and normalises them back to numbers', () => {
    const trimmed = trimScale(fromMinor(10n ** 20n, 'EUR', 20));
    expect(trimmed.scale).toBe(2);
    expect(trimmed.minor).toBe(100);
  });

  it('rejects an invalid minimum scale', () => {
    expect(() => trimScale(eur('1'), -1)).toThrow(
      'Invalid scale -1: use an integer from 0 to 1000',
    );
    expect(() => trimScale(eur('1'), 1.5)).toThrow(
      'Invalid scale 1.5: use an integer from 0 to 1000',
    );
  });
});

describe('properties', () => {
  const minor = fc.oneof(
    fc.integer({ min: -1e9, max: 1e9 }),
    fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
    fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
  );
  const scale = fc.integer({ min: 0, max: 8 });
  const amount = fc.tuple(minor, scale).map(([value, at]) => fromMinor(value, 'EUR', at));
  const nonZero = amount.filter((value) => value.minor != 0);
  const modes: RoundingMode[] = ['halfEven', 'halfExpand', 'trunc', 'floor', 'ceil', 'expand'];

  /** value × 10^(target − scale), as a bigint at the target scale */
  const at = (value: Money, target: number) => big(value.minor) * 10n ** big(target - value.scale);

  it('money = divisor × divideToIntegral + remainder, with |remainder| < |divisor|', () => {
    fc.assert(
      fc.property(amount, nonZero, (dividend, divisor) => {
        const quotient = divideToIntegral(dividend, divisor);
        const rest = remainder(dividend, divisor);
        const common = Math.max(dividend.scale, divisor.scale);
        expect(rest.scale).toBe(common);
        expect(at(divisor, common) * big(quotient) + big(rest.minor)).toBe(at(dividend, common));
        const absolute = (value: bigint) => (value < 0n ? -value : value);
        expect(absolute(big(rest.minor)) < absolute(at(divisor, common))).toBe(true);
        expect(rest.minor == 0 || rest.minor < 0 === dividend.minor < 0).toBe(true);
        expect(typeof quotient === 'number' || !Number.isSafeInteger(Number(quotient))).toBe(true);
      }),
    );
  });

  it('ratioOf is the exact quotient, reduced', () => {
    fc.assert(
      fc.property(amount, nonZero, (part, total) => {
        const share = ratioOf(part, total);
        const common = Math.max(part.scale, total.scale);
        expect(share.den > 0n).toBe(true);
        expect(share.num * at(total, common)).toBe(share.den * at(part, common));
      }),
    );
  });

  it('average is the exact sum divided by the count, rounded once', () => {
    fc.assert(
      fc.property(
        fc.array(amount, { minLength: 1, maxLength: 8 }),
        fc.constantFrom(...modes),
        (amounts, mode) => {
          const total = amounts.reduce((left, right) => add(left, right));
          expect(average(amounts, mode).toString()).toBe(
            total.divide(amounts.length, mode).toString(),
          );
        },
      ),
    );
  });

  it('trimScale keeps the value and leaves no trailing zero above the minimum', () => {
    fc.assert(
      fc.property(amount, fc.integer({ min: 0, max: 8 }), (value, minimum) => {
        const trimmed = trimScale(value, minimum);
        expect(trimmed.equals(value)).toBe(true);
        expect(trimmed.scale).toBe(Math.min(value.scale, Math.max(trimmed.scale, minimum)));
        if (trimmed.scale > minimum) {
          expect(big(trimmed.minor) % 10n).not.toBe(0n);
        }
      }),
    );
  });
});
