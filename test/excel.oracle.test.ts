// Reference vectors for @ducatjs/money/excel computed by scripts/gen-finance-vectors.py: a second,
// independent implementation of each function's definition, in exact fractions, with its own
// bounds (from Python's correctly rounded decimal ln and exp) where the value is irrational.
// Random cases plus the edge cases in scripts/excel_edge_cases.py, which Calc also computes.
import '../src/plugins/core.js'; // ExactMoney#round
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Ratio } from '../src/decimal.js';
import {
  fv,
  fvExact,
  nper,
  pmt,
  pmtExact,
  pv,
  pvExact,
  rate,
  xirr,
  xnpv,
  xnpvBounds,
} from '../src/excel.js';
import type { DayCount } from '../src/finance.js';
import { fromMinor, type Money } from '../src/money.js';
import type { RoundingMode } from '../src/rounding.js';

type Rounded = Record<RoundingMode, string>;

interface Vectors {
  annuities: {
    currency: string;
    rate: string;
    nper: number;
    type: 0 | 1;
    pmt: string;
    pv: string;
    fv: string;
    results: Partial<Record<'fv' | 'pv' | 'pmt', { exact: string; rounded: Rounded }>>;
    note?: string;
  }[];
  nper: {
    currency: string;
    rate: string;
    type: 0 | 1;
    digits: number;
    pmt: string;
    pv: string;
    fv: string;
    lower: string;
    exact?: string;
    note?: string;
  }[];
  rate: {
    currency: string;
    nper: number;
    type: 0 | 1;
    digits: number;
    pmt: string;
    pv: string;
    fv: string;
    lower: string;
    note?: string;
  }[];
  xnpv: {
    currency: string;
    rate: string;
    values: string[];
    dates: string[];
    digits: number;
    dayCount?: DayCount;
    exact?: string;
    low?: string;
    high?: string;
    rounded: Rounded;
    note?: string;
  }[];
  xirr: {
    currency: string;
    values: string[];
    dates: string[];
    digits: number;
    lower: string;
    note?: string;
  }[];
}

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, 'vectors', 'excel.json'), 'utf8'),
) as Vectors;

const amount = (minor: string, currency: string): Money => fromMinor(BigInt(minor), currency);
const minorOf = (value: Money): string => value.toMinor().toString();
/** a result on the grid of `digits` places, as an integer count of 10^-digits */
const gridOf = (text: string): string => BigInt(text.replace('.', '')).toString();
/** a numerator/denominator string as a pair of bigints */
const fraction = (text: string): [bigint, bigint] => {
  const [num, den] = text.split('/');
  return [BigInt(num!), BigInt(den!)];
};
/** a decimal string as a pair of bigints */
const decimal = (text: string): [bigint, bigint] => {
  const [whole, places = ''] = text.split('.');
  return [BigInt(whole! + places), 10n ** BigInt(places.length)];
};
const pair = (value: Ratio): [bigint, bigint] => [value.num, value.den];
const atMost = ([a, b]: [bigint, bigint], [c, d]: [bigint, bigint]) => a * d <= c * b;
const equal = ([a, b]: [bigint, bigint], [c, d]: [bigint, bigint]) => a * d === c * b;
const MODES = Object.keys(vectors.xnpv[0]!.rounded) as RoundingMode[];
const label = (vector: { note?: string }, index: number) => vector.note ?? `case ${index}`;

describe('excel matches the Python oracle', () => {
  it('fv, pv and pmt: the exact values, and each rounded once in every mode', () => {
    const mismatches: string[] = [];
    vectors.annuities.forEach((vector, index) => {
      const money = (minor: string) => amount(minor, vector.currency);
      const timing = { type: vector.type };
      const runs = {
        fv: {
          exact: () =>
            fvExact(vector.rate, vector.nper, money(vector.pmt), {
              ...timing,
              pv: money(vector.pv),
            }),
          rounded: (mode: RoundingMode) =>
            fv(
              vector.rate,
              vector.nper,
              money(vector.pmt),
              { ...timing, pv: money(vector.pv) },
              mode,
            ),
        },
        pv: {
          exact: () =>
            pvExact(vector.rate, vector.nper, money(vector.pmt), {
              ...timing,
              fv: money(vector.fv),
            }),
          rounded: (mode: RoundingMode) =>
            pv(
              vector.rate,
              vector.nper,
              money(vector.pmt),
              { ...timing, fv: money(vector.fv) },
              mode,
            ),
        },
        pmt: {
          exact: () =>
            pmtExact(vector.rate, vector.nper, money(vector.pv), {
              ...timing,
              fv: money(vector.fv),
            }),
          rounded: (mode: RoundingMode) =>
            pmt(
              vector.rate,
              vector.nper,
              money(vector.pv),
              { ...timing, fv: money(vector.fv) },
              mode,
            ),
        },
      };
      for (const [name, want] of Object.entries(vector.results)) {
        const run = runs[name as keyof typeof runs];
        const exact = run.exact();
        if (!equal([BigInt(exact.numerator), BigInt(exact.denominator)], fraction(want.exact))) {
          mismatches.push(`${label(vector, index)}: ${name} exact`);
        }
        for (const mode of MODES) {
          if (minorOf(run.rounded(mode)) !== want.rounded[mode]) {
            mismatches.push(`${label(vector, index)}: ${name} ${mode}`);
          }
        }
      }
    });
    expect(vectors.annuities.length).toBeGreaterThan(200);
    expect(mismatches).toEqual([]);
  });

  it('nper: the floor on the grid, exact where the value is a grid point (or the rate is 0)', () => {
    const mismatches = vectors.nper.filter((vector) => {
      const money = (minor: string) => amount(minor, vector.currency);
      const run = () =>
        nper(vector.rate, money(vector.pmt), money(vector.pv), {
          fv: money(vector.fv),
          type: vector.type,
          digits: vector.digits,
        });
      if (vector.lower === 'throws') {
        expect(run).toThrow(RangeError);
        return false;
      }
      const result = run();
      const exactMatches =
        vector.exact === undefined
          ? result.exact === undefined
          : result.exact !== undefined && equal(pair(result.exact), fraction(vector.exact));
      return gridOf(result.lower) !== vector.lower || result.nper !== result.lower || !exactMatches;
    });
    expect(vectors.nper.filter((vector) => vector.exact !== undefined).length).toBeGreaterThan(10);
    expect(mismatches).toEqual([]);
  });

  it('rate: the floored root on the grid, including ill-conditioned rates near 0', () => {
    const mismatches = vectors.rate.filter((vector) => {
      const money = (minor: string) => amount(minor, vector.currency);
      const result = rate(vector.nper, money(vector.pmt), money(vector.pv), {
        fv: money(vector.fv),
        type: vector.type,
        digits: vector.digits,
      });
      return gridOf(result.lower) !== vector.lower || result.rate !== result.lower;
    });
    expect(vectors.rate.filter((vector) => vector.note?.startsWith('ill-conditioned')).length).toBe(
      3,
    );
    expect(mismatches).toEqual([]);
  });

  it("xnpvBounds: the oracle's narrow bounds lie inside ducat's, exact where the value is rational", () => {
    const mismatches = vectors.xnpv.filter((vector) => {
      const values = vector.values.map((minor) => amount(minor, vector.currency));
      const options = { digits: vector.digits, dayCount: vector.dayCount };
      const { lower, upper, exact } = xnpvBounds(vector.rate, values, vector.dates, options);
      if (vector.exact !== undefined) {
        const value = fraction(vector.exact);
        return !(exact && equal(pair(lower), value) && equal(pair(upper), value));
      }
      const width: [bigint, bigint] = [
        upper.num * lower.den - lower.num * upper.den,
        upper.den * lower.den,
      ];
      return (
        exact ||
        !atMost(pair(lower), decimal(vector.low!)) ||
        !atMost(decimal(vector.high!), pair(upper)) ||
        !atMost(width, [1n, 10n ** BigInt(vector.digits)])
      );
    });
    expect(vectors.xnpv.filter((vector) => vector.exact !== undefined).length).toBeGreaterThan(5);
    expect(mismatches).toEqual([]);
  });

  it('xnpv: the value rounded once, in every mode', () => {
    const mismatches: string[] = [];
    vectors.xnpv.forEach((vector, index) => {
      const values = vector.values.map((minor) => amount(minor, vector.currency));
      for (const mode of MODES) {
        const result = xnpv(vector.rate, values, vector.dates, { dayCount: vector.dayCount }, mode);
        if (minorOf(result) !== vector.rounded[mode]) {
          mismatches.push(`${label(vector, index)}: ${mode}`);
        }
      }
    });
    expect(mismatches).toEqual([]);
  });

  it('xirr: the floored root on the grid', () => {
    const mismatches = vectors.xirr.filter((vector) => {
      const values = vector.values.map((minor) => amount(minor, vector.currency));
      const result = xirr(values, vector.dates, { digits: vector.digits });
      return gridOf(result.lower) !== vector.lower || result.rate !== result.lower;
    });
    expect(vectors.xirr.length).toBeGreaterThan(80);
    expect(mismatches).toEqual([]);
  });
});
