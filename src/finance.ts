/**
 * `@ducatjs/money/finance`: day counts, simple and compound interest, loan schedules, NPV and IRR,
 * and subscription proration, in exact arithmetic. Every amount that is paid or booked is rounded
 * once from its exact value; nothing in between is rounded, and no floats are used. Dates are
 * calendar dates ('YYYY-MM-DD' or `{ year, month, day }`, so a `Temporal.PlainDate` works), never
 * `Date`. Free functions only: nothing is added to Money.
 */
import { currencyExponent } from './currency.js';
import { formatScaled, pow10n, ratio, type Factor, type Ratio } from './decimal.js';
import { ExactMoney, exact } from './exact.js';
import { allocate, instalments, type Remainder } from './allocate.js';
import {
  add,
  compare,
  CurrencyMismatchError,
  make,
  multiplyByRatio,
  subtract,
  sum,
  type Money,
  type RoundingInput,
} from './money.js';
import { DEFAULT_ROUNDING } from './rounding.js';

// ---------------------------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------------------------

/**
 * A calendar date: a 'YYYY-MM-DD' string or an object with `year`, `month` (1-12) and `day`
 * fields, such as a `Temporal.PlainDate`. Proleptic Gregorian, no time and no time zone.
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
    year = date.year;
    month = date.month;
    day = date.day;
  }
  const valid =
    Number.isSafeInteger(year) &&
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
 *   termination date (pass it as `terminationDate`).
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
  /** '30E/360 ISDA' only: the termination date, whose last day of February is kept as is. */
  readonly terminationDate?: CalendarDate;
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

function sameDate(date: DateFields, other: DateFields): boolean {
  return date.year === other.year && date.month === other.month && date.day === other.day;
}

/**
 * The fraction of a year from `start` to `end` under `convention`, as an exact ratio. `end` may not
 * be before `start`.
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
      const termination =
        options?.terminationDate === undefined ? undefined : dateFields(options.terminationDate);
      const startDay = from.day === 31 || isLastDayOfFebruary(from) ? 30 : from.day;
      const isTermination = termination !== undefined && sameDate(to, termination);
      const endDay = to.day === 31 || (isLastDayOfFebruary(to) && !isTermination) ? 30 : to.day;
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

/**
 * numerator / denominator major units (denominator > 0) rounded once: with a mode, to the
 * currency's exponent; with a policy, to the policy's scale and increment. The fraction is not
 * reduced first: rounding divides once either way, and a gcd of the thousands-of-bits integers a
 * long schedule or NPV builds would cost more than everything else.
 */
function roundQuotient<C extends string>(
  currency: C,
  numerator: bigint,
  denominator: bigint,
  rounding: RoundingInput,
): Money<C> {
  // one major unit times the fraction, so the rounding applies to the fraction itself
  return multiplyAndRound(make(currency, 1, 0), unreducedRatio(numerator, denominator), rounding);
}

/** money × factor rounded once, at the currency's exponent or the policy's scale. */
function multiplyAndRound<C extends string>(
  money: Money<C>,
  factor: Ratio,
  rounding: RoundingInput,
): Money<C> {
  return multiplyByRatio(money, factor, rounding, currencyExponent(money.currency));
}

/**
 * A ratio built without a gcd, for rounding once: multiplyByRatio divides by it, which gives the
 * same result for any representation of the fraction.
 */
function unreducedRatio(numerator: bigint, denominator: bigint): Ratio {
  const toNumber = (value: bigint) =>
    value <= 9_007_199_254_740_991n && value >= -9_007_199_254_740_991n ? Number(value) : NaN;
  return { num: numerator, den: denominator, n: toNumber(numerator), d: toNumber(denominator) };
}

/** Throws a RangeError naming the option and the value it was given. */
function invalid(name: string, value: unknown): never {
  throw new RangeError(`Invalid ${name} ${String(value)}`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!(Number.isSafeInteger(value) && value >= 1)) {
    invalid(name, value);
  }
}

function assertSameCurrency(money: Money, other: Money): void {
  if (money.currency !== other.currency) {
    throw new CurrencyMismatchError(money.currency, other.currency);
  }
}

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
  rate: Factor,
  period: InterestPeriod,
): ExactMoney<C> {
  const fraction = yearFraction(period.from, period.to, period.dayCount, period);
  return exact(principal).multiply(rate).multiply(fraction);
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
  rate: Factor,
  period: InterestPeriod,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const fraction = yearFraction(period.from, period.to, period.dayCount, period);
  const rateRatio = ratio(rate);
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
function growthFactor(rate: Factor, perYear: number): Ratio {
  assertPositiveInteger(perYear, 'perYear');
  const rateRatio = ratio(rate);
  const perYearBig = BigInt(perYear);
  const growth = ratio(rateRatio.num + rateRatio.den * perYearBig, rateRatio.den * perYearBig);
  if (growth.num <= 0n) {
    throw new RangeError(`A rate of ${rate} per year loses everything in one period`);
  }
  return growth;
}

/**
 * Periodic compounding: `principal × (1 + rate/perYear)^periods`, an exact integer power, rounded
 * once. Fractional periods and continuous compounding are irrational, so they are not offered.
 *
 *     compound(money('1000', 'EUR'), '0.05', { periods: 12, perYear: 12 }, 'halfEven') // 1051.16 EUR
 */
export function compound<C extends string>(
  principal: Money<C>,
  rate: Factor,
  options: CompoundOptions,
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const periods = options.periods;
  if (!(Number.isSafeInteger(periods) && periods >= 0)) {
    invalid('periods', periods);
  }
  const growth = growthFactor(rate, options.perYear);
  const exponent = BigInt(periods);
  // a power of a reduced ratio is reduced, so no gcd is needed on the large integers
  const power = unreducedRatio(growth.num ** exponent, growth.den ** exponent);
  return multiplyAndRound(principal, power, rounding);
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
   * monthly, counted from this date and clamped to the end of the month (31 January, 28 February,
   * 31 March); with 26 or 52, every 14 or 7 days.
   */
  readonly firstPayment?: CalendarDate;
  /** Where an annuity's rounding residual goes (default 'lastPayment'). */
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
    return dates;
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
 * rounded payments clear the loan early, the schedule ends with the payment that clears it. With a
 * zero rate, the payments are `instalments(loan, periods, { remainder: 'toLast' })`.
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

  assertPositiveInteger(periods, 'periods');
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
  const rateRatio = ratio(options.rate);
  if (rateRatio.num < 0n) {
    throw new RangeError(`The rate must not be negative; got ${options.rate}`);
  }
  const dates =
    options.firstPayment === undefined
      ? undefined
      : paymentDates(options.firstPayment, perYear, periods);
  const periodicRate = ratio(rateRatio.num, rateRatio.den * BigInt(perYear));

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
      unit: roundingUnit(currency, rounding),
    });
    let balance = loan;
    for (let i = 0; i < periods; i++) {
      const isLast = i === periods - 1;
      const principal = isLast ? balance : parts[i]!;
      const interestPart = multiplyAndRound(balance, periodicRate, rounding);
      balance = subtract(balance, principal);
      pushRow(add(principal, interestPart), interestPart, principal, balance);
    }
    return finish(rows, currency);
  }

  if (method === 'interestOnly') {
    const interestPart = multiplyAndRound(loan, periodicRate, rounding);
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
  const growthPower = (periodicRate.num + periodicRate.den) ** exponent;
  const basePower = periodicRate.den ** exponent;
  const payment = roundQuotient(
    currency,
    (loanMinor * growthPower - balloonMinor * basePower) * periodicRate.num,
    pow10n(scale) * periodicRate.den * (growthPower - basePower),
    rounding,
  );

  let balance = loan;
  for (let i = 0; i < periods; i++) {
    const interestPart = multiplyAndRound(balance, periodicRate, rounding);
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

/** The flows' minor units at one common scale, checked to share a currency. */
function flowMinors<C extends string>(
  flows: readonly Money<C>[],
): { minors: bigint[]; scale: number } {
  if (flows.length === 0) {
    throw new RangeError('At least one cash flow is needed');
  }
  const first = flows[0]!;
  let scale = 0;
  for (const flow of flows) {
    assertSameCurrency(first, flow);
    if (flow.scale > scale) {
      scale = flow.scale;
    }
  }
  const minors = flows.map((flow) => BigInt(flow.minor) * pow10n(scale - flow.scale));
  return { minors, scale };
}

/**
 * Σ flowₜ · bᵗ · q^(n−t) for a rate of (q − b)/b: the NPV times q^n, by Horner's rule. q^n is
 * positive for a rate above −1, so this has the NPV's sign.
 */
function scaledPresentValue(
  minors: readonly bigint[],
  growthNumerator: bigint,
  base: bigint,
): bigint {
  let accumulator = minors[0]!;
  let basePower = 1n;
  for (let i = 1; i < minors.length; i++) {
    basePower *= base;
    accumulator = accumulator * growthNumerator + minors[i]! * basePower;
  }
  return accumulator;
}

/**
 * The net present value of flows at periods 0, 1, 2…, `Σ flowₜ / (1 + rate)ᵗ`, exactly. The first
 * flow is not discounted (a spreadsheet's NPV discounts its first value by one period).
 */
export function npvExact<C extends string>(
  rate: Factor,
  flows: readonly Money<C>[],
): ExactMoney<C> {
  const [numerator, denominator] = presentValue(rate, flows);
  return new ExactMoney(flows[0]!.currency, numerator, denominator);
}

/** The NPV in major units as an unreduced fraction, its denominator positive. */
function presentValue(rate: Factor, flows: readonly Money[]): [bigint, bigint] {
  const { minors, scale } = flowMinors(flows);
  const rateRatio = ratio(rate);
  const growthNumerator = rateRatio.num + rateRatio.den;
  if (growthNumerator <= 0n) {
    throw new RangeError(`The rate must be above -1; got ${rate}`);
  }
  const scaled = scaledPresentValue(minors, growthNumerator, rateRatio.den);
  return [scaled, growthNumerator ** BigInt(minors.length - 1) * pow10n(scale)];
}

/**
 * The net present value of flows at periods 0, 1, 2…, exact and rounded once (to the currency's
 * exponent with a mode, or to a policy's scale; default 'halfExpand').
 *
 *     npv('0.08', [money('-1000', 'EUR'), money('300', 'EUR'), money('400', 'EUR'),
 *       money('500', 'EUR')], 'halfEven')   // 17.63 EUR
 */
export function npv<C extends string>(
  rate: Factor,
  flows: readonly Money<C>[],
  rounding: RoundingInput = DEFAULT_ROUNDING,
): Money<C> {
  const [numerator, denominator] = presentValue(rate, flows);
  return roundQuotient(flows[0]!.currency, numerator, denominator, rounding);
}

/** Options for `irr`. */
export interface IrrOptions {
  /** Decimal places of the result (default 10). */
  readonly digits?: number;
  /**
   * Rates the IRR lies between, with NPVs of opposite signs at the two ends. Needed when the flows
   * change sign more than once, since they can then have several IRRs.
   */
  readonly bracket?: readonly [Factor, Factor];
}

/** The result of `irr`: decimal strings with `digits` places. */
export interface IrrResult {
  /** The IRR truncated to `digits` places: the same as `lower`. */
  readonly rate: string;
  /** The NPV at `lower` has the opposite sign to the NPV at `upper`, or is zero. */
  readonly lower: string;
  /** `lower` plus 10^−digits. */
  readonly upper: string;
}

function signOf(value: bigint): -1 | 0 | 1 {
  if (value > 0n) {
    return 1;
  }
  if (value < 0n) {
    return -1;
  }
  return 0;
}

/** Sign changes in the flows, zeros skipped, and the sign of the first non-zero flow. */
function signChanges(minors: readonly bigint[]): { changes: number; firstSign: -1 | 0 | 1 } {
  let changes = 0;
  let firstSign: -1 | 0 | 1 = 0;
  let previous: -1 | 0 | 1 = 0;
  for (const minor of minors) {
    const sign = signOf(minor);
    if (sign === 0) {
      continue;
    }
    if (firstSign === 0) {
      firstSign = sign;
    }
    if (previous !== 0 && sign !== previous) {
      changes++;
    }
    previous = sign;
  }
  return { changes, firstSign };
}

/**
 * The internal rate of return: the rate at which the flows' NPV is zero, to `digits` decimal places
 * (default 10). It is a polynomial root, irrational in general, so it is found by bisection in
 * exact integer arithmetic on the grid of `digits`-place decimals, with no floats and no Newton
 * steps: the NPV at `lower` and at `upper`, 10^−digits apart, has opposite signs (or is zero at
 * `lower`), and `rate` is `lower`. Each step checks the NPV's sign alone, by Horner's rule on
 * integers, so nothing is divided.
 *
 * Throws a RangeError when the flows never change sign (there is no IRR), and when they change sign
 * more than once unless a `bracket` is given: such flows can have several IRRs, and picking one
 * silently is a classic IRR bug.
 *
 *     irr([money('-1000', 'EUR'), money('300', 'EUR'), money('400', 'EUR'), money('500', 'EUR')],
 *       { digits: 8 })   // { rate: '0.08896339', lower: '0.08896339', upper: '0.08896340' }
 */
export function irr(flows: readonly Money[], options?: IrrOptions): IrrResult {
  const digits = options?.digits ?? 10;
  if (!(Number.isInteger(digits) && digits >= 0 && digits <= 100)) {
    invalid('digits', digits);
  }
  const { minors } = flowMinors(flows);
  const { changes, firstSign } = signChanges(minors);
  const bracket = options?.bracket;
  if (changes === 0) {
    throw new RangeError('The cash flows never change sign, so they have no IRR');
  }
  if (changes > 1 && bracket === undefined) {
    throw new RangeError(
      `The cash flows change sign ${changes} times, so they can have several IRRs; pass a bracket`,
    );
  }

  // A rate of m / 10^digits: its growth factor's numerator is 10^digits + m over 10^digits.
  const unit = pow10n(digits);
  const signAt = (grid: bigint): -1 | 0 | 1 =>
    signOf(scaledPresentValue(minors, unit + grid, unit));
  const result = (grid: bigint): IrrResult => {
    const lower = formatScaled(grid, digits);
    return { rate: lower, lower, upper: formatScaled(grid + 1n, digits) };
  };

  let low: bigint;
  let high: bigint;
  let lowSign: -1 | 0 | 1;
  if (bracket !== undefined) {
    const lowRate = ratio(bracket[0]);
    const highRate = ratio(bracket[1]);
    // widen the bracket outwards to the grid
    low = floorDivide(lowRate.num * unit, lowRate.den);
    high = -floorDivide(-highRate.num * unit, highRate.den);
    if (!(low < high)) {
      throw new RangeError('The bracket must be two increasing rates');
    }
    if (low <= -unit) {
      throw new RangeError('The bracket must be above -1');
    }
    lowSign = signAt(low);
    const highSign = signAt(high);
    if (lowSign === 0) {
      return result(low);
    }
    if (highSign === 0) {
      return result(high);
    }
    if (lowSign === highSign) {
      throw new RangeError('The NPV has the same sign at both ends of the bracket');
    }
  } else {
    // One sign change: exactly one IRR above −1 (Descartes' rule in 1/(1 + rate)). The NPV has the
    // first flow's sign for large rates and the last flow's sign near −1.
    const zeroSign = signAt(0n);
    if (zeroSign === 0) {
      return result(0n);
    }
    if (zeroSign === firstSign) {
      // the IRR is negative: between −1 (excluded, where the NPV has the last flow's sign) and 0
      low = -unit;
      high = 0n;
      lowSign = -firstSign as -1 | 1;
    } else {
      // the IRR is positive: double the upper end until the NPV takes the first flow's sign
      low = 0n;
      high = unit;
      lowSign = zeroSign;
      for (;;) {
        const highSign = signAt(high);
        if (highSign === 0) {
          return result(high);
        }
        if (highSign !== lowSign) {
          break;
        }
        low = high;
        high *= 2n;
      }
    }
  }

  // Bisection on the grid: the bracket's ends stay `digits`-place decimals, so the integers stay
  // bounded by the digits asked for, and each step halves the bracket.
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    const middleSign = signAt(middle);
    if (middleSign === 0) {
      return result(middle);
    }
    if (middleSign === lowSign) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return result(low);
}

function floorDivide(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  // bigint division truncates; step down when a negative quotient left a remainder
  return dividend % divisor !== 0n && dividend < 0n !== divisor < 0n ? quotient - 1n : quotient;
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
