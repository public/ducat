import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exact } from '../src/exact.js';
import { ratio } from '../src/decimal.js';
import { fromMinor, money, toMinor, toMinorNumber, toNumber } from '../src/fn.js';
import { RoundingError } from '../src/rounding.js';
import { runs } from './fc-config.js';

// An independent oracle: a double's exact value as a rational, and whether it is the nearest
// double to num/den (ties to even), checked against both neighbours with bigint arithmetic.
const view = new DataView(new ArrayBuffer(8));
function bits(value: number): bigint {
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}
function fromBits(value: bigint): number {
  view.setBigUint64(0, value);
  return view.getFloat64(0);
}
function exactOf(value: number): { num: bigint; den: bigint } {
  const raw = bits(Math.abs(value));
  const exponent = Number(raw >> 52n);
  const fraction = raw & ((1n << 52n) - 1n);
  const mantissa = exponent === 0 ? fraction : fraction | (1n << 52n);
  const power = (exponent === 0 ? 1 : exponent) - 1075;
  const sign = value < 0 ? -1n : 1n;
  return power >= 0
    ? { num: sign * mantissa * 2n ** BigInt(power), den: 1n }
    : { num: sign * mantissa, den: 2n ** BigInt(-power) };
}
/** |a − num/den| scaled by a common positive denominator, so distances compare exactly. */
function distance(value: number, num: bigint, den: bigint, common: bigint): bigint {
  const point = exactOf(value);
  const diff = (point.num * den - num * point.den) * (common / (point.den * den));
  return diff < 0n ? -diff : diff;
}
function isNearest(value: number, num: bigint, den: bigint): boolean {
  if (!Number.isFinite(value) || value === 0) {
    return num === 0n && Object.is(value, 0);
  }
  const raw = bits(value);
  const neighbours = [fromBits(raw + 1n), fromBits(raw - 1n)].filter(Number.isFinite);
  const dens = [value, ...neighbours].map((point) => exactOf(point).den * den);
  const common = dens.reduce((a, b) => (a > b ? a : b));
  const own = distance(value, num, den, common);
  return neighbours.every((other) => {
    const theirs = distance(other, num, den, common);
    // On a tie the even mantissa wins.
    return own < theirs || (own === theirs && (raw & 1n) === 0n);
  });
}

describe('toNumber', () => {
  it('is the amount in major units', () => {
    expect(toNumber(money('12.34', 'EUR'))).toBe(12.34);
    expect(toNumber(money('-0.05', 'EUR'))).toBe(-0.05);
    expect(toNumber(money('1234', 'JPY'))).toBe(1234);
    expect(money('7.50', 'EUR').toNumber()).toBe(7.5);
    expect(Object.is(toNumber(money('0', 'EUR')), 0)).toBe(true);
    expect(Object.is(toNumber(money('-0.00', 'EUR')), 0)).toBe(true);
  });

  // dinero.js 1 #84: Dinero({ amount: 100000 * 10 ** 18, precision: 18 }).toUnit() was
  // 99999.99999999999, because it divided by 10^18 as a float.
  it('rounds once at precision 18', () => {
    expect(toNumber(fromMinor(100000n * 10n ** 18n, 'EUR', 18))).toBe(100000);
    expect(toNumber(fromMinor(10n ** 18n + 1n, 'EUR', 18))).toBe(1);
    expect(toNumber(fromMinor(123456789012345678n, 'EUR', 18))).toBe(
      Number('0.123456789012345678'),
    );
    expect(toNumber(fromMinor(-(3n * 10n ** 17n), 'EUR', 18))).toBe(-0.3);
    for (let value = 1n; value <= 10n ** 6n; value *= 10n) {
      expect(toNumber(fromMinor(value * 10n ** 18n, 'EUR', 18))).toBe(Number(value));
    }
  });

  // dinero.js 2 #294: toUnit of 1000000000000000050n cents (10000000000000000.50 USD) can't be
  // exact as a number, so ducat says so by name and gives the nearest double.
  it('gives the nearest double beyond 2^53', () => {
    expect(toNumber(fromMinor(1000000000000000050n, 'USD'))).toBe(Number('10000000000000000.50'));
    expect(toNumber(fromMinor(1000000000000000050n, 'USD'))).toBe(1e16);
    expect(toNumber(fromMinor(2n ** 53n + 1n, 'JPY'))).toBe(2 ** 53);
    expect(toNumber(fromMinor(2n ** 53n + 3n, 'JPY'))).toBe(2 ** 53 + 4); // tie to even
  });

  it('is Infinity beyond the largest double, as Number() and Fixed#toNumber are', () => {
    expect(toNumber(fromMinor(10n ** 309n, 'JPY'))).toBe(Infinity);
    expect(toNumber(fromMinor(-(10n ** 309n), 'JPY'))).toBe(-Infinity);
  });

  it('is the nearest double to the exact amount', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }),
        fc.integer({ min: 0, max: 30 }),
        (minor, scale) => {
          const value = toNumber(fromMinor(minor, 'EUR', scale));
          return isNearest(value, minor, 10n ** BigInt(scale));
        },
      ),
      { numRuns: runs(500) },
    );
  });
});

describe('toMinorNumber({ lossy: true })', () => {
  it('equals toMinorNumber wherever that is safe', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: 6 }),
        (units, extra) => {
          const amount = fromMinor(BigInt(units) * 10n ** BigInt(extra), 'EUR', 2 + extra);
          return toMinorNumber(amount, { lossy: true }) === toMinorNumber(amount);
        },
      ),
      { numRuns: runs(300) },
    );
  });

  it('gives the nearest double beyond 2^53 instead of throwing', () => {
    const big = fromMinor(1000000000000000050n, 'USD');
    expect(() => toMinorNumber(big)).toThrow(RangeError);
    expect(toMinorNumber(big, { lossy: true })).toBe(Number(1000000000000000050n));
    expect(toMinorNumber(big, { lossy: true })).toBe(1e18);
    expect(big.toMinorNumber({ lossy: true })).toBe(1e18);
    expect(() => toMinorNumber(big, { lossy: false })).toThrow(RangeError);
    // At a scale above the exponent, the trailing zeros are dropped exactly first.
    expect(toMinorNumber(fromMinor(10n ** 40n, 'EUR', 20), { lossy: true })).toBe(1e22);
  });

  it('still throws a RoundingError for digits below the minor unit', () => {
    expect(() => toMinorNumber(money('12.345', 'EUR', { scale: 3 }), { lossy: true })).toThrow(
      RoundingError,
    );
  });

  it('is the nearest double to toMinor', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }), (minor) => {
        const amount = fromMinor(minor, 'EUR');
        return isNearest(toMinorNumber(amount, { lossy: true }), toMinor(amount), 1n);
      }),
      { numRuns: runs(300) },
    );
  });

  it('is Infinity beyond the largest double', () => {
    expect(toMinorNumber(fromMinor(10n ** 309n, 'JPY'), { lossy: true })).toBe(Infinity);
  });
});

describe('ExactMoney#toNumber', () => {
  it('is the nearest double to the exact value', () => {
    expect(exact(money('10', 'EUR')).divide(3).toNumber()).toBe(10 / 3);
    expect(exact(money('-10', 'EUR')).divide(3).toNumber()).toBe(-10 / 3);
    expect(exact(money('1', 'EUR')).divide(7).toNumber()).toBe(1 / 7);
    expect(exact(money('12.34', 'EUR')).toNumber()).toBe(12.34);
    expect(Object.is(exact(money('0', 'EUR')).toNumber(), 0)).toBe(true);
    expect(exact(fromMinor(100000n * 10n ** 18n, 'EUR', 18)).toNumber()).toBe(100000);
  });

  it('agrees with Money#toNumber on terminating values', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }),
        fc.integer({ min: 0, max: 30 }),
        (minor, scale) => {
          const amount = fromMinor(minor, 'EUR', scale);
          return exact(amount).toNumber() === toNumber(amount);
        },
      ),
      { numRuns: runs(300) },
    );
  });

  it('rounds any ratio once, ties to even', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 60n), max: 10n ** 60n }),
        fc.bigInt({ min: 1n, max: 10n ** 60n }),
        (num, den) => {
          const value = exact(money('1', 'EUR')).multiply(ratio(num, den));
          return isNearest(value.toNumber(), value.num, value.den);
        },
      ),
      { numRuns: runs(500) },
    );
    // Exact ties between two doubles.
    const tie = ratio(2n ** 53n + 1n, 1n);
    expect(exact(money('1', 'JPY')).multiply(tie).toNumber()).toBe(2 ** 53);
    const tieUp = ratio(2n ** 54n + 6n, 2n);
    expect(exact(money('1', 'JPY')).multiply(tieUp).toNumber()).toBe(2 ** 53 + 4);
  });

  it('handles the extremes of the double range', () => {
    const tiny = exact(money('1', 'EUR'))
      .divide(ratio(1n, 1n))
      .divide(10n ** 300n);
    expect(tiny.toNumber()).toBe(1e-300);
    const huge = exact(fromMinor(10n ** 308n, 'JPY'));
    expect(huge.toNumber()).toBe(1e308);
    expect(exact(fromMinor(10n ** 309n, 'JPY')).toNumber()).toBe(Infinity);
    expect(exact(fromMinor(-(10n ** 309n), 'JPY')).toNumber()).toBe(-Infinity);
    expect(
      exact(money('1', 'EUR'))
        .divide(10n ** 320n)
        .toNumber(),
    ).toBe(1e-320); // subnormal
    expect(
      Object.is(
        exact(money('1', 'EUR'))
          .divide(10n ** 400n)
          .toNumber(),
        0,
      ),
    ).toBe(true);
  });
});

describe('the lossy conversions are for callers only', () => {
  // The issue's promise: ducat never uses its own lossy conversions. Only the entries re-export
  // toNumber, and no source passes { lossy: true }.
  it('are not used inside src/', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (path.endsWith('.ts')) {
          const source = readFileSync(path, 'utf8');
          const entryFile = /(fn|plugins[\\/](core|all))\.ts$/.test(path);
          const importsToNumber = /import \{[^}]*\btoNumber\b[^}]*\} from '[./]+money\.js'/.test(
            source,
          );
          const code = source.split('\n').filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
          if (
            code.some((line) => line.includes('lossy: true')) ||
            (importsToNumber && !entryFile)
          ) {
            offenders.push(path);
          }
        }
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });
});
