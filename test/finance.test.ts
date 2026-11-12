import '../src/plugins/core.js'; // the tests below use the Money methods
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { instalments } from '../src/allocate.js';
import { ratio, type Ratio } from '../src/decimal.js';
import { exact } from '../src/exact.js';
import {
  amortise,
  annualRate,
  compound,
  fv,
  fvExact,
  interest,
  interestExact,
  irr,
  nper,
  npv,
  npvExact,
  periodicRate,
  pmt,
  pmtExact,
  pv,
  pvExact,
  rate,
  discountedSum,
  discountedSumExact,
  prorate,
  splitPeriod,
  yearFraction,
  type DayCount,
} from '../src/finance.js';
import { add, CurrencyMismatchError, fromMinor, money, sum, type Money } from '../src/money.js';
import { roundingPolicy } from '../src/policy.js';
import { runs } from './fc-config.js';

const eur = (amount: string): Money<'EUR'> => money(amount, 'EUR');
const cents = (minor: number | bigint): Money<'EUR'> => fromMinor(minor, 'EUR');
const text = (value: Ratio): string => `${value.num}/${value.den}`;
const fraction = (num: number, den: number): string => text(ratio(BigInt(num), BigInt(den)));

/** num/den of Strata's calc360(y1, m1, d1, y2, m2, d2): days already adjusted by the test. */
function calc360(y1: number, m1: number, d1: number, y2: number, m2: number, d2: number): string {
  return fraction((y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1), 360);
}

/** calc360 on the dates as written, Strata's SIMPLE_30_360. */
function simple360(start: string, end: string): string {
  const [y1, m1, d1] = start.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = end.split('-').map(Number) as [number, number, number];
  return calc360(y1, m1, d1, y2, m2, d2);
}

/** a/b + c/d + whole, exactly, as Strata writes ACT/ACT ISDA results. */
function parts(
  firstDays: number,
  firstYear: number,
  secondDays = 0,
  secondYear = 1,
  whole = 0,
): string {
  const numerator = BigInt(
    firstDays * secondYear + secondDays * firstYear + whole * firstYear * secondYear,
  );
  return text(ratio(numerator, BigInt(firstYear * secondYear)));
}

describe('yearFraction: OpenGamma Strata DayCountTest cases', () => {
  // [start, end, expected] rows of Strata's data_yearFraction
  const actual: [string, string, number][] = [
    ['2011-12-28', '2012-02-28', 62],
    ['2011-12-28', '2012-02-29', 63],
    ['2011-12-28', '2012-03-01', 64],
    ['2011-12-28', '2016-02-28', 62 + 366 + 365 + 365 + 365],
    ['2011-12-28', '2016-02-29', 63 + 366 + 365 + 365 + 365],
    ['2011-12-28', '2016-03-01', 64 + 366 + 365 + 365 + 365],
    ['2012-02-28', '2012-03-28', 29],
    ['2012-02-29', '2012-03-28', 28],
    ['2012-03-01', '2012-03-28', 27],
  ];

  it('ACT/360 and ACT/365F', () => {
    for (const [start, end, days] of actual) {
      expect(text(yearFraction(start, end, 'ACT/360'))).toBe(fraction(days, 360));
      expect(text(yearFraction(start, end, 'ACT/365F'))).toBe(fraction(days, 365));
    }
  });

  it('ACT/ACT ISDA, including the ISDA 1999 worked examples', () => {
    const cases: [string, string, string][] = [
      ['2011-12-28', '2012-02-28', parts(4, 365, 58, 366)],
      ['2011-12-28', '2012-02-29', parts(4, 365, 59, 366)],
      ['2011-12-28', '2012-03-01', parts(4, 365, 60, 366)],
      ['2011-12-28', '2016-02-28', parts(4, 365, 58, 366, 4)],
      ['2011-12-28', '2016-02-29', parts(4, 365, 59, 366, 4)],
      ['2011-12-28', '2016-03-01', parts(4, 365, 60, 366, 4)],
      ['2012-02-29', '2012-03-29', parts(29, 366)],
      ['2012-02-29', '2012-03-28', parts(28, 366)],
      ['2012-03-01', '2012-03-28', parts(27, 366)],
      // ISDA's Act/Act examples (normal period, short and long stubs)
      ['2003-11-01', '2004-05-01', parts(61, 365, 121, 366)],
      ['1999-02-01', '1999-07-01', parts(150, 365)],
      ['1999-07-01', '2000-07-01', parts(184, 365, 182, 366)],
      ['2002-08-15', '2003-07-15', parts(334, 365)],
      ['2003-07-15', '2004-01-15', parts(170, 365, 14, 366)],
      ['1999-07-30', '2000-01-30', parts(155, 365, 29, 366)],
      ['2000-01-30', '2000-06-30', parts(152, 366)],
      ['1999-11-30', '2000-04-30', parts(32, 365, 120, 366)],
    ];
    for (const [start, end, expected] of cases) {
      expect([start, end, text(yearFraction(start, end, 'ACT/ACT ISDA'))]).toEqual([
        start,
        end,
        expected,
      ]);
    }
  });

  // dates where the 30/360 variants differ, with Strata's expected values
  const thirty: [string, string, string, string, string, string][] = [
    // start, end, 30/360 (Bond Basis), 30E/360, 30E/360 ISDA, 30E/360 ISDA at maturity
    ['2011-12-28', '2012-02-28', 'simple', 'simple', 'simple', 'simple'],
    ['2011-12-28', '2012-02-29', 'simple', 'simple', calc360(2011, 12, 28, 2012, 2, 30), 'simple'],
    ['2011-12-28', '2012-03-01', 'simple', 'simple', 'simple', 'simple'],
    ['2011-12-28', '2016-02-28', 'simple', 'simple', 'simple', 'simple'],
    ['2011-12-28', '2016-02-29', 'simple', 'simple', calc360(2011, 12, 28, 2016, 2, 30), 'simple'],
    ['2011-12-28', '2016-03-01', 'simple', 'simple', 'simple', 'simple'],
    ['2012-02-28', '2012-03-28', 'simple', 'simple', 'simple', 'simple'],
    [
      '2012-02-29',
      '2012-03-28',
      'simple',
      'simple',
      calc360(2012, 2, 30, 2012, 3, 28),
      calc360(2012, 2, 30, 2012, 3, 28),
    ],
    [
      '2011-02-28',
      '2012-02-28',
      'simple',
      'simple',
      calc360(2011, 2, 30, 2012, 2, 28),
      calc360(2011, 2, 30, 2012, 2, 28),
    ],
    [
      '2011-02-28',
      '2012-02-29',
      'simple',
      'simple',
      calc360(2011, 2, 30, 2012, 2, 30),
      calc360(2011, 2, 30, 2012, 2, 29),
    ],
    [
      '2012-02-29',
      '2016-02-29',
      'simple',
      'simple',
      calc360(2012, 2, 30, 2016, 2, 30),
      calc360(2012, 2, 30, 2016, 2, 29),
    ],
    ['2012-03-01', '2012-03-28', 'simple', 'simple', 'simple', 'simple'],
    ['2012-05-30', '2013-08-29', 'simple', 'simple', 'simple', 'simple'],
    ['2012-05-29', '2013-08-30', 'simple', 'simple', 'simple', 'simple'],
    ['2012-05-30', '2013-08-30', 'simple', 'simple', 'simple', 'simple'],
    [
      '2012-05-29',
      '2013-08-31',
      'simple',
      calc360(2012, 5, 29, 2013, 8, 30),
      calc360(2012, 5, 29, 2013, 8, 30),
      calc360(2012, 5, 29, 2013, 8, 30),
    ],
    [
      '2012-05-30',
      '2013-08-31',
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
    ],
    [
      '2012-05-31',
      '2013-08-30',
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
    ],
    [
      '2012-05-31',
      '2013-08-31',
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
      calc360(2012, 5, 30, 2013, 8, 30),
    ],
  ];

  it('30/360, 30E/360 and 30E/360 ISDA, with and without the termination date', () => {
    for (const [start, end, bond, euro, isda, isdaAtMaturity] of thirty) {
      const expected = (value: string) => (value === 'simple' ? simple360(start, end) : value);
      const atMaturity = yearFraction(start, end, '30E/360 ISDA', { maturity: true });
      // the dates go into both sides, so a failure shows which row it was
      expect({
        start,
        end,
        bond: text(yearFraction(start, end, '30/360')),
        euro: text(yearFraction(start, end, '30E/360')),
        isda: text(yearFraction(start, end, '30E/360 ISDA', { maturity: false })),
        isdaAtMaturity: text(atMaturity),
      }).toEqual({
        start,
        end,
        bond: expected(bond),
        euro: expected(euro),
        isda: expected(isda),
        isdaAtMaturity: expected(isdaAtMaturity),
      });
    }
  });

  it('the design example, and an empty period is zero', () => {
    expect(text(yearFraction('2026-01-15', '2026-07-15', 'ACT/360'))).toBe('181/360');
    expect(text(yearFraction('2026-01-15', '2026-01-15', 'ACT/ACT ISDA'))).toBe('0/1');
  });

  it('day numbers agree with the proleptic Gregorian calendar over 1600-2400', () => {
    // every year from 1600 to 2400 has 365 or 366 days, by the Gregorian leap rule
    for (let year = 1600; year < 2400; year++) {
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const start = `${year}-01-01`;
      const end = `${year + 1}-01-01`;
      expect(text(yearFraction(start, end, 'ACT/365F'))).toBe(isLeap ? '366/365' : '1/1');
      expect(text(yearFraction(start, end, 'ACT/ACT ISDA'))).toBe('1/1');
    }
  });

  it('accepts { year, month, day } objects and Temporal.PlainDate', () => {
    const fromObject = yearFraction(
      { year: 2026, month: 1, day: 15 },
      { year: 2026, month: 7, day: 15 },
      'ACT/360',
    );
    expect(text(fromObject)).toBe('181/360');
    // a class with getters, as Temporal.PlainDate has
    class PlainDateLike {
      get year() {
        return 2026;
      }
      get month() {
        return 7;
      }
      get day() {
        return 15;
      }
    }
    expect(text(yearFraction('2026-01-15', new PlainDateLike(), 'ACT/360'))).toBe('181/360');
  });

  const Temporal = (globalThis as { Temporal?: { PlainDate: { from(text: string): object } } })
    .Temporal;
  it.skipIf(Temporal === undefined)('works with the runtime Temporal.PlainDate', () => {
    const start = Temporal!.PlainDate.from('2026-01-15') as {
      year: number;
      month: number;
      day: number;
    };
    const end = Temporal!.PlainDate.from('2026-07-15') as {
      year: number;
      month: number;
      day: number;
    };
    expect(text(yearFraction(start, end, 'ACT/360'))).toBe('181/360');
  });

  it('rejects invalid dates, reversed periods and unknown conventions', () => {
    expect(() => yearFraction('2026-02-30', '2026-03-01', 'ACT/360')).toThrow(RangeError);
    expect(() => yearFraction('2026-2-01', '2026-03-01', 'ACT/360')).toThrow('expected YYYY-MM-DD');
    expect(() => yearFraction({ year: 2026, month: 13, day: 1 }, '2027-01-01', 'ACT/360')).toThrow(
      'Invalid date 2026-13-01',
    );
    expect(() => yearFraction('2026-03-02', '2026-03-01', 'ACT/360')).toThrow('end date is before');
    expect(() => yearFraction('2026-03-01', '2026-03-02', 'ACT/366' as DayCount)).toThrow(
      'Invalid day count',
    );
    // years outside 0-9999, which 'YYYY-MM-DD' cannot write
    expect(() => yearFraction({ year: 10_000, month: 1, day: 1 }, '2026-01-01', 'ACT/360')).toThrow(
      'Invalid date',
    );
    expect(() => yearFraction({ year: -1, month: 1, day: 1 }, '2026-01-01', 'ACT/360')).toThrow(
      'Invalid date',
    );
    // a Temporal.PlainDate in another calendar has non-Gregorian fields
    const hebrew = { year: 5787, month: 1, day: 1, calendarId: 'hebrew' };
    expect(() => yearFraction(hebrew, '2026-01-01', 'ACT/360')).toThrow('ISO calendar');
    const iso = { year: 2026, month: 1, day: 1, calendarId: 'iso8601' };
    expect(text(yearFraction(iso, '2026-01-02', 'ACT/360'))).toBe('1/360');
  });

  it('30E/360 ISDA ending on the last day of February needs to be told if it is maturity', () => {
    // 2026-08-31 to 2027-02-28: 180/360 if February 28 is not the termination date, 178 if it is
    expect(() => yearFraction('2026-08-31', '2027-02-28', '30E/360 ISDA')).toThrow(
      'needs the option maturity',
    );
    const notMaturity = yearFraction('2026-08-31', '2027-02-28', '30E/360 ISDA', {
      maturity: false,
    });
    const atMaturity = yearFraction('2026-08-31', '2027-02-28', '30E/360 ISDA', { maturity: true });
    expect([text(notMaturity), text(atMaturity)]).toEqual(['1/2', '89/180']);
    // other end dates need no flag, and it changes nothing
    expect(text(yearFraction('2026-08-31', '2027-02-27', '30E/360 ISDA'))).toBe('59/120');
    const period = { from: '2026-08-31', to: '2027-02-28', dayCount: '30E/360 ISDA' } as const;
    expect(() => interest(eur('1000'), '0.05', period)).toThrow('maturity');
    expect(String(interest(eur('1000'), '0.05', { ...period, maturity: true }))).toBe('24.72 EUR');
  });
});

describe('interest and compound', () => {
  it('the design example: 10,000 EUR at 5% for 181 days, ACT/365F', () => {
    const period = { from: '2026-01-15', to: '2026-07-15', dayCount: 'ACT/365F' } as const;
    expect(String(interest(eur('10000'), '0.05', period, 'halfEven'))).toBe('247.95 EUR');
    expect(String(interestExact(eur('10000'), '0.05', period))).toBe('18100/73 EUR');
  });

  it('rounds once, with a mode or a policy', () => {
    const period = { from: '2026-01-01', to: '2026-01-02', dayCount: 'ACT/360' } as const;
    // 0.015 EUR exactly: one rounding decides it
    const principal = eur('108');
    expect(String(interest(principal, '0.05', period, 'halfEven'))).toBe('0.02 EUR');
    expect(String(interest(principal, '0.05', period, 'trunc'))).toBe('0.01 EUR');
    const fourDecimals = roundingPolicy({ scale: 4, rounding: 'halfEven' });
    expect(String(interest(principal, '0.05', period, fourDecimals))).toBe('0.0150 EUR');
    const cash = roundingPolicy({ increment: 5 });
    expect(String(interest(eur('1000'), '0.05', { ...period, to: '2026-02-01' }, cash))).toBe(
      '4.30 EUR',
    );
  });

  it('compound: spreadsheet FV values, and periods 0 is the principal', () => {
    // FV(5%/12, 12, 0, -1000) = 1051.16
    expect(String(compound(eur('1000'), '0.05', { periods: 12, perYear: 12 }, 'halfEven'))).toBe(
      '1051.16 EUR',
    );
    // FV(5%/12, 360, 0, -1000) = 4467.74: (241/240)^360, about 3,000 bits, exactly
    expect(String(compound(eur('1000'), '0.05', { periods: 360, perYear: 12 }))).toBe(
      '4467.74 EUR',
    );
    expect(String(compound(eur('1000'), '0.05', { periods: 0, perYear: 12 }))).toBe('1000.00 EUR');
    expect(() => compound(eur('1'), '0.05', { periods: 1.5, perYear: 12 })).toThrow(
      'Invalid periods',
    );
    expect(() => compound(eur('1'), '-12', { periods: 1, perYear: 12 })).toThrow(
      'loses everything',
    );
    expect(() => compound(eur('1'), '0.05', { periods: 1, perYear: 0 })).toThrow('Invalid perYear');
  });
});

describe('amortise', () => {
  it('the design example: 200,000 EUR at 4.5% over 25 years', () => {
    const plan = amortise(eur('200000'), {
      rate: '0.045',
      perYear: 12,
      periods: 300,
      rounding: 'halfEven',
    });
    expect(String(plan.payment)).toBe('1111.66 EUR');
    const first = plan.rows[0]!;
    expect(
      [first.period, first.payment, first.interest, first.principal, first.balance].map(String),
    ).toEqual(['1', '1111.66 EUR', '750.00 EUR', '361.66 EUR', '199638.34 EUR']);
    expect(plan.rows).toHaveLength(300);
    expect(String(plan.totalInterest)).toBe('133500.69 EUR');
  });

  it('CFPB Loan Estimate sample: 162,000 at 3.875% for 30 years is 761.78 a month', () => {
    const plan = amortise(money('162000', 'USD'), { rate: '0.03875', perYear: 12, periods: 360 });
    expect(String(plan.payment)).toBe('761.78 USD');
  });

  it("the first row agrees in magnitude with a spreadsheet's PMT, IPMT and PPMT", () => {
    // PMT(6%/12, 360, 200000) = -1199.10, IPMT(..., 1, ...) = -1000.00, PPMT(..., 1, ...) = -199.10.
    // Spreadsheets give payments a negative sign, and their IPMT and PPMT come from the unrounded
    // balance, so later rows can differ by cents from a schedule that rounds every period.
    const plan = amortise(money('200000', 'USD'), { rate: '0.06', perYear: 12, periods: 360 });
    expect(String(plan.payment)).toBe('1199.10 USD');
    expect(String(plan.rows[0]!.interest)).toBe('1000.00 USD');
    expect(String(plan.rows[0]!.principal)).toBe('199.10 USD');
    // PMT(4.5%/12, 360, 100000) = -506.69
    const smaller = amortise(money('100000', 'USD'), { rate: '0.045', perYear: 12, periods: 360 });
    expect(String(smaller.payment)).toBe('506.69 USD');
    // PMT(8%/4, 20, 50000, -10000): a balloon of 10,000 left for the last payment
    const balloon = amortise(eur('50000'), {
      rate: '0.08',
      perYear: 4,
      periods: 20,
      balloon: eur('10000'),
    });
    expect(String(balloon.payment)).toBe('2646.27 EUR');
  });

  it('the residual goes to the last payment, or with lastInterest to the last interest', () => {
    const options = { rate: '0.07', perYear: 12, periods: 7 } as const;
    const lastPayment = amortise(eur('1000'), options);
    const lastInterest = amortise(eur('1000'), { ...options, residual: 'lastInterest' });
    expect(String(lastPayment.payment)).toBe('146.21 EUR');
    expect(lastPayment.rows.map((row) => String(row.payment))).toEqual([
      ...Array<string>(6).fill('146.21 EUR'),
      '146.20 EUR',
    ]);
    expect(String(lastPayment.rows[6]!.interest)).toBe('0.85 EUR');
    expect(lastInterest.rows.map((row) => String(row.payment))).toEqual(
      Array<string>(7).fill('146.21 EUR'),
    );
    expect(String(lastInterest.rows[6]!.interest)).toBe('0.86 EUR');
  });

  it('linear and interest-only schedules', () => {
    const linear = amortise(eur('1000'), {
      rate: '0.12',
      perYear: 12,
      periods: 3,
      method: 'linear',
    });
    expect(
      linear.rows.map((row) => [row.payment, row.interest, row.principal, row.balance].map(String)),
    ).toEqual([
      ['343.33 EUR', '10.00 EUR', '333.33 EUR', '666.67 EUR'],
      ['340.00 EUR', '6.67 EUR', '333.33 EUR', '333.34 EUR'],
      ['336.67 EUR', '3.33 EUR', '333.34 EUR', '0.00 EUR'],
    ]);
    expect(String(linear.payment)).toBe('343.33 EUR');
    const bullet = amortise(eur('1000'), {
      rate: '0.12',
      perYear: 12,
      periods: 3,
      method: 'interestOnly',
    });
    expect(bullet.rows.map((row) => String(row.payment))).toEqual([
      '10.00 EUR',
      '10.00 EUR',
      '1010.00 EUR',
    ]);
    expect(String(bullet.payment)).toBe('10.00 EUR');
    expect(String(bullet.totalInterest)).toBe('30.00 EUR');
  });

  it('payment dates roll at month end from the first payment', () => {
    const plan = amortise(eur('1200'), {
      rate: '0',
      perYear: 12,
      periods: 4,
      firstPayment: '2027-01-31',
    });
    expect(plan.rows.map((row) => row.date)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    const quarterly = amortise(eur('1200'), {
      rate: '0',
      perYear: 4,
      periods: 3,
      firstPayment: '2027-11-30',
    });
    expect(quarterly.rows.map((row) => row.date)).toEqual([
      '2027-11-30',
      '2028-02-29',
      '2028-05-30',
    ]);
    const weekly = amortise(eur('1200'), {
      rate: '0',
      perYear: 52,
      periods: 3,
      firstPayment: '2027-12-27',
    });
    expect(weekly.rows.map((row) => row.date)).toEqual(['2027-12-27', '2028-01-03', '2028-01-10']);
    expect(() =>
      amortise(eur('1200'), { rate: '0', perYear: 5, periods: 3, firstPayment: '2027-12-27' }),
    ).toThrow('Invalid perYear for payment dates');
    // without firstPayment the rows have no date field at all
    expect('date' in amortise(eur('1200'), { rate: '0', perYear: 12, periods: 1 }).rows[0]!).toBe(
      false,
    );
  });

  it('a policy rounds every payment and interest charge, and the parts stay multiples of it', () => {
    const cash = roundingPolicy({ increment: 5 });
    const plan = amortise(money('1000', 'CHF'), {
      rate: '0.05',
      perYear: 12,
      periods: 12,
      rounding: cash,
    });
    for (const row of plan.rows.slice(0, -1)) {
      expect(Number(row.payment.minor) % 5).toBe(0);
      expect(Number(row.interest.minor) % 5).toBe(0);
    }
    expect(String(plan.rows.at(-1)!.balance)).toBe('0.00 CHF');
    const zeroRate = amortise(money('1000', 'CHF'), {
      rate: '0',
      perYear: 12,
      periods: 7,
      rounding: cash,
    });
    expect(zeroRate.rows.map((row) => String(row.principal))).toEqual([
      ...Array<string>(6).fill('142.85 CHF'),
      '142.90 CHF',
    ]);
  });

  it('a tiny loan whose rounded payment clears it early ends with the payment that clears it', () => {
    const plan = amortise(eur('0.10'), { rate: '0.01', perYear: 12, periods: 12 });
    expect(String(plan.payment)).toBe('0.01 EUR');
    expect(plan.rows).toHaveLength(10);
    expect(String(plan.rows.at(-1)!.balance)).toBe('0.00 EUR');
  });

  it('rejects bad options', () => {
    const base = { rate: '0.05', perYear: 12, periods: 12 } as const;
    expect(() => amortise(eur('0'), base)).toThrow('The loan must be positive');
    expect(() => amortise(eur('100'), { ...base, rate: '-0.01' })).toThrow('must not be negative');
    expect(() => amortise(eur('100'), { ...base, periods: 0 })).toThrow('Invalid periods');
    expect(() => amortise(eur('100'), { ...base, periods: 100_001 })).toThrow('Invalid periods');
    expect(() => compound(eur('100'), '0.05', { periods: 100_001, perYear: 12 })).toThrow(
      'Invalid periods',
    );
    expect(() =>
      amortise(eur('100'), { ...base, method: 'linear', residual: 'lastInterest' }),
    ).toThrow('non-zero rate only');
    expect(() => amortise(eur('100'), { ...base, rate: '0', residual: 'lastInterest' })).toThrow(
      'non-zero rate only',
    );
    expect(() => amortise(eur('120'), { ...base, rate: '0', firstPayment: '9999-06-30' })).toThrow(
      'past the year 9999',
    );
    expect(() =>
      amortise(eur('120'), { ...base, rate: '0', perYear: 52, firstPayment: '9999-12-01' }),
    ).toThrow('past the year 9999');
    expect(
      amortise(eur('120'), { ...base, rate: '0', firstPayment: '9998-12-31' }).rows.at(-1)?.date,
    ).toBe('9999-11-30');
    // amounts the rounding can't produce would leave the schedule off the policy's grid
    const cash = roundingPolicy({ increment: 5 });
    expect(() => amortise(money('1000.02', 'CHF'), { ...base, rounding: cash })).toThrow(
      'multiples of 0.05 CHF',
    );
    const subCent = money('10.005', 'EUR', { scale: 3 });
    expect(() => amortise(eur('100'), { ...base, balloon: subCent })).toThrow(
      'multiples of 0.01 EUR',
    );
    expect(() => amortise(eur('100'), { ...base, balloon: eur('101') })).toThrow(
      'balloon must be between',
    );
    expect(() =>
      amortise(eur('100'), { ...base, method: 'interestOnly', balloon: eur('1') }),
    ).toThrow('drop the balloon');
    expect(() =>
      amortise(eur('100') as Money<string>, {
        ...base,
        balloon: money('1', 'USD') as Money<string>,
      }),
    ).toThrow(CurrencyMismatchError);
    expect(() => amortise(eur('100'), { ...base, method: 'french' as 'annuity' })).toThrow(
      'Invalid method',
    );
    expect(() => amortise(eur('100'), { ...base, residual: 'spread' as 'lastPayment' })).toThrow(
      'Invalid residual',
    );
    // a residual bigger than the last interest would make that interest negative
    expect(() =>
      amortise(eur('0.10'), { ...base, rate: '0.01', residual: 'lastInterest', periods: 7 }),
    ).toThrow('use residual');
  });
});

describe('amortise properties', () => {
  const loans = fc.bigInt({ min: 1n, max: 10n ** 11n }).map((minor) => cents(minor));
  const rates = fc
    .integer({ min: 0, max: 30_000 })
    .map((basisPoints) => ratio(BigInt(basisPoints), 100_000n));
  const modes = fc.constantFrom(
    'halfEven',
    'halfExpand',
    'trunc',
    'ceil',
    'expand',
    'floor' as const,
  );
  const options = fc.record({
    rate: rates,
    perYear: fc.constantFrom(1, 4, 12, 52),
    periods: fc.integer({ min: 1, max: 480 }),
    method: fc.constantFrom('annuity', 'linear', 'interestOnly' as const),
    rounding: modes,
  });

  it('principal sums to the loan, the balance never goes negative and ends at 0', () => {
    fc.assert(
      fc.property(loans, options, (loan, settings) => {
        const plan = amortise(loan, settings);
        expect(sum(plan.rows.map((row) => row.principal)).toMinor()).toBe(loan.toMinor());
        for (const row of plan.rows) {
          expect(row.balance.toMinor() >= 0n).toBe(true);
          expect(row.payment.toMinor()).toBe(row.interest.toMinor() + row.principal.toMinor());
          expect(row.payment.scale).toBe(2);
        }
        expect(plan.rows.at(-1)!.balance.toMinor()).toBe(0n);
        expect(plan.rows.length).toBeLessThanOrEqual(settings.periods);
        expect(plan.totalInterest.toMinor()).toBe(
          sum(plan.rows.map((row) => row.interest)).toMinor(),
        );
      }),
      { numRuns: runs(150) },
    );
  });

  it('annuity payments are all equal except the last', () => {
    fc.assert(
      fc.property(loans, options, (loan, settings) => {
        const plan = amortise(loan, { ...settings, method: 'annuity' });
        for (const row of plan.rows.slice(0, -1)) {
          expect(row.payment.toMinor()).toBe(plan.payment.toMinor());
        }
      }),
      { numRuns: runs(150) },
    );
  });

  it('a zero rate gives instalments(loan, n, { remainder: toLast }) for annuity and linear', () => {
    fc.assert(
      fc.property(
        loans,
        fc.integer({ min: 1, max: 480 }),
        fc.constantFrom('annuity', 'linear' as const),
        (loan, periods, method) => {
          const plan = amortise(loan, { rate: '0', perYear: 12, periods, method });
          const expected = instalments(loan, periods, { remainder: 'toLast' });
          expect(plan.rows.map((row) => row.payment.toMinor())).toEqual(
            expected.map((part) => part.toMinor()),
          );
          expect(plan.totalInterest.toMinor()).toBe(0n);
        },
      ),
      { numRuns: runs(100) },
    );
  });

  it('the rounded payment is within one minor unit of the exact annuity', () => {
    fc.assert(
      fc.property(loans, options, (loan, settings) => {
        fc.pre(settings.rate.num > 0n);
        const plan = amortise(loan, { ...settings, method: 'annuity' });
        const periodic = ratio(settings.rate.num, settings.rate.den * BigInt(settings.perYear));
        const growth = ratio(periodic.num + periodic.den, periodic.den);
        const power = ratio(
          growth.num ** BigInt(settings.periods),
          growth.den ** BigInt(settings.periods),
        );
        const factor = ratio(periodic.num * power.num, periodic.den * (power.num - power.den));
        const exactPayment = exact(loan).multiply(factor);
        const difference = exactPayment.subtract(exact(plan.payment));
        expect(difference.compare(exact(cents(1))) < 0).toBe(true);
        expect(difference.compare(exact(cents(-1))) > 0).toBe(true);
      }),
      { numRuns: runs(100) },
    );
  });
});

describe('npv and irr', () => {
  const flows = [eur('-1000'), eur('300'), eur('400'), eur('500')];

  it('the design examples: discountedSum takes flows from period 0, npv from period 1', () => {
    expect(String(discountedSum('0.08', flows, 'halfEven'))).toBe('17.63 EUR');
    expect(String(npv('0.08', flows, 'halfEven'))).toBe('16.32 EUR');
    // an initial outlay goes outside Excel's NPV
    const outside = add(flows[0]!, npv('0.08', flows.slice(1), 'halfEven'));
    expect(String(outside)).toBe('17.63 EUR');
    expect(irr(flows, { digits: 8 })).toEqual({
      rate: '0.08896339',
      lower: '0.08896339',
      upper: '0.08896340',
    });
    expect(irr(flows).rate).toBe('0.0889633946');
    expect(String(discountedSumExact('0', flows))).toBe('200 EUR');
  });

  it('npv is exact: npvExact and discountedSumExact at the IRR bracket change sign', () => {
    const { lower, upper } = irr(flows, { digits: 12 });
    expect(npvExact(lower, flows).sign()).toBe(1);
    expect(npvExact(upper, flows).sign()).toBe(-1);
    expect(discountedSumExact(lower, flows).sign()).toBe(1);
    expect(discountedSumExact(upper, flows).sign()).toBe(-1);
    // Excel's form is the period-0 form discounted once more
    expect(npvExact('0.25', flows).equals(discountedSumExact('0.25', flows).divide('1.25'))).toBe(
      true,
    );
  });

  it('an IRR of exactly a grid point, and huge rates', () => {
    // -100 then 110: exactly 10%
    expect(irr([eur('-100'), eur('110')], { digits: 4 })).toEqual({
      rate: '0.1000',
      lower: '0.1000',
      upper: '0.1001',
    });
    // -1 then 1,000,000: 999,999 = 99,999,900%
    expect(irr([eur('-1'), eur('1000000')], { digits: 2 }).rate).toBe('999999.00');
    // nearly everything lost: -1000 then 0.01
    expect(irr([eur('-1000'), eur('0.01')], { digits: 6 }).rate).toBe('-0.999990');
    // at 2 digits the IRR is within 0.01 of -1, where the NPV is undefined
    expect(() => irr([eur('-1000'), eur('0.01')], { digits: 2 })).toThrow('ask for more digits');
    // floored, not truncated: a negative IRR rounds down, away from zero
    expect(irr([eur('-100'), eur('95')], { digits: 1 }).rate).toBe('-0.1');
  });

  it('several sign changes need a bracket, and the bracket picks the root', () => {
    // -100, 230, -132 has IRRs of 10% and 20%
    const twoRoots = [eur('-100'), eur('230'), eur('-132')];
    expect(() => irr(twoRoots)).toThrow('pass a bracket');
    expect(irr(twoRoots, { digits: 6, bracket: ['0', '0.15'] }).rate).toBe('0.100000');
    expect(irr(twoRoots, { digits: 6, bracket: ['0.15', '1'] }).rate).toBe('0.200000');
    expect(() => irr(twoRoots, { bracket: ['0.3', '1'] })).toThrow('same sign at both ends');
    expect(() => irr(twoRoots, { bracket: ['1', '0.3'] })).toThrow('two increasing rates');
    expect(() => irr(twoRoots, { bracket: ['-1', '0.3'] })).toThrow('above -1');
  });

  it('a bracket is checked at its exact ends, so the root returned is inside it', () => {
    // 100, -225, 126.50 has IRRs of exactly 10% and 15%; 0.105 to 0.2 holds only the 15% one
    const twoRoots = [eur('100'), eur('-225'), eur('126.50')];
    expect(irr(twoRoots, { digits: 2, bracket: ['0.105', '0.2'] }).rate).toBe('0.15');
    // at one digit, 15% floors to 0.1 (the other root's value, but the root found is 15%)
    expect(irr(twoRoots, { digits: 1, bracket: ['0.105', '0.2'] })).toEqual({
      rate: '0.1',
      lower: '0.1',
      upper: '0.2',
    });
    expect(irr(twoRoots, { digits: 4, bracket: ['0.05', '0.12'] }).rate).toBe('0.1000');
    // IRRs of 10.1% and 15%: widening 0.105 outwards to the 1-digit grid would lose the sign change
    const close = [eur('2000'), eur('-4502'), eur('2532.30')];
    expect(irr(close, { digits: 1, bracket: ['0.105', '0.2'] }).rate).toBe('0.1');
    expect(irr(close, { digits: 3, bracket: ['0.105', '0.2'] }).rate).toBe('0.150');
    expect(irr(close, { digits: 3, bracket: ['0.05', '0.105'] }).rate).toBe('0.101');
    // a bracket end that is itself a root
    expect(irr(twoRoots, { digits: 3, bracket: ['0.15', '0.2'] }).rate).toBe('0.150');
  });

  it('throws without a sign change, and on bad input', () => {
    expect(() => irr([eur('100'), eur('100')])).toThrow('never change sign');
    expect(() => irr([eur('0'), eur('0')])).toThrow('never change sign');
    expect(() => irr(flows, { digits: 1.5 })).toThrow('Invalid digits');
    expect(() => irr([])).toThrow('At least one cash flow');
    expect(() => npv('-1', flows)).toThrow('above -1');
    expect(() => discountedSum('-1.5', flows)).toThrow('above -1');
    expect(() => irr([eur('-1'), money('2', 'USD')] as Money[])).toThrow(CurrencyMismatchError);
  });

  it('IRR property: NPV changes sign between lower and upper, 10^-digits apart', () => {
    const outlay = fc.bigInt({ min: 1n, max: 10n ** 9n });
    const returns = fc.array(fc.bigInt({ min: 0n, max: 10n ** 8n }), {
      minLength: 1,
      maxLength: 40,
    });
    fc.assert(
      fc.property(outlay, returns, fc.integer({ min: 0, max: 14 }), (out, back, digits) => {
        fc.pre(back.some((value) => value > 0n));
        const cashFlows = [cents(-out), ...back.map((value) => cents(value))];
        let result: { rate: string; lower: string; upper: string };
        try {
          result = irr(cashFlows, { digits });
        } catch (error) {
          // an IRR within 10^-digits of -1 has no lower end to give: check that it really is, that
          // the NPV at -1 + 10^-digits already has the outlay's sign (or is zero)
          expect(String(error)).toContain('ask for more digits');
          const nearMinusOne = ratio(1n - 10n ** BigInt(digits), 10n ** BigInt(digits));
          expect(discountedSumExact(nearMinusOne, cashFlows).sign()).toBeLessThanOrEqual(0);
          return;
        }
        expect(result.rate).toBe(result.lower);
        const lower = ratio(result.lower);
        const upper = ratio(result.upper);
        const width = ratio(upper.num * lower.den - lower.num * upper.den, upper.den * lower.den);
        expect(text(width)).toBe(`1/${10n ** BigInt(digits)}`);
        const lowerSign = npvExact(result.lower, cashFlows).sign();
        const upperSign = npvExact(result.upper, cashFlows).sign();
        expect(lowerSign === 0 || lowerSign !== upperSign).toBe(true);
      }),
      { numRuns: runs(100) },
    );
  });

  it('the worst case documented: 360 monthly flows at digits 10 is fast', () => {
    const mortgage = [cents(-20_000_000), ...Array.from({ length: 360 }, () => cents(101_337))];
    const started = performance.now();
    const result = irr(mortgage);
    const elapsed = performance.now() - started;
    // 4.5%/12 = 0.00375 a month
    expect(result.rate).toBe('0.0037499956');
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('periodicRate and annualRate', () => {
  /** (1 + rate)^n as a ratio, exactly */
  const growthPower = (periodic: string | Ratio, n: number): Ratio => {
    const value = ratio(periodic);
    const power = BigInt(n);
    return ratio((value.num + value.den) ** power, value.den ** power);
  };
  const lessOrEqual = (left: Ratio, right: Ratio) => left.num * right.den <= right.num * left.den;
  const onePlus = (periodic: string | Ratio): Ratio => {
    const value = ratio(periodic);
    return ratio(value.num + value.den, value.den);
  };

  it('finds the monthly rate of an annual one, floored, like irr', () => {
    expect(periodicRate('0.05', { perYear: 12, digits: 12 })).toEqual({
      rate: '0.004074123783',
      lower: '0.004074123783',
      upper: '0.004074123784',
    });
    expect(periodicRate('0.05', { perYear: 12 }).rate).toBe('0.0040741237');
    // negative rates floor downwards too
    expect(periodicRate('-0.5', { perYear: 12 }).rate).toBe('-0.0561256874');
    expect(periodicRate('0.05', { perYear: 365, digits: 3 }).rate).toBe('0.000');
  });

  it('gives the exact rate when the root is rational', () => {
    expect(periodicRate('0.21', { perYear: 2 })).toEqual({
      rate: '0.1000000000',
      lower: '0.1000000000',
      upper: '0.1000000001',
      exact: ratio(1n, 10n),
    });
    expect(periodicRate('0', { perYear: 12 }).exact).toEqual(ratio(0n));
    expect(periodicRate('0.05', { perYear: 1, digits: 2 }).exact).toEqual(ratio('0.05'));
    // (64/27)^(1/3) − 1 = 1/3: rational but not a decimal
    expect(periodicRate(ratio(37n, 27n), { perYear: 3, digits: 4 })).toEqual({
      rate: '0.3333',
      lower: '0.3333',
      upper: '0.3334',
      exact: ratio(1n, 3n),
    });
    expect(periodicRate('-0.75', { perYear: 2, digits: 1 }).exact).toEqual(ratio(-1n, 2n));
    expect(periodicRate('0.05', { perYear: 12 }).exact).toBeUndefined();
  });

  it('computes the annual rate exactly', () => {
    expect(annualRate('0.01', { perYear: 12 })).toEqual(
      ratio(126825030131969720661201n, 10n ** 24n),
    );
    expect(annualRate(ratio(1n, 3n), { perYear: 3 })).toEqual(ratio(37n, 27n));
    expect(annualRate('0', { perYear: 365 })).toEqual(ratio(0n));
    expect(annualRate('-0.5', { perYear: 1 })).toEqual(ratio('-0.5'));
  });

  it('rejects rates at or below -1 and bad options', () => {
    expect(() => periodicRate('-1', { perYear: 12 })).toThrow('must be above -1');
    expect(() => periodicRate('-1.5', { perYear: 2 })).toThrow('must be above -1');
    expect(() => annualRate('-1', { perYear: 12 })).toThrow('must be above -1');
    expect(() => annualRate('-2', { perYear: 2 })).toThrow('must be above -1');
    expect(() => periodicRate('0.05', { perYear: 0 })).toThrow('Invalid perYear 0');
    expect(() => periodicRate('0.05', { perYear: 1.5 })).toThrow('Invalid perYear 1.5');
    expect(() => periodicRate('0.05', { perYear: 12, digits: -1 })).toThrow('Invalid digits -1');
    expect(() => periodicRate('0.05', { perYear: 12, digits: 101 })).toThrow('Invalid digits 101');
    expect(() => periodicRate('0.05', { perYear: 1000, digits: 51 })).toThrow(
      'digits × perYear must be at most 50000',
    );
    expect(periodicRate('0.05', { perYear: 1000, digits: 50 }).rate).toMatch(/^0\.0000487/);
    expect(() => annualRate('0.01', { perYear: 0 })).toThrow('Invalid perYear 0');
    expect(() => annualRate('0.01', { perYear: 100_001 })).toThrow('Invalid perYear 100001');
  });

  it('throws when the periodic rate is within 10^-digits of -1', () => {
    // (10^-30)^(1/2) − 1 = −0.999999999999999…
    const almostAll = ratio(1n - 10n ** 30n, 10n ** 30n);
    expect(() => periodicRate(almostAll, { perYear: 2, digits: 10 })).toThrow(
      'ask for more digits',
    );
    // with no places, every negative rate is within 1 of −1, as with irr
    expect(() => periodicRate('-0.05', { perYear: 12, digits: 0 })).toThrow('ask for more digits');
    expect(periodicRate('0.05', { perYear: 12, digits: 0 }).rate).toBe('0');
    expect(periodicRate(almostAll, { perYear: 2, digits: 15 }).exact).toEqual(
      ratio(1n - 10n ** 15n, 10n ** 15n),
    );
  });

  const annualRates = fc
    .tuple(fc.bigInt({ min: -999_999n, max: 10n ** 7n }), fc.integer({ min: 0, max: 6 }))
    .map(([units, places]) => ratio(units, 10n ** BigInt(places)))
    .filter((value) => value.num + value.den > 0n);
  const perYears = fc.oneof(
    fc.constantFrom(1, 2, 4, 12, 52, 365),
    fc.integer({ min: 1, max: 400 }),
  );

  it('brackets the root: (1 + lower)^n ≤ 1 + annual < (1 + upper)^n', () => {
    fc.assert(
      fc.property(annualRates, perYears, fc.integer({ min: 0, max: 20 }), (annual, n, digits) => {
        fc.pre(digits * n <= 50_000);
        let result;
        try {
          result = periodicRate(annual, { perYear: n, digits });
        } catch (error) {
          // only a rate within 10^-digits of -1 may throw
          expect(String(error)).toContain('ask for more digits');
          return;
        }
        const { lower, upper } = result;
        // both have `digits` places, one grid step apart
        const grid = (value: string) => BigInt(value.replace('.', ''));
        expect([lower.split('.')[1]?.length ?? 0, grid(upper) - grid(lower)]).toEqual([digits, 1n]);
        expect(lessOrEqual(growthPower(lower, n), onePlus(annual))).toBe(true);
        expect(lessOrEqual(growthPower(upper, n), onePlus(annual))).toBe(false);
        if (result.exact !== undefined) {
          expect(growthPower(result.exact, n)).toEqual(onePlus(annual));
        }
      }),
      { numRuns: runs(200) },
    );
  });

  it('round-trips: periodicRate(annualRate(p)) is exactly p', () => {
    const periodicRates = fc
      .tuple(fc.bigInt({ min: -99_999n, max: 10n ** 6n }), fc.integer({ min: 0, max: 6 }))
      .map(([units, places]) => ratio(units, 10n ** BigInt(places)))
      .filter((value) => value.num + value.den > 0n);
    fc.assert(
      fc.property(periodicRates, fc.integer({ min: 1, max: 60 }), (periodic, n) => {
        const annual = annualRate(periodic, { perYear: n });
        expect(periodicRate(annual, { perYear: n, digits: 6 }).exact).toEqual(periodic);
      }),
      { numRuns: runs(100) },
    );
  });

  it('fewer digits truncate more digits', () => {
    fc.assert(
      // above −1/2 and with a digit, the periodic rate is never within 10^−digits of −1
      fc.property(annualRates, perYears, fc.integer({ min: 1, max: 15 }), (annual, n, digits) => {
        fc.pre(ratio(annual).num * 2n > -ratio(annual).den);
        const fine = periodicRate(annual, { perYear: n, digits: 20 }).lower;
        const coarse = periodicRate(annual, { perYear: n, digits }).lower;
        const scaled = ratio(fine).num * 10n ** BigInt(digits);
        const den = ratio(fine).den;
        // floor(fine · 10^digits) / 10^digits
        const floored = scaled / den - (scaled % den !== 0n && scaled < 0n ? 1n : 0n);
        expect(ratio(coarse)).toEqual(ratio(floored, 10n ** BigInt(digits)));
      }),
      { numRuns: runs(100) },
    );
  });
});

describe('fv, pv, pmt, nper and rate (Excel)', () => {
  const usd = (amount: string): Money<'USD'> => money(amount, 'USD');
  const exactText = (value: { num: bigint; den: bigint }) => text(ratio(value.num, value.den));

  it('follow Excel at a rate of 0', () => {
    // FV = −(pv + pmt·nper), PV = −(fv + pmt·nper), PMT = −(pv + fv)/nper, whatever the type
    expect(fv('0', 10, usd('-100'), { pv: usd('-50') }).toDecimal()).toBe('1050.00');
    expect(fv('0', 10, usd('-100'), { pv: usd('-50'), type: 1 }).toDecimal()).toBe('1050.00');
    expect(pv('0', 10, usd('100'), { fv: usd('50') }).toDecimal()).toBe('-1050.00');
    expect(pmt('0', 3, usd('1000'), { fv: usd('-100'), type: 1 }).toDecimal()).toBe('-300.00');
    expect(exactText(pmtExact('0', 3, usd('100')))).toBe('-100/3');
    expect(nper('0', usd('-100'), usd('1000'), { fv: usd('-50'), digits: 2 })).toEqual({
      nper: '9.50',
      lower: '9.50',
      upper: '9.51',
      exact: ratio(19n, 2n),
    });
  });

  it('are exact rationals, rounded once', () => {
    // (1.1^2 − 1)/0.1 = 2.1 payments of 100, at the end of each period
    expect(exactText(fvExact('0.1', 2, usd('-100')))).toBe('210/1');
    expect(exactText(fvExact('0.1', 2, usd('-100'), { type: 1 }))).toBe('231/1');
    expect(exactText(pvExact('0.1', 2, usd('-100')))).toBe('21000/121');
    expect(exactText(pmtExact('0.1', 2, usd('1000')))).toBe('-12100/21');
    expect(pmt('0.1', 2, usd('1000')).toDecimal()).toBe('-576.19');
    expect(pmt('0.1', 2, usd('1000'), {}, 'ceil').toDecimal()).toBe('-576.19');
    expect(pmt('0.1', 2, usd('1000'), {}, 'floor').toDecimal()).toBe('-576.20');
    // a negative rate makes Excel's denominators negative: every mode still rounds the exact value
    for (const mode of ['floor', 'ceil', 'halfEven', 'trunc'] as const) {
      expect(pmt('-0.01', 3, usd('100'), {}, mode)).toEqual(
        pmtExact('-0.01', 3, usd('100')).round(mode),
      );
      expect(fv('-0.01', 3, usd('-100'), {}, mode)).toEqual(
        fvExact('-0.01', 3, usd('-100')).round(mode),
      );
      expect(pv('-0.01', 3, usd('-100'), {}, mode)).toEqual(
        pvExact('-0.01', 3, usd('-100')).round(mode),
      );
    }
    // nper 0: the future value is the present value, negated; the present value is −fv
    expect(fv('0.05', 0, usd('-100'), { pv: usd('1000') }).toDecimal()).toBe('-1000.00');
    expect(pv('0.05', 0, usd('-100'), { fv: usd('1000') }).toDecimal()).toBe('-1000.00');
  });

  it('agree with each other: pv of pmt is the loan, fv of the plan is the target', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(fc.bigInt({ min: -40_000n, max: 300_000n }), fc.constant(6))
          .map(([units]) => ratio(units, 10n ** 6n)),
        fc.integer({ min: 1, max: 480 }),
        fc.bigInt({ min: -(10n ** 10n), max: 10n ** 10n }),
        fc.bigInt({ min: -(10n ** 10n), max: 10n ** 10n }),
        fc.constantFrom(0, 1 as const),
        (periodic, periods, loanMinor, targetMinor, type) => {
          const loan = fromMinor(loanMinor, 'USD');
          const target = fromMinor(targetMinor, 'USD');
          const payment = pmtExact(periodic, periods, loan, { fv: target, type });
          // the exact payment, as an amount at a scale that holds it, isn't always available, so
          // check the identity on the closed forms instead: FV(pmt, pv) = fv exactly
          const scaled = (value: { num: bigint; den: bigint }) => ratio(value.num, value.den);
          const paymentRatio = scaled(payment);
          // FV is linear in pmt: FV(pmt) = FV(0) + pmt·FV(1)
          const unit = fromMinor(100n, 'USD');
          const zero = fromMinor(0n, 'USD');
          const base = scaled(fvExact(periodic, periods, zero, { pv: loan, type }));
          const perUnit = scaled(fvExact(periodic, periods, unit, { type }));
          const future = ratio(
            base.num * perUnit.den * paymentRatio.den + perUnit.num * paymentRatio.num * base.den,
            base.den * perUnit.den * paymentRatio.den,
          );
          expect(future).toEqual(ratio(targetMinor, 100n));
        },
      ),
      { numRuns: runs(100) },
    );
  });

  it('rate is irr of the implied flows', () => {
    expect(rate(48, usd('-200'), usd('8000'), { digits: 8 })).toEqual({
      rate: '0.00770147',
      lower: '0.00770147',
      upper: '0.00770148',
    });
    // 1000 in, 600 and 400 out: exactly 0%
    expect(rate(2, usd('-600'), usd('1000'), { fv: usd('200'), digits: 4 }).rate).toBe('0.0000');
    expect(rate(1, usd('-50'), usd('1000'), { fv: usd('-1000'), digits: 6 }).rate).toBe('0.050000');
    expect(rate(1, usd('-50'), usd('1000'), { fv: usd('-950'), type: 1, digits: 6 }).rate).toBe(
      '0.000000',
    );
    expect(() => rate(10, usd('100'), usd('1000'))).toThrow('never change sign');
    // 100 out, 230 back, then 132 out: 10% and 20%
    expect(() => rate(2, usd('230'), usd('-100'), { fv: usd('-362') })).toThrow('pass a bracket');
    expect(
      rate(2, usd('230'), usd('-100'), { fv: usd('-362'), bracket: ['0.15', '0.5'], digits: 4 })
        .rate,
    ).toBe('0.2000');
  });

  it('nper is ln(A)/ln(1 + rate), bracketed and floored', () => {
    // 1000 at 10% with 0 payments grows to 1210 in exactly 2 periods
    expect(nper('0.1', usd('0'), usd('-1000'), { fv: usd('1210'), digits: 4 })).toEqual({
      nper: '2.0000',
      lower: '2.0000',
      upper: '2.0001',
      exact: ratio(2n),
    });
    // and to 1100 in exactly one, or back to 1000 in none
    expect(nper('0.1', usd('0'), usd('-1000'), { fv: usd('1100') }).exact).toEqual(ratio(1n));
    expect(nper('0.1', usd('0'), usd('-1000'), { fv: usd('1000') }).exact).toEqual(ratio(0n));
    // 1.21 = 1.1^2, so growing by 10% takes half a period at 21%
    expect(nper('0.21', usd('0'), usd('-1000'), { fv: usd('1100'), digits: 3 }).exact).toEqual(
      ratio(1n, 2n),
    );
    expect(nper('0.01', usd('-100'), usd('-1000'), { digits: 8 }).nper).toBe('-9.57859404');
    expect(() => nper('0.1', usd('-50'), usd('1000'))).toThrow('never settle');
    expect(() => nper('0', usd('0'), usd('1000'))).toThrow('no payment at a rate of 0');
    expect(() => nper('0.1', usd('-100'), usd('1000'), { digits: 101 })).toThrow('Invalid digits');
  });

  it('nper brackets the root: (1 + r)^lower ≤ A < (1 + r)^upper on integer checks', () => {
    // with digits 0 the bracket ends are whole numbers, where the powers are exact
    fc.assert(
      fc.property(
        fc.bigInt({ min: 100n, max: 200_000n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 1n, max: 1000n }),
        (rateUnits, loanMinor, margin) => {
          const periodic = ratio(rateUnits, 10n ** 6n);
          const interestMinor = (loanMinor * rateUnits) / 10n ** 6n;
          // a payment of at least 1/1000 of the loan over the interest: at most a few thousand
          // periods
          const paymentMinor = -(interestMinor + (loanMinor * margin) / 1000n + 1n);
          const result = nper(
            periodic,
            fromMinor(paymentMinor, 'USD'),
            fromMinor(loanMinor, 'USD'),
            {
              digits: 0,
            },
          );
          // A = pmt / (pmt + pv·r), above 1
          const growth = ratio(
            paymentMinor * periodic.den,
            paymentMinor * periodic.den + loanMinor * periodic.num,
          );
          const lower = BigInt(result.lower);
          // the check raises 1 + r to the result exactly, so keep it to a few thousand periods (a
          // 0.0001% rate can give millions, whose power has hundreds of millions of bits)
          fc.pre(lower <= 3000n);
          const at = (count: bigint) =>
            ratio((periodic.num + periodic.den) ** count, periodic.den ** count);
          const lessOrEqual = (left: Ratio, right: Ratio) =>
            left.num * right.den <= right.num * left.den;
          expect(lessOrEqual(at(lower), growth)).toBe(true);
          expect(lessOrEqual(at(lower + 1n), growth)).toBe(false);
        },
      ),
      { numRuns: runs(100) },
    );
  });

  it('nper gives up, rather than refine without end, when the result is too close to the grid', () => {
    // A = 1.21 + 10^-6000, so nper is 2 + about 8·10^-6001: telling it from 2 takes about 20,000
    // bits, past the cap
    const big = 10n ** 6000n;
    const options = { fv: fromMinor(121n * (big / 100n) + 1n, 'USD'), digits: 0 };
    expect(() => nper('0.1', usd('0'), fromMinor(-big, 'USD'), options)).toThrow(
      'too close to a 0-place decimal',
    );
    // 10^-300 is close, but within the cap
    const near = 10n ** 300n;
    const nearOptions = { fv: fromMinor(121n * (near / 100n) + 1n, 'USD'), digits: 0 };
    expect(nper('0.1', usd('0'), fromMinor(-near, 'USD'), nearOptions).nper).toBe('2');
  });

  it('reject what Excel computes differently', () => {
    expect(() => fv('0.1', 1.5, usd('-100'))).toThrow('nper must be a whole number');
    expect(() => pmt('0.1', 0, usd('100'))).toThrow('nper must be a whole number from 1');
    expect(() => rate(2.5, usd('-100'), usd('200'))).toThrow('nper must be a whole number');
    expect(() => fv('-1', 2, usd('-100'))).toThrow('must be above -1');
    expect(() => pv('-1.5', 2, usd('-100'))).toThrow('must be above -1');
    expect(() => fv('0.1', 2, usd('-100'), { type: 2 as 0 })).toThrow('Invalid type 2');
    expect(() => fv('0.1', 2, usd('-100'), { pv: eur('1') as unknown as Money<'USD'> })).toThrow(
      CurrencyMismatchError,
    );
  });
});

describe('prorate and splitPeriod', () => {
  const march = { start: '2026-03-01', end: '2026-04-01' };

  it('the design examples', () => {
    expect(
      String(
        prorate(
          eur('30'),
          { period: march, used: { start: '2026-03-11', end: '2026-04-01' } },
          'halfEven',
        ),
      ),
    ).toBe('20.32 EUR');
    expect(
      splitPeriod(eur('30'), { period: march, at: ['2026-03-11', '2026-03-20'] }).map(String),
    ).toEqual(['9.68 EUR', '8.71 EUR', '11.61 EUR']);
  });

  it('a plan change: credit the old plan, charge the new one, each rounded once', () => {
    const used = { start: '2026-03-11', end: '2026-04-01' };
    const credit = prorate(eur('30'), { period: march, used }, 'halfEven');
    const charge = prorate(eur('50'), { period: march, used }, 'halfEven');
    expect([credit, charge].map(String)).toEqual(['20.32 EUR', '33.87 EUR']);
  });

  it('by the second, from ISO date-times in UTC or Unix seconds', () => {
    const period = { start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z' };
    const used = { start: '2026-03-01T18:00:00Z', end: '2026-03-02T00:00:00Z' };
    expect(String(prorate(eur('10'), { period, used, unit: 'second' }))).toBe('2.50 EUR');
    const start = 1_772_323_200; // 2026-03-01T00:00:00Z
    const unix = { start, end: start + 86_400 };
    expect(
      String(
        prorate(eur('10'), {
          period: unix,
          used: { start: start + 64_800, end: start + 86_400 },
          unit: 'second',
        }),
      ),
    ).toBe('2.50 EUR');
    // a calendar date is midnight UTC
    expect(
      String(
        prorate(eur('10'), {
          period: { start: '2026-03-01', end: start + 86_400 },
          used,
          unit: 'second',
        }),
      ),
    ).toBe('2.50 EUR');
    expect(
      splitPeriod(eur('10'), { period, at: ['2026-03-01T06:00:00Z'], unit: 'second' }).map(String),
    ).toEqual(['2.50 EUR', '7.50 EUR']);
  });

  it('rejects instants that do not fit the unit, and parts outside the period', () => {
    expect(() =>
      prorate(eur('10'), { period: march, used: { start: '2026-02-28', end: '2026-03-02' } }),
    ).toThrow('inside the period');
    expect(() =>
      prorate(eur('10'), { period: { start: '2026-03-01', end: '2026-03-01' }, used: march }),
    ).toThrow('end after it starts');
    expect(() =>
      prorate(eur('10'), { period: { start: 0, end: 10 }, used: { start: 0, end: 5 } }),
    ).toThrow("unit 'second'");
    expect(() =>
      prorate(eur('10'), {
        period: { start: '2026-03-01T00:00:00Z', end: '2026-03-02' },
        used: march,
      }),
    ).toThrow("unit 'second'");
    expect(() =>
      prorate(eur('10'), {
        period: { start: '2026-03-01T24:00:00Z', end: '2026-03-02' },
        used: march,
        unit: 'second',
      }),
    ).toThrow('Invalid instant');
    expect(() => prorate(eur('10'), { period: march, used: march, unit: 'hour' as 'day' })).toThrow(
      'Invalid unit',
    );
    expect(() =>
      splitPeriod(eur('10'), { period: march, at: ['2026-03-20', '2026-03-11'] }),
    ).toThrow('Change points must increase');
    expect(() => splitPeriod(eur('10'), { period: march, at: ['2026-04-01'] })).toThrow(
      'strictly inside',
    );
  });

  it('property: the pieces of a split always sum to the price, and prorate the whole is the price', () => {
    const days = fc
      .uniqueArray(fc.integer({ min: 1, max: 364 }), { maxLength: 20 })
      .map((values) => values.sort((left, right) => left - right));
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), days, (minor, points) => {
        const price = cents(minor);
        const period = { start: '2027-01-01', end: '2028-01-01' };
        const at = points.map((day) => isoDay(2027, day));
        const pieces = splitPeriod(price, { period, at });
        expect(pieces).toHaveLength(points.length + 1);
        expect(sum(pieces).toMinor()).toBe(price.toMinor());
        expect(prorate(price, { period, used: period }).toMinor()).toBe(price.toMinor());
      }),
      { numRuns: runs(100) },
    );
  });
});

/** The ISO date `dayOfYear` days after 1 January of `year`. */
function isoDay(year: number, dayOfYear: number): string {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let remaining = dayOfYear;
  let month = 0;
  while (remaining >= lengths[month]!) {
    remaining -= lengths[month]!;
    month++;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(remaining + 1).padStart(2, '0')}`;
}
