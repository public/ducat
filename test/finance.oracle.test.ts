// Reference vectors for /finance computed with Python's fractions module
// (scripts/gen-finance-vectors.py): a second, independent implementation of the definitions.
import '../src/plugins/core.js'; // the tests below use the Money methods
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  amortise,
  compound,
  interest,
  discountedSum,
  prorate,
  splitPeriod,
  yearFraction,
  type AmortisationMethod,
  type AmortisationResidual,
  type DayCount,
} from '../src/finance.js';
import { irr, npv, npvExact } from '../src/excel.js';
import { fromMinor, type Money } from '../src/money.js';
import type { RoundingMode } from '../src/rounding.js';

interface Vectors {
  yearFraction: {
    start: string;
    end: string;
    convention: DayCount;
    maturity?: boolean;
    want: string;
  }[];
  interest: {
    currency: string;
    principal: string;
    rate: string;
    from: string;
    to: string;
    dayCount: DayCount;
    maturity?: boolean;
    mode: RoundingMode;
    want: string;
  }[];
  compound: {
    currency: string;
    principal: string;
    rate: string;
    perYear: number;
    periods: number;
    mode: RoundingMode;
    want: string;
  }[];
  amortise: {
    currency: string;
    loan: string;
    rate: string;
    perYear: number;
    periods: number;
    method: AmortisationMethod;
    mode: RoundingMode;
    residual: AmortisationResidual;
    balloon?: string;
    payment: string;
    rows: number;
    totalInterest: string;
    last: [string, string, string, string];
    checksum: string;
  }[];
  npv: {
    currency: string;
    flows: string[];
    rate: string;
    mode: RoundingMode;
    npv: string;
    discountedSum: string;
  }[];
  irr: { currency: string; flows: string[]; digits: number; lower: string }[];
  irrBracketed: {
    currency: string;
    flows: string[];
    digits: number;
    bracket: [string, string];
    lower: string;
  }[];
  proration: {
    currency: string;
    price: string;
    period: [string, string];
    used: [string, string];
    at: string[];
    mode: RoundingMode;
    prorate: string;
    split: string[];
  }[];
  paymentDates: { firstPayment: string; perYear: number; count: number; dates: string[] }[];
}

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, 'vectors', 'finance.json'), 'utf8'),
) as Vectors;

const amount = (minor: string, currency: string): Money => fromMinor(BigInt(minor), currency);
const minorOf = (value: Money): string => value.toMinor().toString();

describe('finance matches the Python fractions oracle', () => {
  it('yearFraction', () => {
    const mismatches = vectors.yearFraction.filter((vector) => {
      let actual: string;
      try {
        const fraction = yearFraction(vector.start, vector.end, vector.convention, vector);
        actual = `${fraction.num}/${fraction.den}`;
      } catch (error) {
        actual =
          error instanceof RangeError && /maturity/.test(error.message) ? 'throws' : String(error);
      }
      return actual !== vector.want;
    });
    expect(vectors.yearFraction.length).toBeGreaterThan(800);
    expect(mismatches).toEqual([]);
  });

  it('interest', () => {
    const mismatches = vectors.interest.filter((vector) => {
      const principal = amount(vector.principal, vector.currency);
      const result = interest(principal, vector.rate, vector, vector.mode);
      return minorOf(result) !== vector.want;
    });
    expect(mismatches).toEqual([]);
  });

  it('compound', () => {
    const mismatches = vectors.compound.filter((vector) => {
      const principal = amount(vector.principal, vector.currency);
      const result = compound(principal, vector.rate, vector, vector.mode);
      return minorOf(result) !== vector.want;
    });
    expect(mismatches).toEqual([]);
  });

  it('amortise: payment, row count, interest, last row and a checksum of every row', () => {
    const mismatches = vectors.amortise.filter((vector) => {
      const loan = amount(vector.loan, vector.currency);
      const plan = amortise(loan, {
        rate: vector.rate,
        perYear: vector.perYear,
        periods: vector.periods,
        method: vector.method,
        rounding: vector.mode,
        residual: vector.residual,
        ...(vector.balloon === undefined
          ? {}
          : { balloon: amount(vector.balloon, vector.currency) }),
      });
      const last = plan.rows.at(-1)!;
      let checksum = 0n;
      plan.rows.forEach((row, i) => {
        checksum += BigInt(i + 1) * (row.payment.toMinor() + 7n * row.interest.toMinor());
      });
      const actual = {
        payment: minorOf(plan.payment),
        rows: plan.rows.length,
        totalInterest: minorOf(plan.totalInterest),
        last: [last.payment, last.interest, last.principal, last.balance].map(minorOf),
        checksum: String(checksum),
      };
      const expected = {
        payment: vector.payment,
        rows: vector.rows,
        totalInterest: vector.totalInterest,
        last: vector.last,
        checksum: vector.checksum,
      };
      return JSON.stringify(actual) !== JSON.stringify(expected);
    });
    expect(vectors.amortise.length).toBeGreaterThan(300);
    expect(mismatches).toEqual([]);
  });

  it('npv', () => {
    const mismatches = vectors.npv.filter((vector) => {
      const flows = vector.flows.map((flow) => amount(flow, vector.currency));
      const actual = [
        npv(vector.rate, flows, vector.mode),
        npvExact(vector.rate, flows).round(vector.mode),
        discountedSum(vector.rate, flows, vector.mode),
      ];
      return actual.map(minorOf).join() !== [vector.npv, vector.npv, vector.discountedSum].join();
    });
    expect(mismatches).toEqual([]);
  });

  it('irr', () => {
    const mismatches = vectors.irr.filter((vector) => {
      const flows = vector.flows.map((flow) => amount(flow, vector.currency));
      const result = irr(flows, { digits: vector.digits });
      const lower = BigInt(result.lower.replace('.', ''));
      return lower !== BigInt(vector.lower) || result.rate !== result.lower;
    });
    expect(mismatches).toEqual([]);
  });

  it('irr with a bracket picks the root inside it, of two known rational roots', () => {
    const mismatches = vectors.irrBracketed.filter((vector) => {
      const flows = vector.flows.map((flow) => amount(flow, vector.currency));
      const result = irr(flows, { digits: vector.digits, bracket: vector.bracket });
      return BigInt(result.lower.replace('.', '')) !== BigInt(vector.lower);
    });
    expect(vectors.irrBracketed.length).toBeGreaterThan(50);
    expect(mismatches).toEqual([]);
  });

  it('prorate and splitPeriod', () => {
    const mismatches = vectors.proration.filter((vector) => {
      const price = amount(vector.price, vector.currency);
      const period = { start: vector.period[0], end: vector.period[1] };
      const used = { start: vector.used[0], end: vector.used[1] };
      const prorated = prorate(price, { period, used }, vector.mode);
      const pieces = splitPeriod(price, { period, at: vector.at });
      return (
        minorOf(prorated) !== vector.prorate || pieces.map(minorOf).join() !== vector.split.join()
      );
    });
    expect(mismatches).toEqual([]);
  });

  it('amortise payment dates', () => {
    const mismatches = vectors.paymentDates.filter((vector) => {
      const plan = amortise(amount('100000', 'EUR'), {
        rate: '0',
        perYear: vector.perYear,
        periods: vector.count,
        firstPayment: vector.firstPayment,
      });
      return plan.rows.map((row) => row.date).join() !== vector.dates.join();
    });
    expect(mismatches).toEqual([]);
  });
});
