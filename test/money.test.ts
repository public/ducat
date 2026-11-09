import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  abs,
  add,
  clamp,
  compare,
  CurrencyMismatchError,
  defineCurrency,
  divide,
  equals,
  fromJSON,
  fromMinor,
  greaterThan,
  isNegative,
  isZero,
  max,
  min,
  money,
  multiply,
  negate,
  ratio,
  round,
  RoundingError,
  subtract,
  sum,
  toDecimal,
  toMinor,
  toMinorNumber,
  toScale,
  toScaledUnits,
  zero,
  type Money,
} from '../src/fn.js';

const eur = (s: string, o?: Parameters<typeof money>[2]) => money(s, 'EUR', o);

describe('construction', () => {
  it('parses exact decimal strings', () => {
    expect(eur('12.34').minor).toBe(1234);
    expect(eur('12.3').minor).toBe(1230);
    expect(eur('-0.05').minor).toBe(-5);
    expect(eur('+7').minor).toBe(700);
    expect(eur('12.3400').minor).toBe(1234); // trailing zeros are fine
    expect(money('1000', 'JPY').minor).toBe(1000);
    expect(money('1.234', 'KWD').minor).toBe(1234);
    expect(money('1.2345', 'CLF').minor).toBe(12345);
  });
  it('rejects excess precision unless a rounding mode or scale is given', () => {
    expect(() => eur('12.345')).toThrow(RoundingError);
    expect(eur('12.345', { rounding: 'halfEven' }).minor).toBe(1234);
    expect(eur('12.345', { scale: 3 }).minor).toBe(12345);
    expect(() => money('1.5', 'JPY')).toThrow(/more than 0 decimal/);
  });
  it('rejects exponents and fraction lengths beyond 1000 instead of building huge powers of ten', () => {
    expect(() => eur('1e999999999')).toThrow(RangeError);
    expect(() => eur('1e-999999999')).toThrow(RangeError);
    expect(() => eur('0.' + '0'.repeat(1000) + '1')).toThrow(RangeError);
    expect(() => ratio('1e5000')).toThrow(RangeError);
    expect(() => fromJSON({ amount: '1e999999999', currency: 'EUR' })).toThrow(RangeError);
    // still fine just inside the limits
    expect(eur('1e2').minor).toBe(10000);
    expect(eur('0.' + '0'.repeat(997) + '1', { rounding: 'floor' }).minor).toBe(0);
    expect(ratio('1e-1000').den).toBe(10n ** 1000n);
  });
  it('integers are major units; floats are taken at their shortest decimal form', () => {
    expect(money(12, 'EUR').minor).toBe(1200);
    expect(money(12.34, 'EUR').minor).toBe(1234);
    expect(money(1e-7, 'EUR', { scale: 7 }).minor).toBe(1);
    expect(() => money(0.1 + 0.2, 'EUR')).toThrow(RoundingError); // 0.30000000000000004 is not silently 0.30
    expect(() => money(NaN, 'EUR')).toThrow(/Invalid amount NaN/);
  });
  it('rejects malformed input', () => {
    for (const bad of ['', '-', '1.', '.5', '1,5', '1..2', 'abc', '1 2', '0x10', 'Infinity'])
      expect(() => eur(bad)).toThrow(SyntaxError);
  });
  it('rejects unknown currencies but accepts registered ones', () => {
    expect(() => money('1', 'XYZ')).toThrow(/Unknown currency/);
    defineCurrency('BTC', 8);
    expect(money('0.00000001', 'BTC').minor).toBe(1);
    expect(() => defineCurrency('EUR', 3)).toThrow(/cannot be redefined/);
    expect(() => money('1', 'toString')).toThrow(/Unknown currency/);
  });
  it('fromMinor requires safe integers', () => {
    expect(fromMinor(1234, 'EUR').toString()).toBe('12.34 EUR');
    expect(() => fromMinor(1.5, 'EUR')).toThrow('Minor units must be an integer, got 1.5');
    expect(() => fromMinor(12.3, 'EUR', 2)).toThrow('Minor units must be an integer, got 12.3');
    expect(() => fromMinor(NaN, 'EUR')).toThrow('Minor units must be an integer, got NaN');
    expect(() => fromMinor(2 ** 53, 'EUR')).toThrow(
      'Minor units must be a safe integer, got 9007199254740992; pass a bigint',
    );
    expect(fromMinor(2n ** 64n, 'EUR').minor).toBe(2n ** 64n);
    expect(fromMinor(5n, 'EUR').minor).toBe(5); // normalised back to a number
  });
});

describe('number/bigint representation', () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  it('overflows into bigint and comes back', () => {
    const a = fromMinor(MAX, 'EUR');
    const b = add(a, fromMinor(1, 'EUR'));
    expect(b.minor).toBe(BigInt(MAX) + 1n);
    const c = subtract(b, fromMinor(2, 'EUR'));
    expect(c.minor).toBe(MAX - 1);
    expect(typeof c.minor).toBe('number');
  });
  it('huge amounts stay exact', () => {
    const m = money('123456789012345678901234567890.12', 'USD');
    expect(toDecimal(m)).toBe('123456789012345678901234567890.12');
    expect(toDecimal(multiply(m, 3))).toBe('370370367037037036703703703670.36');
    expect(toDecimal(multiply(m, '1.5', 'halfEven'))).toBe('185185183518518518351851851835.18');
  });
});

describe('arithmetic', () => {
  it('add / subtract / negate / abs', () => {
    expect(toDecimal(add(eur('0.10'), eur('0.20')))).toBe('0.30');
    expect(toDecimal(subtract(eur('0.10'), eur('0.30')))).toBe('-0.20');
    expect(toDecimal(negate(eur('1.00')))).toBe('-1.00');
    expect(Object.is(negate(zero('EUR')).minor, -0)).toBe(false);
    expect(toDecimal(abs(eur('-3.21')))).toBe('3.21');
  });
  it('currency mismatch is a runtime error when types are erased', () => {
    const usd = money('1', 'USD') as Money<string>;
    expect(() => add(eur('1') as Money<string>, usd)).toThrow(CurrencyMismatchError);
    expect(() => compare(eur('1') as Money<string>, usd)).toThrow(CurrencyMismatchError);
    expect(equals(eur('1'), usd)).toBe(false);
  });
  it('mixed scales are aligned exactly', () => {
    const fine = money('0.001', 'EUR', { scale: 3 });
    const r = add(eur('1.00'), fine);
    expect(r.scale).toBe(3);
    expect(toDecimal(r)).toBe('1.001');
    expect(equals(money('1.0', 'EUR', { scale: 1 }), eur('1'))).toBe(true);
  });
  it('multiply / divide round half away from zero by default; unnecessary throws', () => {
    expect(toDecimal(multiply(eur('10.00'), '1.075', 'halfEven'))).toBe('10.75');
    expect(toDecimal(multiply(eur('0.05'), '0.5', 'halfEven'))).toBe('0.02');
    expect(toDecimal(multiply(eur('0.05'), '0.5', 'halfExpand'))).toBe('0.03');
    expect(toDecimal(multiply(eur('0.05'), '0.5'))).toBe('0.03'); // default: halfExpand
    expect(toDecimal(multiply(eur('-0.05'), '0.5'))).toBe('-0.03'); // ties away from zero, not towards +inf
    expect(toDecimal(divide(eur('10.00'), 3))).toBe('3.33');
    expect(() => multiply(eur('0.05'), '0.5', 'unnecessary')).toThrow(RoundingError);
    expect(() => divide(eur('10.00'), 3, 'unnecessary')).toThrow(RoundingError);
    expect(toDecimal(multiply(eur('1.00'), ratio(1, 3), 'halfEven'))).toBe('0.33');
    expect(toDecimal(multiply(eur('1.00'), '1/3', 'ceil'))).toBe('0.34');
    expect(toDecimal(divide(eur('10.00'), 3, 'halfEven'))).toBe('3.33');
    expect(toDecimal(divide(eur('10.00'), 4))).toBe('2.50');
    expect(() => divide(eur('1'), 0)).toThrow(/zero/);
    expect(toDecimal(multiply(eur('19.99'), 0.1, 'halfEven'))).toBe('2.00'); // 0.1 means exactly 1/10
  });
  it('sum', () => {
    expect(toDecimal(sum([eur('0.10'), eur('0.20'), eur('0.30')]))).toBe('0.60');
    expect(toDecimal(sum([], 'EUR'))).toBe('0.00');
    expect(() => sum([])).toThrow(/needs a currency/);
    const big = [
      fromMinor(Number.MAX_SAFE_INTEGER, 'EUR'),
      fromMinor(Number.MAX_SAFE_INTEGER, 'EUR'),
      eur('1'),
    ];
    expect(sum(big).minor).toBe(2n * BigInt(Number.MAX_SAFE_INTEGER) + 100n);
  });
  it('round / toScale', () => {
    const fine = money('2.675', 'GBP', { scale: 3 }); // the classic float trap: (2.675).toFixed(2) === '2.67'
    expect(toDecimal(round(fine, 'halfExpand'))).toBe('2.68');
    expect(toDecimal(toScale(eur('1.5'), 4))).toBe('1.5000');
    expect(toDecimal(toScale(fine, 2))).toBe('2.68'); // default: halfExpand
    expect(() => toScale(fine, 2, 'unnecessary')).toThrow(RoundingError);
    expect(() => money('1.005', 'EUR')).toThrow(RoundingError); // parsing stays strict
  });
});

describe('comparison', () => {
  it('compare/min/max/clamp/predicates', () => {
    expect(compare(eur('1'), eur('2'))).toBe(-1);
    expect(compare(fromMinor(2n ** 60n, 'EUR'), eur('1'))).toBe(1);
    expect(greaterThan(eur('1.01'), eur('1'))).toBe(true);
    expect(toDecimal(min(eur('3'), eur('1'), eur('2')))).toBe('1.00');
    expect(toDecimal(max(eur('3'), eur('1'), eur('2')))).toBe('3.00');
    expect(toDecimal(clamp(eur('5'), eur('0'), eur('3')))).toBe('3.00');
    expect(isZero(eur('0'))).toBe(true);
    expect(isNegative(eur('-0.01'))).toBe(true);
  });
  it('blocks accidental primitive coercion', () => {
    const a = eur('1') as unknown as number;
    expect(() => a + 1).toThrow(TypeError);
    expect(() => (a as number) > 0).toThrow(TypeError);
    expect(`${eur('1')}`).toBe('1.00 EUR');
  });
});

describe('serialisation', () => {
  it('JSON', () => {
    expect(JSON.stringify(eur('12.34'))).toBe('{"amount":"12.34","currency":"EUR"}');
    expect(toDecimal(fromJSON('{"amount":"12.34","currency":"EUR"}'))).toBe('12.34');
    expect(() => fromJSON({ amount: 12.34, currency: 'EUR' } as never)).toThrow(TypeError);
  });
  it('minor units', () => {
    expect(toMinor(eur('12.34'))).toBe(1234n);
    expect(toMinorNumber(eur('12.34'))).toBe(1234);
    expect(() => toMinorNumber(fromMinor(2n ** 60n, 'EUR'))).toThrow(
      /does not fit in a safe integer/,
    );
  });
  it("minor units are the currency's at every scale", () => {
    // below the exponent: scaled up exactly
    expect(toMinor(eur('1.5', { scale: 1 }))).toBe(150n);
    expect(toMinorNumber(eur('1.5', { scale: 1 }))).toBe(150);
    expect(toMinor(money('7', 'KWD', { scale: 0 }))).toBe(7000n);
    // equal
    expect(toMinor(fromMinor(1234, 'EUR', 2))).toBe(1234n);
    // above, with zero sub-minor digits: exact
    expect(toMinor(fromMinor(12340, 'EUR', 3))).toBe(1234n);
    expect(toMinorNumber(fromMinor(-12340, 'EUR', 3))).toBe(-1234);
    expect(toMinor(fromMinor(10n ** 40n, 'EUR', 20))).toBe(10n ** 22n);
    // above, with digits below the cent: the caller has to round
    expect(() => toMinor(fromMinor(1234, 'EUR', 3))).toThrow(RoundingError);
    expect(() => toMinorNumber(fromMinor(1234, 'EUR', 3))).toThrow(
      /1.234 EUR has digits below the minor unit; round\(\) it first/,
    );
    expect(() => fromMinor(1234, 'EUR', 3).toMinor()).toThrow(RoundingError);
    expect(toMinor(round(fromMinor(1234, 'EUR', 3), 'halfEven'))).toBe(123n);
    // a scale-0 JPY value is already in its minor unit
    expect(toMinor(money('-5', 'JPY'))).toBe(-5n);
    // too large for a number only after scaling up
    expect(() => toMinorNumber(fromMinor(2 ** 52, 'EUR', 1))).toThrow(RangeError);
  });
  it("scaled units are in the value's own scale", () => {
    expect(toScaledUnits(fromMinor(1234, 'EUR', 3))).toBe(1234n);
    expect(fromMinor(1234, 'EUR', 3).toScaledUnits()).toBe(1234n);
    expect(toScaledUnits(eur('1.5', { scale: 1 }))).toBe(15n);
    expect(toScaledUnits(fromMinor(2n ** 60n, 'EUR'))).toBe(2n ** 60n);
  });
});

describe('properties', () => {
  const amount = fc.oneof(
    fc.integer({ min: -1e12, max: 1e12 }),
    fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
    fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
  );
  const m = amount.map((v) => fromMinor(v, 'EUR'));
  it('add is associative and commutative, with zero as identity', () => {
    fc.assert(
      fc.property(m, m, m, (a, b, c) => {
        expect(equals(add(add(a, b), c), add(a, add(b, c)))).toBe(true);
        expect(equals(add(a, b), add(b, a))).toBe(true);
        expect(equals(add(a, zero('EUR')), a)).toBe(true);
        expect(equals(subtract(add(a, b), b), a)).toBe(true);
      }),
    );
  });
  it('agrees with bigint arithmetic', () => {
    fc.assert(
      fc.property(m, m, (a, b) => {
        expect(BigInt(add(a, b).minor)).toBe(BigInt(a.minor) + BigInt(b.minor));
        expect(compare(a, b)).toBe(
          BigInt(a.minor) < BigInt(b.minor) ? -1 : BigInt(a.minor) > BigInt(b.minor) ? 1 : 0,
        );
      }),
    );
  });
  it('representation invariant: number iff safe', () => {
    fc.assert(
      fc.property(m, m, (a, b) => {
        for (const r of [add(a, b), subtract(a, b), multiply(a, 3), negate(a)]) {
          const v = r.minor;
          if (typeof v === 'bigint')
            expect(
              v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER),
            ).toBe(true);
          else expect(Number.isSafeInteger(v)).toBe(true);
        }
      }),
    );
  });
  it('decimal string, JSON and minor-unit round trips', () => {
    fc.assert(
      fc.property(m, fc.constantFrom('EUR', 'JPY', 'KWD', 'CLF'), (a, cur) => {
        const x = fromMinor(a.minor, cur);
        expect(equals(money(toDecimal(x), cur), x)).toBe(true);
        expect(equals(fromJSON(JSON.parse(JSON.stringify(x))), x)).toBe(true);
        expect(equals(fromMinor(toMinor(x), cur), x)).toBe(true);
      }),
    );
  });
  it('toMinor round-trips through fromMinor at any scale that is exact at the exponent', () => {
    fc.assert(
      fc.property(
        m,
        fc.constantFrom('EUR', 'JPY', 'KWD', 'CLF'),
        fc.integer({ min: 0, max: 8 }),
        (a, cur, extra) => {
          // a value at a higher scale whose extra digits are zero, and the same at the exponent
          const atExponent = fromMinor(a.minor, cur);
          const rescaled = toScale(atExponent, atExponent.scale + extra);
          expect(toMinor(rescaled)).toBe(toMinor(atExponent));
          expect(equals(fromMinor(toMinor(rescaled), cur), rescaled)).toBe(true);
          expect(toScaledUnits(rescaled)).toBe(toMinor(atExponent) * 10n ** BigInt(extra));
        },
      ),
    );
  });
  it('toMinor throws exactly when a value has non-zero digits below the minor unit', () => {
    fc.assert(
      fc.property(m, fc.integer({ min: 1, max: 6 }), (a, extra) => {
        const value = fromMinor(a.minor, 'EUR', 2 + extra);
        const exact = BigInt(a.minor) % 10n ** BigInt(extra) === 0n;
        if (exact) {
          expect(toMinor(value)).toBe(BigInt(a.minor) / 10n ** BigInt(extra));
        } else {
          expect(() => toMinor(value)).toThrow(RoundingError);
        }
      }),
    );
  });
  it('multiply by a ratio matches the exact rational result', () => {
    fc.assert(
      fc.property(
        m,
        fc.integer({ min: -100000, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        (a, n, d) => {
          const r = multiply(a, ratio(n, d), 'floor');
          const exact = BigInt(a.minor) * BigInt(n);
          const lo = BigInt(r.minor) * BigInt(d);
          expect(lo <= exact && exact < lo + BigInt(d)).toBe(true);
        },
      ),
    );
  });
});

describe('ratio of two bigints', () => {
  it('equals the same ratio built from strings, in lowest terms with a positive denominator', () => {
    fc.assert(
      fc.property(
        fc.bigInt(-(10n ** 30n), 10n ** 30n),
        fc.bigInt(-(10n ** 30n), 10n ** 30n),
        (num, den) => {
          if (den === 0n) {
            expect(() => ratio(num, den)).toThrow(RangeError);
            return;
          }
          const direct = ratio(num, den);
          const viaStrings = ratio(`${num}/${den}`);
          expect([direct.num, direct.den, direct.n, direct.d]).toEqual([
            viaStrings.num,
            viaStrings.den,
            viaStrings.n,
            viaStrings.d,
          ]);
          expect(direct.den > 0n).toBe(true);
        },
      ),
    );
  });

  it('keeps divide, percentage and tax exact', () => {
    expect(toDecimal(money('100', 'EUR').divide(3))).toBe('33.33');
    expect(toDecimal(money('-100', 'EUR').divide('-3'))).toBe('33.33');
    expect(ratio(6n, -4n)).toMatchObject({ num: -3n, den: 2n, n: -3, d: 2 });
    expect(ratio(2n ** 60n, 2n ** 58n)).toMatchObject({ num: 4n, den: 1n, n: 4, d: 1 });
  });
});
