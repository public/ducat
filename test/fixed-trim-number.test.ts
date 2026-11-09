import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fixed, fromScaled } from '../src/fixed.js';

describe('Fixed#trimScale', () => {
  it('drops trailing zeros down to the minimum scale', () => {
    expect(fixed('12.3400').trimScale().toString()).toBe('12.34');
    expect(fixed('5.000').trimScale().toString()).toBe('5');
    expect(fixed('5.000').trimScale(2).toString()).toBe('5.00');
    expect(fixed('-0.500').trimScale().toString()).toBe('-0.5');
    expect(fixed('0.000').trimScale().toString()).toBe('0');
    expect(fixed('100').trimScale().toString()).toBe('100'); // never removes integer zeros
  });
  it('returns the value itself when nothing changes, and never adds digits', () => {
    const value = fixed('1.25');
    expect(value.trimScale()).toBe(value);
    expect(fixed('1.5').trimScale(3).toString()).toBe('1.5');
  });
  it('works beyond 2^53', () => {
    expect(
      fromScaled(2n ** 70n * 1000n, 5)
        .trimScale()
        .toString(),
    ).toBe(fromScaled(2n ** 70n, 2).toString());
  });
  it('validates the minimum scale', () => {
    expect(() => fixed('1.0').trimScale(-1)).toThrow(
      'Invalid scale -1: use an integer from 0 to 1000',
    );
  });
  it('property: the trimmed value is equal, at the smallest exact scale', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
        (scaled, scale, minimum) => {
          const value = fromScaled(scaled, scale);
          const trimmed = value.trimScale(minimum);
          expect(trimmed.equals(value)).toBe(true);
          expect(trimmed.scale).toBe(Math.min(scale, Math.max(minimum, trimmed.scale)));
          // one fewer decimal would lose a digit, unless it is already at the minimum
          if (trimmed.scale > minimum) {
            expect(() => trimmed.toScale(trimmed.scale - 1, 'unnecessary')).toThrow(RangeError);
          }
        },
      ),
    );
  });
});

describe('Fixed#toNumber', () => {
  it('gives the nearest double', () => {
    expect(fixed('0.1').toNumber()).toBe(0.1);
    expect(fixed('-12.340').toNumber()).toBe(-12.34);
    expect(fixed('0').toNumber()).toBe(0);
    expect(fixed('1e-7').toNumber()).toBe(1e-7);
    expect(fixed('9007199254740993').toNumber()).toBe(9007199254740992); // ties to even
    expect(fromScaled(10n ** 30n + 1n, 10).toNumber()).toBe(1e20);
  });
  it('implicit conversion still throws, and points to toNumber()', () => {
    expect(() => Number(fixed('1.5'))).toThrow(/use toNumber\(\) to accept a float/);
    expect(() => +fixed('1.5')).toThrow(TypeError);
  });
  it('property: equal to parsing the decimal string', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 40 }),
        (scaled, scale) => {
          const value = fromScaled(scaled, scale);
          expect(value.toNumber()).toBe(Number(value.toString()));
        },
      ),
    );
  });
});
