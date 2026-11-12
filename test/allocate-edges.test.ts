// Boundary and error-path tests for src/allocate.ts: the fast path's bounds, ties between equal
// remainders, invalid weights and counts, and the errors users see.
import '../src/plugins/iso.js';
import { describe, expect, it } from 'vitest';
import { allocate, chunk, instalments, schedule, split } from '../src/allocate.js';
import { fromMinor, money, toDecimal, type Money } from '../src/fn.js';

const eur = (amount: string, scale?: number) =>
  money(amount, 'EUR', scale === undefined ? {} : { scale });
const decimals = (parts: Money[]) => parts.map((part) => toDecimal(part));
const scales = (parts: Money[]) => parts.map((part) => part.scale);

describe('allocate', () => {
  it('stays exact where amount × weight comes close to 2^53', () => {
    // 4503599627370497 × 2 = 2^53 + 2 can't take the float path: it would round the shares
    expect(decimals(allocate(fromMinor(4503599627370497, 'EUR'), [2, 1]))).toEqual([
      '30023997515803.31',
      '15011998757901.66',
    ]);
    expect(decimals(allocate(fromMinor(3002399751580331, 'EUR'), [2, 3]))).toEqual([
      '12009599006321.32',
      '18014398509481.99',
    ]);
    expect(decimals(allocate(fromMinor(1286742750677285, 'EUR'), [3, 7]))).toEqual([
      '3860228252031.86',
      '9007199254740.99',
    ]);
  });

  it('gives equal remainders to the earlier buckets, beyond 2^53 and beyond 32 weights', () => {
    // 10^20 = 2 (mod 7): the first two of seven equal buckets get the extra units
    const big = allocate(fromMinor(10n ** 20n, 'EUR'), [1, 1, 1, 1, 1, 1, 1]);
    expect(big.map((part) => String(part.minor))).toEqual([
      '14285714285714285715',
      '14285714285714285715',
      '14285714285714285714',
      '14285714285714285714',
      '14285714285714285714',
      '14285714285714285714',
      '14285714285714285714',
    ]);
    // 40 equal weights (past the selection loop's 32): the remainder of 0.03 goes to the first 3
    const many = allocate(fromMinor(43, 'EUR'), new Array<number>(40).fill(1));
    expect(many.map((part) => part.minor)).toEqual([2, 2, 2, ...new Array<number>(37).fill(1)]);
    // with a zero weight first, it is skipped
    const skip = allocate(fromMinor(10n ** 20n, 'EUR'), [0, 1, 1, 1]);
    expect(skip.map((part) => String(part.minor))).toEqual([
      '0',
      '33333333333333333334',
      '33333333333333333333',
      '33333333333333333333',
    ]);
  });

  it('rejects negative weights on the fast path too', () => {
    for (const weights of [
      [-1, 2],
      [2, -1],
      ['-1', '2'],
      [-1n, 2n],
    ]) {
      expect(() => allocate(eur('1.00'), weights)).toThrow(
        new RangeError('Allocation weights must not be negative'),
      );
    }
  });

  it('takes decimal-string, bigint and mixed weights', () => {
    expect(decimals(allocate(eur('0.05'), ['70', '30']))).toEqual(['0.04', '0.01']);
    expect(decimals(allocate(eur('1.00'), ['33.3', 66.7]))).toEqual(['0.33', '0.67']);
    expect(decimals(allocate(eur('1.00'), [1n, 3n]))).toEqual(['0.25', '0.75']);
  });

  it('names its errors', () => {
    expect(() => allocate(eur('1.00'), [])).toThrow(
      new RangeError('allocate() needs at least one weight'),
    );
    expect(() => allocate(eur('1.00'), [1, 1, 1], { remainder: 'bogus' as never })).toThrow(
      new RangeError('Unknown remainder strategy "bogus"'),
    );
  });
});

describe('split and instalments', () => {
  it('reject counts that are not positive integers', () => {
    for (const count of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      expect(() => split(eur('1.00'), count)).toThrow(new RangeError(`Invalid count ${count}`));
      expect(() => instalments(eur('1.00'), count)).toThrow(
        new RangeError(`Invalid count ${count}`),
      );
    }
  });

  it('instalments check the unit', () => {
    expect(() => instalments(eur('10'), 3, { unit: money('1', 'USD') as never })).toThrow(
      new TypeError('Currency mismatch: EUR vs USD'),
    );
    for (const unit of [eur('0'), eur('-1')]) {
      expect(() => instalments(eur('10'), 3, { unit })).toThrow(
        new RangeError('unit must be positive'),
      );
    }
  });

  it('instalments work at the finer of the two scales', () => {
    const parts = instalments(eur('10.00'), 3, { unit: eur('0.005', 3) });
    expect(decimals(parts)).toEqual(['3.340', '3.330', '3.330']);
    expect(scales(parts)).toEqual([3, 3, 3]);
  });
});

describe('schedule', () => {
  it('allows one rest tranche', () => {
    expect(() => schedule(eur('100'), [{ rest: true }, { rest: true }])).toThrow(
      new RangeError('schedule() allows only one rest tranche'),
    );
  });

  it('a cap equal to the share leaves the share as computed', () => {
    const [capped, rest] = schedule(eur('1000'), [
      { percent: 30, cap: eur('300.000', 3) },
      { rest: true },
    ]);
    expect([toDecimal(capped!), capped!.scale, toDecimal(rest!)]).toEqual(['300.00', 2, '700.00']);
    const [under] = schedule(eur('1000'), [{ percent: 30, cap: eur('299.99') }, { rest: true }]);
    expect(toDecimal(under!)).toBe('299.99');
  });
});

describe('chunk', () => {
  it('checks max and total', () => {
    for (const max of [eur('0'), eur('-1')]) {
      expect(() => chunk(eur('10'), max)).toThrow(new RangeError('chunk() max must be positive'));
    }
    expect(() => chunk(eur('-10'), eur('3'))).toThrow(
      new RangeError('chunk() total must not be negative'),
    );
  });

  it('adds no empty tranche when max divides the total', () => {
    expect(decimals(chunk(eur('600'), eur('300')))).toEqual(['300.00', '300.00']);
    expect(decimals(chunk(eur('700'), eur('300')))).toEqual(['300.00', '300.00', '100.00']);
    expect(decimals(chunk(eur('0'), eur('300')))).toEqual(['0.00']);
    expect(decimals(chunk(eur('300'), eur('300')))).toEqual(['300.00']);
  });
});
