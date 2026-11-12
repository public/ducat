/**
 * `@ducatjs/money/finance`: day counts, simple and compound interest, periodic and annual rates,
 * loan schedules, discounted sums and subscription proration, in exact arithmetic, under ducat's
 * own names (Excel's functions, with Excel's semantics, are in `@ducatjs/money/excel`). Every amount that is paid or booked is rounded
 * once from its exact value; nothing in between is rounded, and no floats are used. Dates are
 * calendar dates ('YYYY-MM-DD' or `{ year, month, day }`, so a `Temporal.PlainDate` works), never
 * `Date`. Free functions only: nothing is added to Money.
 */
import { currencyExponent } from './currency.js';
import { formatScaled, pow10n, ratio, type Factor, type Ratio } from './decimal.js';
import { ExactMoney, exact } from './exact.js';
import { allocate, instalments, type Remainder } from './allocate.js';
import { add, compare, make, subtract, sum, type Money, type RoundingInput } from './money.js';
import { DEFAULT_ROUNDING } from './rounding.js';
import {
  MAX_PERIODS,
  assertPeriods,
  assertPositiveInteger,
  assertSameCurrency,
  discountedValue,
  exactRoot,
  invalid,
  isMultipleOf,
  multiplyAndRound,
  roundQuotient,
  unreducedRatio,
  pmtValue,
} from './finance-shared.js';

// ---------------------------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------------------------

/**
 * A calendar date: a 'YYYY-MM-DD' string or an object with `year`, `month` (1-12) and `day`
 * fields, such as a `Temporal.PlainDate` in the ISO calendar. Proleptic Gregorian, years 0 to 9999,
 * no time and no time zone.
 */
export type CalendarDate =
  | string
  | { readonly year: number; readonly month: number; readonly day: number };

/** A calendar date split into its fields, checked. */
interface DateFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  // April, June, September and November have 30 days
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** The fields of a calendar date, or a RangeError for anything that is not a real date. */
function dateFields(date: CalendarDate): DateFields {
  let year: number;
  let month: number;
  let day: number;
  if (typeof date === 'string') {
    const match = DATE_RE.exec(date);
    if (match === null) {
      throw new RangeError(`Invalid date "${date}"; expected YYYY-MM-DD`);
    }
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    // a Temporal.PlainDate in another calendar has that calendar's fields, not Gregorian ones
    const calendar = (date as { calendarId?: unknown }).calendarId;
    if (calendar !== undefined && calendar !== 'iso8601') {
      throw new RangeError(`Dates must be in the ISO calendar; got ${String(calendar)}`);
    }
    year = date.year;
    month = date.month;
    day = date.day;
  }
  // years 0-9999, as 'YYYY-MM-DD' writes them, keep every day and second count exact
  const valid =
    Number.isInteger(year) &&
    year >= 0 &&
    year <= 9999 &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month);
  if (!valid) {
    throw new RangeError(`Invalid date ${formatFields(year, month, day)}`);
  }
  return { year, month, day };
}

function formatFields(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/**
 * Days from 1970-01-01 to the date, in integers (Howard Hinnant's `days_from_civil`): the year is
 * counted from March, so the leap day falls at the end of the counting year.
 */
function dayNumber({ year, month, day }: DateFields): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthFromMarch = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100);
  return era * 146_097 + dayOfEra + dayOfYear - 719_468;
}

/** Days from `start` to `end` (end exclusive): negative when `end` is earlier. */
function daysBetween(start: DateFields, end: DateFields): number {
  return dayNumber(end) - dayNumber(start);
}

function assertNotBefore(start: DateFields, end: DateFields): void {
  if (dayNumber(end) < dayNumber(start)) {
    throw new RangeError('The end date is before the start date');
  }
}

// ---------------------------------------------------------------------------------------------
// Day counts
// ---------------------------------------------------------------------------------------------

/**
 * A day-count convention, as defined in the 2006 ISDA Definitions §4.16:
 * - 'ACT/360' and 'ACT/365F': actual days over 360 or 365;
 * - 'ACT/ACT ISDA': days in leap years over 366 plus days in other years over 365;
 * - '30/360': Bond Basis, §4.16(f);
 * - '30E/360': Eurobond Basis, §4.16(g);
 * - '30E/360 ISDA': §4.16(h), which treats the last day of February as the 30th except on the
 *   termination date: when `end` is the last day of February, say whether it is with `maturity`.
 */
export type DayCount =
  | 'ACT/360'
  | 'ACT/365F'
  | 'ACT/ACT ISDA'
  | '30/360'
  | '30E/360'
  | '30E/360 ISDA';

/** Options for `yearFraction`. */
export interface YearFractionOptions {
  /**
   * '30E/360 ISDA' only: whether `end` is the termination (maturity) date, whose last day of
   * February is kept as is. Required when `end` is the last day of February, because the two
   * readings differ by up to two days and neither is a safe default.
   */
  readonly maturity?: boolean;
}

function isLastDayOfFebruary({ year, month, day }: DateFields): boolean {
  return month === 2 && day === daysInMonth(year, 2);
}

/** The 30/360 family's day count: 360 × years + 30 × months + days, after adjusting the days. */
function thirty360Days(
  start: DateFields,
  end: DateFields,
  startDay: number,
  endDay: number,
): number {
  return 360 * (end.year - start.year) + 30 * (end.month - start.month) + (endDay - startDay);
}

/**
 * The fraction of a year from `start` to `end` under `convention`, as an exact ratio. `end` may not
 * be before `start`. This is not Excel's YEARFRAC: its basis 0 is the US (NASD) 30/360 with
 * end-of-February rules rather than Bond Basis, its basis 1 divides by an average year length
 * rather than splitting days by calendar year as ACT/ACT ISDA does, and it swaps reversed dates.
 *
 *     yearFraction('2026-01-15', '2026-07-15', 'ACT/360')   // 181/360
 */
export function yearFraction(
  start: CalendarDate,
  end: CalendarDate,
  convention: DayCount,
  options?: YearFractionOptions,
): Ratio {
  const from = dateFields(start);
  const to = dateFields(end);
  assertNotBefore(from, to);

  switch (convention) {
    case 'ACT/360':
      return ratio(BigInt(daysBetween(from, to)), 360n);
    case 'ACT/365F':
      return ratio(BigInt(daysBetween(from, to)), 365n);
    case 'ACT/ACT ISDA':
      return actualActualIsda(from, to);
    case '30/360': {
      // §4.16(f): D1 = 31 becomes 30; D2 = 31 becomes 30 only when D1 is then 30 (or was 31)
      const startDay = from.day === 31 ? 30 : from.day;
      const endDay = to.day === 31 && startDay === 30 ? 30 : to.day;
      return ratio(BigInt(thirty360Days(from, to, startDay, endDay)), 360n);
    }
    case '30E/360': {
      // §4.16(g): a 31st on either side becomes the 30th
      const startDay = from.day === 31 ? 30 : from.day;
      const endDay = to.day === 31 ? 30 : to.day;
      return ratio(BigInt(thirty360Days(from, to, startDay, endDay)), 360n);
    }
    case '30E/360 ISDA': {
      // §4.16(h): the last day of a month becomes the 30th, except the last day of February when
      // it is the termination date
      const startDay = from.day === 31 || isLastDayOfFebruary(from) ? 30 : from.day;
      let endDay = to.day === 31 ? 30 : to.day;
      if (isLastDayOfFebruary(to)) {
        const maturity = options?.maturity;
        if (typeof maturity !== 'boolean') {
          throw new RangeError(
            "'30E/360 ISDA' ending on the last day of February needs the option maturity: true or false",
          );
        }
        endDay = maturity ? to.day : 30;
      }
      return ratio(BigInt(thirty360Days(from, to, startDay, endDay)), 360n);
    }
  }
  return invalid('day count', convention);
}

/** ACT/ACT ISDA: the days in each calendar year over that year's length, summed exactly. */
function actualActualIsda(from: DateFields, to: DateFields): Ratio {
  if (from.year === to.year) {
    return ratio(BigInt(daysBetween(from, to)), BigInt(daysInYear(from.year)));
  }
  const startYearEnd = { year: from.year + 1, month: 1, day: 1 };
  const endYearStart = { year: to.year, month: 1, day: 1 };
  const firstYearLength = BigInt(daysInYear(from.year));
  const lastYearLength = BigInt(daysInYear(to.year));
  const firstYearDays = BigInt(daysBetween(from, startYearEnd));
  const lastYearDays = BigInt(daysBetween(endYearStart, to));
  const wholeYears = BigInt(to.year - from.year - 1);
  // firstYearDays/firstYearLength + wholeYears + lastYearDays/lastYearLength over one denominator
  const denominator = firstYearLength * lastYearLength;
  const numerator =
    firstYearDays * lastYearLength + wholeYears * denominator + lastYearDays * firstYearLength;
  return ratio(numerator, denominator);
}

// ---------------------------------------------------------------------------------------------
// Rounding helpers
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Interest
// ---------------------------------------------------------------------------------------------

/** The accrual period of `interest` and `interestExact`. */
export interface InterestPeriod extends YearFractionOptions {
  /** The first day of interest. */
  readonly from: CalendarDate;
  /** The day interest runs to (exclusive, as in every day count). */
  readonly to: CalendarDate;
  /** The day-count convention. */
  readonly dayCount: DayCount;
}

/**
 * Simple interest, `principal × rate × yearFraction`, exactly. `rate` is an annual rate as a
 * `Factor` ('0.05' for 5%).
 */
export function interestExact<C extends string>(
  principal: Money<C>,
  yearlyRate: Factor,
  period: InterestPeriod,
): ExactMoney<C> {
  const fraction = yearFraction(period.from, period.to, period.dayCount, period);
  return exact(principal).multiply(yearlyRate).multiply(fraction);
}

/**
 * Simple interest, `principal × rate × yearFraction`, rounded once (to the currency's exponent with
 * a mode, or to a policy's scale; default 'halfExpand').
 *
 *     interest(money('10000', 'EUR'), '0.05',
 *       { from: '2026-01-15', to: '2026-07-15', dayCount: 'ACT/365F' }, 'halfEven')   // 247.95 EUR
 */
export function interest<C extends string>(
  principal: Money<C>,
  yearlyRate: Factor,
  period: InterestPeriod,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const fraction = yearFraction(period.from, period.to, period.dayCount, period);
  const rateRatio = ratio(yearlyRate);
  return multiplyAndRound(
    principal,
    ratio(rateRatio.num * fraction.num, rateRatio.den * fraction.den),
    rounding,
  );
}

/** The compounding of `compound`: how many periods, and how many make a year. */
export interface CompoundOptions {
  /** A non-negative integer number of compounding periods. */
  readonly periods: number;
  /** Compounding periods per year (12 for monthly): the periodic rate is `rate / perYear`. */
  readonly perYear: number;
}

/** (1 + rate/perYear) as a reduced ratio, checked to be positive. */
function growthFactor(yearlyRate: Factor, perYear: number): Ratio {
  assertPositiveInteger(perYear, 'perYear');
  const rateRatio = ratio(yearlyRate);
  const perYearBig = BigInt(perYear);
  const growth = ratio(rateRatio.num + rateRatio.den * perYearBig, rateRatio.den * perYearBig);
  if (growth.num <= 0n) {
    throw new RangeError(`A rate of ${yearlyRate} per year loses everything in one period`);
  }
  return growth;
}

/**
 * Periodic compounding: `principal × (1 + rate/perYear)^periods` (at most 100,000 periods), an
 * exact integer power, rounded once. Fractional periods and continuous compounding are irrational, so they are not offered.
 *
 *     compound(money('1000', 'EUR'), '0.05', { periods: 12, perYear: 12 }, 'halfEven') // 1051.16 EUR
 */
export function compound<C extends string>(
  principal: Money<C>,
  yearlyRate: Factor,
  options: CompoundOptions,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const periods = options.periods;
  assertPeriods(periods, 0);
  const growth = growthFactor(yearlyRate, options.perYear);
  const exponent = BigInt(periods);
  // a power of a reduced ratio is reduced, so no gcd is needed on the large integers
  const power = unreducedRatio(growth.num ** exponent, growth.den ** exponent);
  return multiplyAndRound(principal, power, rounding);
}

// ---------------------------------------------------------------------------------------------
// Effective rates per period
// ---------------------------------------------------------------------------------------------

/** Options for `periodicRate`. */
export interface PeriodicRateOptions {
  /** Periods per year (12 for monthly): a positive integer. */
  readonly perYear: number;
  /** Decimal places of the result (default 10, at most 100; `digits × perYear` at most 50,000). */
  readonly digits?: number;
}

/** Options for `annualRate`. */
export interface AnnualRateOptions {
  /**
   * Periods per year (12 for monthly): a positive integer, at most 100,000. That is more than
   * `periodicRate` takes, whose root costs grow with `digits × perYear` (at most 50,000).
   */
  readonly perYear: number;
}

/** The result of `periodicRate`: decimal strings with `digits` places, and the exact rate when it is rational. */
export interface PeriodicRateResult {
  /** The periodic rate floored to `digits` places: the same as `lower`. */
  readonly rate: string;
  /** The periodic rate rounded down to `digits` places: `(1 + lower)^perYear ≤ 1 + annual`. */
  readonly lower: string;
  /** `lower` plus 10^−digits: `(1 + upper)^perYear > 1 + annual`. */
  readonly upper: string;
  /**
   * The exact periodic rate, when it is rational: when the reduced numerator and denominator of
   * `1 + annual` are both perfect `perYear`th powers (`'0.21'` with `perYear: 2` gives 1/10).
   */
  readonly exact?: Ratio;
}

/**
 * The most `digits × perYear` that `periodicRate` takes: each step raises a `digits`-place decimal
 * to the `perYear`th power, so this bounds the integers to about 170,000 bits (daily to 100 places
 * takes about 0.3 s).
 */
const MAX_ROOT_SIZE = 50_000;

/** 1 + rate as a reduced ratio, checked to be positive. */
function onePlus(value: Factor, name: string): Ratio {
  const rateRatio = ratio(value);
  // num + den over den is reduced when num over den is: they share the same gcd
  const growth = ratio(rateRatio.num + rateRatio.den, rateRatio.den);
  if (growth.num <= 0n) {
    throw new RangeError(`The ${name} rate must be above -1; got ${String(value)}`);
  }
  return growth;
}

/**
 * The periodic rate equivalent to an effective annual rate: `(1 + annual)^(1/perYear) − 1`, the
 * monthly rate that compounds to the annual one with `perYear: 12`. This converts effective rates;
 * it isn't the nominal `rate / perYear` that `compound` and `amortise` use, nor Excel's NOMINAL.
 *
 * The root is irrational in general, so like `irr` the rate is found to `digits` decimal places
 * (default 10), floored, by bisection in exact integer arithmetic on the grid of `digits`-place
 * decimals: `rate` is `lower`, and the exact root lies in [`lower`, `upper`), 10^−digits apart,
 * since `(1 + lower)^perYear ≤ 1 + annual < (1 + upper)^perYear`. When the root is rational,
 * `exact` holds it. Each step raises a `digits`-place decimal to the `perYear`th power, so the cost
 * grows with `digits × perYear`, which may be at most 50,000: monthly at 10 digits is at most about
 * 34 steps on 400-bit integers, daily at 100 digits 330 steps on 120,000-bit integers (0.3 s).
 *
 * It throws a RangeError for an annual rate at or below −1 (everything lost), and when the
 * periodic rate is within 10^−digits of −1: ask for more digits.
 *
 *     periodicRate('0.05', { perYear: 12, digits: 12 })
 *     // { rate: '0.004074123783', lower: '0.004074123783', upper: '0.004074123784' }
 */
export function periodicRate(annual: Factor, options: PeriodicRateOptions): PeriodicRateResult {
  const perYear = options.perYear;
  if (!(Number.isInteger(perYear) && perYear >= 1 && perYear <= MAX_ROOT_SIZE)) {
    invalid('perYear', perYear);
  }
  const digits = options.digits ?? 10;
  if (!(Number.isInteger(digits) && digits >= 0 && digits <= 100)) {
    invalid('digits', digits);
  }
  if (digits * perYear > MAX_ROOT_SIZE) {
    throw new RangeError(
      `digits × perYear must be at most ${MAX_ROOT_SIZE}; got ${digits} × ${perYear}`,
    );
  }
  const growth = onePlus(annual, 'annual');
  const power = BigInt(perYear);
  const unit = pow10n(digits);

  // The largest G with (G / unit)^n ≤ growth, so the rate's grid point is G − unit. G = 0 always
  // qualifies; above, unit·(1 + annual/n) + 1 never does, since (1 + a/n)^n ≥ 1 + a (Bernoulli).
  const target = growth.num * unit ** power;
  const fits = (grid: bigint) => grid ** power * growth.den <= target;
  let low: bigint;
  let high: bigint;
  if (growth.num >= growth.den) {
    low = unit;
    high = unit + ((growth.num - growth.den) * unit) / (growth.den * power) + 1n;
  } else {
    low = 0n;
    high = unit;
  }
  while (high - low > 1n) {
    const middle = (low + high) >> 1n;
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  if (low === 0n) {
    throw new RangeError(`The periodic rate is within 10^-${digits} of -1; ask for more digits`);
  }

  const lower = formatScaled(low - unit, digits);
  const upper = formatScaled(low - unit + 1n, digits);
  const rootNum = perYear === 1 ? growth.num : exactRoot(growth.num, power);
  const rootDen = perYear === 1 ? growth.den : exactRoot(growth.den, power);
  if (rootNum === undefined || rootDen === undefined) {
    return { rate: lower, lower, upper };
  }
  // the roots of coprime integers are coprime, so this is reduced
  return { rate: lower, lower, upper, exact: ratio(rootNum - rootDen, rootDen) };
}

/**
 * The effective annual rate a periodic rate compounds to: `(1 + periodic)^perYear − 1`, exact (an
 * integer power of a rational), as a reduced `Ratio`. It inverts `periodicRate`: the annual rate of
 * `periodicRate(a).exact` is `a`, and `a` lies between the annual rates of `lower` and `upper`.
 * It isn't Excel's EFFECT, which takes a nominal rate.
 *
 *     annualRate('0.01', { perYear: 12 }) // 126825030131969720661201 / 10^24, about 12.68%
 */
export function annualRate(periodic: Factor, options: AnnualRateOptions): Ratio {
  const perYear = options.perYear;
  if (!(Number.isInteger(perYear) && perYear >= 1 && perYear <= MAX_PERIODS)) {
    invalid('perYear', perYear);
  }
  const growth = onePlus(periodic, 'periodic');
  const exponent = BigInt(perYear);
  // a power of a reduced ratio is reduced, and so is one minus it, so no gcd is needed
  const denominator = growth.den ** exponent;
  return unreducedRatio(growth.num ** exponent - denominator, denominator);
}

// ---------------------------------------------------------------------------------------------
// Amortisation
// ---------------------------------------------------------------------------------------------

/**
 * How a loan is repaid:
 * - 'annuity' (French): equal payments of interest and principal;
 * - 'linear' (German): equal principal parts, with interest on top, so payments fall;
 * - 'interestOnly' (bullet): interest every period, and the principal with the last payment.
 */
export type AmortisationMethod = 'annuity' | 'linear' | 'interestOnly';

/**
 * Where an annuity's rounding residual goes: the last payment (the default, which most lenders
 * use), or the last period's interest, which keeps the last payment equal to the others.
 */
export type AmortisationResidual = 'lastPayment' | 'lastInterest';

/** Options for `amortise`. */
export interface AmortiseOptions<C extends string> {
  /** The nominal annual rate, as a `Factor` ('0.045' for 4.5%). Not negative. */
  readonly rate: Factor;
  /** Payments per year (12 for monthly): the periodic rate is `rate / perYear`. */
  readonly perYear: number;
  /** The number of payments. */
  readonly periods: number;
  /** How the loan is repaid (default 'annuity'). */
  readonly method?: AmortisationMethod;
  /**
   * How every payment and interest charge is rounded: a mode, to the currency's exponent, or a
   * rounding policy (default 'halfExpand').
   */
  readonly rounding?: RoundingInput;
  /**
   * An amount still owed after the regular payments, paid with the last one ('annuity' and
   * 'linear' only).
   */
  readonly balloon?: Money<C>;
  /**
   * The date of the first payment. With `perYear` 1, 2, 3, 4, 6 or 12 the later ones follow
   * monthly, on this date's day of the month, clamped to shorter months (31 January, 28 February,
   * 31 March). That is not the end-of-month rule: from 30 November, quarterly dates are 28 or 29
   * February and then 30 May, not 31 May; pass an anchor of 31 for month ends. With 26 or 52, the
   * payments are every 14 or 7 days.
   */
  readonly firstPayment?: CalendarDate;
  /**
   * Where an annuity's rounding residual goes (default 'lastPayment'). 'lastInterest' applies to
   * annuities only: linear and interest-only schedules have no residual.
   */
  readonly residual?: AmortisationResidual;
}

/** One payment of an amortisation schedule. */
export interface AmortisationRow<C extends string> {
  /** 1 for the first payment. */
  readonly period: number;
  /** The payment date ('YYYY-MM-DD'), when `firstPayment` is given. */
  readonly date?: string;
  /** Interest plus principal. */
  readonly payment: Money<C>;
  /** This period's interest: the balance before the payment times the periodic rate, rounded. */
  readonly interest: Money<C>;
  /** The part of the payment that repays the loan. */
  readonly principal: Money<C>;
  /** What is still owed after the payment. */
  readonly balance: Money<C>;
  /** Reserved for interest from a day count between payment dates; not set yet. */
  readonly days?: number;
  /** Reserved for interest from a day count between payment dates; not set yet. */
  readonly yearFraction?: Ratio;
}

/** The result of `amortise`. */
export interface Amortisation<C extends string> {
  /**
   * The regular payment: for 'annuity' every payment but possibly the last; for 'linear' the
   * first (the largest); for 'interestOnly' the interest payment.
   */
  readonly payment: Money<C>;
  /** One row per payment. */
  readonly rows: AmortisationRow<C>[];
  /** The sum of the interest column, exactly. */
  readonly totalInterest: Money<C>;
}

/** The minor unit a rounding produces, for loans whose parts must be multiples of it. */
function roundingUnit<C extends string>(currency: C, rounding: RoundingInput): Money<C> {
  if (typeof rounding === 'string') {
    return make(currency, 1, currencyExponent(currency));
  }
  return make(currency, rounding.increment, rounding.scale ?? currencyExponent(currency));
}

/** The payment dates: monthly steps from the anchor date, clamped to month ends, or 7 or 14 days. */
function paymentDates(first: CalendarDate, perYear: number, count: number): string[] {
  const anchor = dateFields(first);
  const dates: string[] = [];
  if (perYear === 26 || perYear === 52) {
    const step = perYear === 52 ? 7 : 14;
    const anchorDay = dayNumber(anchor);
    for (let i = 0; i < count; i++) {
      dates.push(dateFromDayNumber(anchorDay + i * step));
    }
    return checkedDates(dates);
  }
  if (!(Number.isSafeInteger(perYear) && 12 % perYear === 0)) {
    // payment dates step by whole months, or by 7 or 14 days
    invalid('perYear for payment dates', perYear);
  }
  const monthStep = 12 / perYear;
  for (let i = 0; i < count; i++) {
    const monthIndex = anchor.month - 1 + i * monthStep;
    const year = anchor.year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = Math.min(anchor.day, daysInMonth(year, month));
    dates.push(formatFields(year, month, day));
  }
  return checkedDates(dates);
}

/** The dates, unless the last (and latest) is past the year 9999, which dates can't hold. */
function checkedDates(dates: string[]): string[] {
  if (dates[dates.length - 1]!.length !== 10) {
    throw new RangeError('The payment dates run past the year 9999');
  }
  return dates;
}

/** The inverse of `dayNumber` (Howard Hinnant's `civil_from_days`). */
function dateFromDayNumber(days: number): string {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1;
  const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return formatFields(year, month, day);
}

/**
 * A loan's repayment schedule. Each period's interest is the balance times `rate / perYear`,
 * rounded once; the principal part is the payment minus the interest. The principal parts sum
 * exactly to the loan, the balance never goes negative, and it ends at exactly zero: the rounding
 * residual goes to the last payment (or, with `residual: 'lastInterest'`, to the last interest). If
 * rounded payments clear the loan early, the schedule ends with the payment that clears it, so it
 * can have fewer rows than `periods`. With a zero rate, the payments are
 * `instalments(loan, periods, { remainder: 'toLast' })` (there is no interest to take a residual).
 * The loan and the balloon must be multiples of the rounding's unit (0.01 EUR, or a policy's
 * increment), so that every amount in the schedule is too. At most 100,000 periods.
 *
 *     amortise(money('200000', 'EUR'), { rate: '0.045', perYear: 12, periods: 300 }).payment
 *     // 1111.66 EUR
 */
export function amortise<C extends string>(
  loan: Money<C>,
  options: AmortiseOptions<NoInfer<C>>,
): Amortisation<C> {
  const periods = options.periods;
  const perYear = options.perYear;
  const method = options.method ?? 'annuity';
  const rounding = options.rounding ?? DEFAULT_ROUNDING;
  const residual = options.residual ?? 'lastPayment';
  const currency = loan.currency;
  const zeroAmount = make(currency, 0, currencyExponent(currency));
  const balloon = options.balloon ?? zeroAmount;

  assertPeriods(periods, 1);
  assertPositiveInteger(perYear, 'perYear');
  if (!(loan.minor > 0)) {
    throw new RangeError(`The loan must be positive; got ${loan}`);
  }
  assertSameCurrency(loan, balloon);
  if (balloon.minor < 0 || compare(balloon, loan) > 0) {
    throw new RangeError(`The balloon must be between zero and the loan; got ${balloon}`);
  }
  if (options.balloon !== undefined && method === 'interestOnly') {
    throw new RangeError("An 'interestOnly' loan repays all of it at the end; drop the balloon");
  }
  if (method !== 'annuity' && method !== 'linear' && method !== 'interestOnly') {
    invalid('method', method);
  }
  if (residual !== 'lastPayment' && residual !== 'lastInterest') {
    invalid('residual', residual);
  }
  const unit = roundingUnit(currency, rounding);
  if (!isMultipleOf(loan, unit) || !isMultipleOf(balloon, unit)) {
    throw new RangeError(`The loan and the balloon must be multiples of ${unit}`);
  }
  const rateRatio = ratio(options.rate);
  if (rateRatio.num < 0n) {
    throw new RangeError(`The rate must not be negative; got ${options.rate}`);
  }
  // with no interest to round, there is no residual to put in it
  if (residual === 'lastInterest' && (method !== 'annuity' || rateRatio.num === 0n)) {
    throw new RangeError("residual 'lastInterest' applies to annuities with a non-zero rate only");
  }
  const dates =
    options.firstPayment === undefined
      ? undefined
      : paymentDates(options.firstPayment, perYear, periods);
  const ratePerPeriod = ratio(rateRatio.num, rateRatio.den * BigInt(perYear));

  const rows: AmortisationRow<C>[] = [];
  const pushRow = (
    payment: Money<C>,
    interestPart: Money<C>,
    principal: Money<C>,
    balance: Money<C>,
  ) => {
    const period = rows.length + 1;
    const row: AmortisationRow<C> =
      dates === undefined
        ? { period, payment, interest: interestPart, principal, balance }
        : { period, date: dates[period - 1]!, payment, interest: interestPart, principal, balance };
    rows.push(row);
  };

  // The principal parts of a linear loan, or of any loan at a zero rate: equal parts that sum to
  // the loan exactly, each a multiple of the rounding's unit, the remainder in the last one.
  const isZeroRate = rateRatio.num === 0n;
  if (method === 'linear' || (method === 'annuity' && isZeroRate)) {
    const parts = instalments(subtract(loan, balloon), periods, {
      remainder: 'toLast',
      unit,
    });
    let balance = loan;
    for (let i = 0; i < periods; i++) {
      const isLast = i === periods - 1;
      const principal = isLast ? balance : parts[i]!;
      const interestPart = multiplyAndRound(balance, ratePerPeriod, rounding);
      balance = subtract(balance, principal);
      pushRow(add(principal, interestPart), interestPart, principal, balance);
    }
    return finish(rows, currency);
  }

  if (method === 'interestOnly') {
    const interestPart = multiplyAndRound(loan, ratePerPeriod, rounding);
    for (let i = 0; i < periods; i++) {
      const isLast = i === periods - 1;
      const principal = isLast ? loan : zeroAmount;
      const balance = isLast ? zeroAmount : loan;
      pushRow(add(principal, interestPart), interestPart, principal, balance);
    }
    return { payment: interestPart, rows, totalInterest: sumInterest(rows, currency) };
  }

  // Annuity: payment = (P·g^n − B)·r / (g^n − 1), with r = a/b and g = 1 + r = (a + b)/b. With
  // G = (a + b)^n and H = b^n that is (P·G − B·H)·a / (b·(G − H)), and P and B are minor units
  // over 10^scale, so the exact payment is one fraction of integers, rounded once.
  const scale = Math.max(loan.scale, balloon.scale);
  const loanMinor = BigInt(loan.minor) * pow10n(scale - loan.scale);
  const balloonMinor = BigInt(balloon.minor) * pow10n(scale - balloon.scale);
  const exponent = BigInt(periods);
  const growthPower = (ratePerPeriod.num + ratePerPeriod.den) ** exponent;
  const basePower = ratePerPeriod.den ** exponent;
  const payment = roundQuotient(
    currency,
    (loanMinor * growthPower - balloonMinor * basePower) * ratePerPeriod.num,
    pow10n(scale) * ratePerPeriod.den * (growthPower - basePower),
    rounding,
  );

  let balance = loan;
  for (let i = 0; i < periods; i++) {
    const interestPart = multiplyAndRound(balance, ratePerPeriod, rounding);
    const isLast = i === periods - 1;
    const owed = add(balance, interestPart);
    // the last payment, or a regular payment that would clear more than is owed, settles the loan
    if (isLast || compare(payment, owed) >= 0) {
      if (isLast && residual === 'lastInterest') {
        const lastPayment = add(payment, balloon);
        const lastInterest = subtract(lastPayment, balance);
        if (lastInterest.minor < 0) {
          throw new RangeError(
            "The residual exceeds the last interest; use residual 'lastPayment'",
          );
        }
        pushRow(lastPayment, lastInterest, balance, subtract(balance, balance));
      } else {
        pushRow(owed, interestPart, balance, subtract(balance, balance));
      }
      break;
    }
    const principal = subtract(payment, interestPart);
    balance = subtract(balance, principal);
    pushRow(payment, interestPart, principal, balance);
  }
  return { payment, rows, totalInterest: sumInterest(rows, currency) };
}

function sumInterest<C extends string>(rows: readonly AmortisationRow<C>[], currency: C): Money<C> {
  // the rows share one currency, which the generic C cannot show the type checker
  const interestColumn = rows.map((row) => row.interest as Money<string>);
  return sum(interestColumn, currency) as Money<C>;
}

function finish<C extends string>(rows: AmortisationRow<C>[], currency: C): Amortisation<C> {
  return { payment: rows[0]!.payment, rows, totalInterest: sumInterest(rows, currency) };
}

// ---------------------------------------------------------------------------------------------
// NPV and IRR
// ---------------------------------------------------------------------------------------------

/**
 * The discounted sum of flows at periods 0, 1, 2…, `Σ flowₜ / (1 + rate)ᵗ`, exactly: the textbook
 * NPV, with the first flow (an initial outlay, say) not discounted. `npvExact` is Excel's form. (Not
 * Excel's PV, which is an annuity's present value.)
 */
export function discountedSumExact<C extends string>(
  discountRate: Factor,
  flows: readonly Money<C>[],
): ExactMoney<C> {
  const [numerator, denominator] = discountedValue(discountRate, flows, false);
  return new ExactMoney(flows[0]!.currency, numerator, denominator);
}

/**
 * The discounted sum of flows at periods 0, 1, 2…, exact and rounded once (to the currency's
 * exponent with a mode, or to a policy's scale; default 'halfExpand'). The first flow is not
 * discounted; this is `flows[0] + npv(rate, flows.slice(1))`.
 *
 *     discountedSum('0.08', [money('-1000', 'EUR'), money('300', 'EUR'), money('400', 'EUR'),
 *       money('500', 'EUR')], 'halfEven')   // 17.63 EUR
 */
export function discountedSum<C extends string>(
  discountRate: Factor,
  flows: readonly Money<C>[],
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const [numerator, denominator] = discountedValue(discountRate, flows, false);
  return roundQuotient(flows[0]!.currency, numerator, denominator, rounding);
}

// ---------------------------------------------------------------------------------------------
// Savings plans
// ---------------------------------------------------------------------------------------------

/** When each contribution is paid in: at the end of its period (the default) or at the start. */
export type ContributionTiming = 'end' | 'start';

/** Options for `savingsPlan`: a fixed `contribution`, or a `target` to save up to. */
export interface SavingsPlanOptions<C extends string> {
  /** The nominal annual rate, as a `Factor` ('0.03' for 3%): the periodic rate is `rate / perYear`. */
  readonly rate: Factor;
  /** Contributions per year (12 for monthly). */
  readonly perYear: number;
  /** The number of contributions. */
  readonly periods: number;
  /** The amount paid in every period. Give this or `target`. */
  readonly contribution?: Money<C> | undefined;
  /**
   * The balance to reach after the last period. The regular contribution is Excel's PMT for it,
   * rounded, and the last contribution takes the rounding residual, so the plan ends on exactly
   * this. Give this or `contribution`.
   */
  readonly target?: Money<C> | undefined;
  /** The balance before the first period (default zero). */
  readonly initial?: Money<C> | undefined;
  /** When contributions are paid in (default 'end', Excel's `type` 0; 'start' is `type` 1). */
  readonly timing?: ContributionTiming | undefined;
  /**
   * How every interest credit (and a target's contribution) is rounded: a mode, to the currency's
   * exponent, or a rounding policy (default 'halfExpand').
   */
  readonly rounding?: RoundingInput | undefined;
  /** The date of the first contribution; the later ones follow as `amortise`'s `firstPayment`. */
  readonly firstContribution?: CalendarDate | undefined;
}

/** One period of a savings plan. */
export interface SavingsPlanRow<C extends string> {
  /** 1 for the first period. */
  readonly period: number;
  /** The contribution date ('YYYY-MM-DD'), when `firstContribution` is given. */
  readonly date?: string;
  /** The amount paid in this period. */
  readonly contribution: Money<C>;
  /**
   * This period's interest: the balance it earns on times the periodic rate, rounded. That is the
   * balance before the period, plus this period's contribution when it is paid at the start, in
   * every row.
   */
  readonly interest: Money<C>;
  /**
   * Only on the last row of a start-timed target plan, and only when no whole-unit contribution
   * reaches the target exactly (the rounded interest skipped it): the unit left over, paid at the
   * end of the period, after interest. It counts in `totalContributions`.
   */
  readonly adjustment?: Money<C>;
  /** The balance after the period: the previous balance plus the contribution, the interest and any adjustment. */
  readonly balance: Money<C>;
}

/** The result of `savingsPlan`. */
export interface SavingsPlan<C extends string> {
  /** The regular contribution (with a `target`, every one but possibly the last). */
  readonly contribution: Money<C>;
  /** One row per period. */
  readonly rows: SavingsPlanRow<C>[];
  /** The sum of the contribution column, exactly. */
  readonly totalContributions: Money<C>;
  /** The sum of the interest column, exactly. */
  readonly totalInterest: Money<C>;
  /** The balance after the last period: `initial + totalContributions + totalInterest`. */
  readonly balance: Money<C>;
}

/**
 * The last contribution c of a start-timed target plan, paid at the start of the period, so that
 * balance + c + round((balance + c)·r) is the target: interest is then credited only on what was
 * paid in. Over the unit grid that sum rises by one unit, or two when the rounded interest steps up
 * too (one or none at a negative rate), so the target can fall in a gap. Then c is the largest
 * contribution that stays below it, and the unit left over is an `adjustment` paid at the end of
 * the period, after interest.
 */
function settleAtStart<C extends string>(
  balance: Money<C>,
  target: Money<C>,
  periodic: Ratio,
  unit: Money<C>,
  rounding: RoundingInput,
): [Money<C>, Money<C> | undefined] {
  const needed = subtract(target, balance);
  const reached = (contribution: Money<C>) =>
    add(contribution, multiplyAndRound(add(balance, contribution), periodic, rounding));
  // start near (needed − balance·r) / (1 + r), then step by units to the target
  const growth = ratio(periodic.num + periodic.den, periodic.den);
  let contribution = multiplyAndRound(
    subtract(needed, multiplyAndRound(balance, periodic, rounding)),
    ratio(growth.den, growth.num),
    rounding,
  );
  // below the target from the start, then up while the next step doesn't pass it
  while (compare(reached(contribution), needed) > 0) {
    contribution = subtract(contribution, unit);
  }
  for (;;) {
    const next = add(contribution, unit);
    if (compare(reached(next), needed) > 0) {
      break;
    }
    contribution = next;
  }
  const short = subtract(needed, reached(contribution));
  return [contribution, BigInt(short.minor) === 0n ? undefined : short];
}

/**
 * A savings plan: a regular contribution every period, earning interest at `rate / perYear`, with
 * each period's interest rounded once from the exact balance it earns on, as a bank credits it.
 * Nothing else is rounded, so the final balance is exactly `initial + totalContributions +
 * totalInterest`.
 *
 * With a `contribution`, the plan pays it in every period. With a `target`, the regular
 * contribution is Excel's PMT for the target (`−pmtExact(rate / perYear, periods, −initial, { fv:
 * target, type })`), rounded once, and the last contribution takes the residual the rounding
 * leaves, so the final balance is exactly the target, as `amortise` settles a loan on its last
 * payment. With `timing: 'start'`, the last contribution c is solved so that the balance plus c
 * plus the rounded interest on both is the target, so interest is only ever credited on what was
 * paid in; where the rounding skips the target, the unit left over is an `adjustment` paid at the
 * end of the period. At a rate of 0 there is no interest, and the
 * regular contribution is `(target − initial) / periods`, rounded, the residual on the last.
 *
 * The amounts share one currency and are multiples of the rounding's unit. The rate may be
 * negative, down to −perYear (everything lost in a period) excluded. Contributions may be negative
 * (withdrawals), and a target below what the initial balance grows to gives them.
 *
 *     savingsPlan({ rate: '0.06', perYear: 12, periods: 10, contribution: money('200', 'USD'),
 *       initial: money('500', 'USD'), timing: 'start' }).balance // 2581.40 USD
 */
export function savingsPlan<C extends string>(options: SavingsPlanOptions<C>): SavingsPlan<C> {
  const periods = options.periods;
  const perYear = options.perYear;
  const rounding = options.rounding ?? DEFAULT_ROUNDING;
  const timing = options.timing ?? 'end';
  const { contribution: given, target } = options;
  assertPeriods(periods, 1);
  assertPositiveInteger(perYear, 'perYear');
  if ((given === undefined) === (target === undefined)) {
    throw new RangeError('Give a savings plan a contribution or a target, not both or neither');
  }
  if (timing !== 'end' && timing !== 'start') {
    invalid('timing', timing);
  }
  const reference = (given ?? target)!;
  const currency = reference.currency;
  const zeroAmount = make(currency, 0, currencyExponent(currency));
  const initial = options.initial ?? zeroAmount;
  assertSameCurrency(reference, initial);
  const unit = roundingUnit(currency, rounding);
  for (const amount of [reference, initial]) {
    if (!isMultipleOf(amount, unit)) {
      throw new RangeError(`The amounts must be multiples of ${unit}; got ${amount}`);
    }
  }
  const rateRatio = ratio(options.rate);
  const periodic = ratio(rateRatio.num, rateRatio.den * BigInt(perYear));
  if (periodic.num + periodic.den <= 0n) {
    throw new RangeError(
      `A rate of ${String(options.rate)} per year loses everything in one period`,
    );
  }
  const dates =
    options.firstContribution === undefined
      ? undefined
      : paymentDates(options.firstContribution, perYear, periods);

  let regular: Money<C>;
  if (given === undefined) {
    // Excel's sign convention: the initial balance is paid out (negative), the target received
    // (pmtValue rather than pmtExact, so a plan doesn't pull in ExactMoney)
    const [, numerator, denominator] = pmtValue(periodic, periods, subtract(zeroAmount, initial), {
      fv: target,
      type: timing === 'start' ? 1 : 0,
    });
    regular = roundQuotient(currency, -numerator, denominator, rounding);
  } else {
    regular = given;
  }

  const rows: SavingsPlanRow<C>[] = [];
  let balance = initial;
  for (let period = 1; period <= periods; period++) {
    let contribution = regular;
    let adjustment: Money<C> | undefined;
    if (target !== undefined && period === periods) {
      // the last contribution of a target plan settles it exactly
      [contribution, adjustment] =
        timing === 'start'
          ? settleAtStart(balance, target, periodic, unit, rounding)
          : [
              subtract(subtract(target, balance), multiplyAndRound(balance, periodic, rounding)),
              undefined,
            ];
    }
    // interest on what is actually in the account during the period
    const earning = timing === 'start' ? add(balance, contribution) : balance;
    const interestPart = multiplyAndRound(earning, periodic, rounding);
    balance = add(add(balance, contribution), interestPart);
    if (adjustment !== undefined) {
      balance = add(balance, adjustment);
    }
    const row: SavingsPlanRow<C> = {
      period,
      ...(dates === undefined ? {} : { date: dates[period - 1]! }),
      contribution,
      interest: interestPart,
      ...(adjustment === undefined ? {} : { adjustment }),
      balance,
    };
    rows.push(row);
  }
  const column = (pick: (row: SavingsPlanRow<C>) => Money<C>) =>
    sum(
      rows.map((row) => pick(row) as Money<string>),
      currency,
    ) as Money<C>;
  return {
    contribution: regular,
    rows,
    totalContributions: column((row) =>
      row.adjustment === undefined ? row.contribution : add(row.contribution, row.adjustment),
    ),
    totalInterest: column((row) => row.interest),
    balance,
  };
}

// ---------------------------------------------------------------------------------------------
// Proration
// ---------------------------------------------------------------------------------------------

/**
 * A point in time for proration: a calendar date (midnight UTC), or with `unit: 'second'`, an ISO
 * date-time in UTC ('2026-03-11T09:30:00Z') or a Unix time in whole seconds.
 */
export type ProrationInstant = CalendarDate | number;

/** A span of time, `end` exclusive. */
export interface ProrationPeriod {
  readonly start: ProrationInstant;
  readonly end: ProrationInstant;
}

/** What proration counts: whole days (the default) or seconds. */
export type ProrationUnit = 'day' | 'second';

/** Options for `prorate`. */
export interface ProrateOptions {
  /** The billing period the price is for. */
  readonly period: ProrationPeriod;
  /** The part of it being charged or credited; inside `period`. */
  readonly used: ProrationPeriod;
  /** Count days (the default) or seconds. */
  readonly unit?: ProrationUnit;
}

/** Options for `splitPeriod`. */
export interface SplitPeriodOptions {
  /** The billing period the price is for. */
  readonly period: ProrationPeriod;
  /** The change points, in increasing order, strictly inside the period. */
  readonly at: readonly ProrationInstant[];
  /** Count days (the default) or seconds. */
  readonly unit?: ProrationUnit;
  /** Where indivisible minor units go (default 'largest', as in `allocate`). */
  readonly remainder?: Remainder;
}

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** The instant as a count of `unit`s since 1970-01-01T00:00:00Z. */
function instantCount(instant: ProrationInstant, unit: ProrationUnit): number {
  if (unit !== 'day' && unit !== 'second') {
    invalid('unit', unit);
  }
  if (typeof instant === 'number') {
    if (unit !== 'second' || !Number.isSafeInteger(instant)) {
      throw new RangeError(`Unix time ${instant} needs whole seconds and unit 'second'`);
    }
    return instant;
  }
  if (typeof instant === 'string' && instant.length > 10) {
    const match = DATE_TIME_RE.exec(instant);
    if (unit !== 'second' || match === null) {
      throw new RangeError(`Invalid instant "${instant}" (YYYY-MM-DDTHH:MM:SSZ, unit 'second')`);
    }
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    const seconds = Number(match[4]);
    if (hours > 23 || minutes > 59 || seconds > 59) {
      throw new RangeError(`Invalid instant "${instant}"`);
    }
    return dayNumber(dateFields(match[1]!)) * 86_400 + hours * 3600 + minutes * 60 + seconds;
  }
  const days = dayNumber(dateFields(instant));
  return unit === 'day' ? days : days * 86_400;
}

function spanOf(period: ProrationPeriod, unit: ProrationUnit): { start: number; end: number } {
  const start = instantCount(period.start, unit);
  const end = instantCount(period.end, unit);
  if (!(end > start)) {
    throw new RangeError('A period must end after it starts');
  }
  return { start, end };
}

/**
 * The part of `price` for the `used` part of a billing `period`: `price × used / period`, counted in
 * days (or seconds), exact and rounded once (to the currency's exponent with a mode, or to a
 * policy's scale; default 'halfExpand'). Periods are end-exclusive.
 *
 *     prorate(money('30', 'EUR'), {
 *       period: { start: '2026-03-01', end: '2026-04-01' },
 *       used: { start: '2026-03-11', end: '2026-04-01' },
 *     }, 'halfEven')   // 20.32 EUR (21 of 31 days)
 */
export function prorate<C extends string>(
  price: Money<C>,
  options: ProrateOptions,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const unit = options.unit ?? 'day';
  const period = spanOf(options.period, unit);
  const usedStart = instantCount(options.used.start, unit);
  const usedEnd = instantCount(options.used.end, unit);
  if (!(usedStart >= period.start && usedEnd <= period.end && usedEnd >= usedStart)) {
    throw new RangeError('The used part must lie inside the period');
  }
  const fraction = ratio(BigInt(usedEnd - usedStart), BigInt(period.end - period.start));
  return multiplyAndRound(price, fraction, rounding);
}

/**
 * Splits one period's price at change points (plan changes), in proportion to the days (or seconds)
 * in each piece, through `allocate`, so the pieces always sum exactly to the price.
 *
 *     splitPeriod(money('30', 'EUR'), {
 *       period: { start: '2026-03-01', end: '2026-04-01' },
 *       at: ['2026-03-11', '2026-03-20'],
 *     })   // [9.68 EUR, 8.71 EUR, 11.61 EUR]
 */
export function splitPeriod<C extends string>(
  price: Money<C>,
  options: SplitPeriodOptions,
): Money<C>[] {
  const unit = options.unit ?? 'day';
  const period = spanOf(options.period, unit);
  const weights: number[] = [];
  let previous = period.start;
  for (const point of options.at) {
    const count = instantCount(point, unit);
    if (!(count > previous && count < period.end)) {
      throw new RangeError('Change points must increase and lie strictly inside the period');
    }
    weights.push(count - previous);
    previous = count;
  }
  weights.push(period.end - previous);
  return allocate(price, weights, { remainder: options.remainder ?? 'largest' });
}
