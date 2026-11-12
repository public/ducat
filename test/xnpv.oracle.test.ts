// test/fixtures/xnpv.oracle.json and xirr.oracle.json are printed by proofs/Oracle.lean from the
// model of xnpvScaled, xnpvBounds, xnpv and xirr in proofs/Ducat/XnpvModel.lean, built from the
// definitions the proofs are about (the roots, the fixed-point powers and products, the shared
// bisection). The TypeScript must match it exactly: the same bounds at the same precision, the same
// rounded values, the same floored rates, and a throw where the model has none.
import '../src/plugins/core.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ratio, type Ratio } from '../src/decimal.js';
import { xirr, xnpv, xnpvBounds } from '../src/excel.js';
import { fromMinor, type Money } from '../src/money.js';
import type { RoundingMode } from '../src/rounding.js';

interface XnpvCase {
  currency: string;
  /** the rate as a reduced numerator and denominator */
  rate: [string, string];
  /** days after the first date */
  days: number[];
  values: string[];
  digits: number;
  bounds: { lower: string; upper: string; exact: boolean } | null;
  rounded: Partial<Record<RoundingMode, string | null>>;
}

interface XirrCase {
  currency: string;
  days: number[];
  values: string[];
  digits: number;
  lower: string | null;
}

const load = <T>(name: string): T[] =>
  (
    JSON.parse(
      readFileSync(new URL(`./fixtures/${name}.oracle.json`, import.meta.url), 'utf8'),
    ) as {
      cases: T[];
    }
  ).cases;

const xnpvCases = load<XnpvCase>('xnpv');
const xirrCases = load<XirrCase>('xirr');

const START = Date.UTC(2001, 0, 1);
const dateOf = (day: number): string =>
  new Date(START + day * 86_400_000).toISOString().slice(0, 10);
const flowsOf = (vector: { currency: string; values: string[]; days: number[] }) => ({
  values: vector.values.map((minor): Money => fromMinor(BigInt(minor), vector.currency)),
  dates: vector.days.map(dateOf),
});
const text = (value: Ratio): string => `${value.num}/${value.den}`;
/** the result, or null where it throws a RangeError */
const attempt = <T>(run: () => T): T | null => {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
};

describe('xnpvBounds, xnpv and xirr match the Lean model', () => {
  it('has the cases', () => {
    expect(xnpvCases.length).toBeGreaterThanOrEqual(100);
    expect(xirrCases.length).toBeGreaterThanOrEqual(25);
  });

  it('xnpvBounds: the same lower and upper ends, and exact where the model is', () => {
    const mismatches = xnpvCases.filter((vector) => {
      const { values, dates } = flowsOf(vector);
      const rate = ratio(BigInt(vector.rate[0]), BigInt(vector.rate[1]));
      const result = attempt(() => xnpvBounds(rate, values, dates, { digits: vector.digits }));
      const actual =
        result === null
          ? null
          : { lower: text(result.lower), upper: text(result.upper), exact: result.exact };
      return JSON.stringify(actual) !== JSON.stringify(vector.bounds);
    });
    expect(mismatches).toEqual([]);
  });

  it('xnpv: the same rounded value in every mode', () => {
    const mismatches: string[] = [];
    xnpvCases.forEach((vector, index) => {
      const { values, dates } = flowsOf(vector);
      const rate = ratio(BigInt(vector.rate[0]), BigInt(vector.rate[1]));
      for (const [mode, want] of Object.entries(vector.rounded)) {
        const result = attempt(() => xnpv(rate, values, dates, {}, mode as RoundingMode));
        const actual = result === null ? null : result.toMinor().toString();
        if (actual !== want) {
          mismatches.push(`case ${index} ${mode}: ${actual} != ${want}`);
        }
      }
    });
    expect(mismatches).toEqual([]);
  });

  it('xirr: the same floored rate, or a throw where the model has none', () => {
    const mismatches = xirrCases.filter((vector) => {
      const { values, dates } = flowsOf(vector);
      const result = attempt(() => xirr(values, dates, { digits: vector.digits }));
      const actual = result === null ? null : BigInt(result.lower.replace('.', '')).toString();
      return actual !== vector.lower;
    });
    expect(xirrCases.filter((vector) => vector.lower !== null).length).toBeGreaterThan(20);
    expect(mismatches).toEqual([]);
  });
});
