# `@ducatjs/money/finance`

Day counts, interest, loan schedules, NPV, IRR and proration, in exact arithmetic. **Installs:** nothing; every function is a free function.

Related: [How to calculate interest and loans](../how-to/calculate-interest-and-loans.md) · [The finance module's design](../explanation/finance-design.md) · [About rounding](../explanation/rounding.md)

Every amount that is paid or booked is rounded once from its exact value, with a rounding mode (to the currency's exponent) or a rounding policy (to its scale and increment); the default is `'halfExpand'`. Dates are `'YYYY-MM-DD'` strings or `{ year, month, day }` objects (so a `Temporal.PlainDate` works), never `Date`. Functions named after Excel's (NPV, IRR, FV, PV, PMT, NPER, RATE) give Excel's values; others have other names.

All functions throw `RangeError` for an invalid date (not `YYYY-MM-DD`, out of range, or not in the ISO calendar), and `CurrencyMismatchError` for flows in more than one currency.

## Day counts and interest

### yearFraction

`yearFraction(start: CalendarDate, end: CalendarDate, convention: DayCount, options?: YearFractionOptions): Ratio`

The fraction of a year from `start` to `end` under `convention`, as an exact `Ratio`, as the 2006 ISDA Definitions §4.16 define the conventions. It isn't Excel's YEARFRAC, whose bases differ: its basis 0 is the US (NASD) 30/360 with end-of-February rules rather than Bond Basis, its basis 1 divides by an average year length rather than splitting days by calendar year as ACT/ACT ISDA does, and it swaps reversed dates.

- **Throws:** `RangeError` when `end` is before `start`, and for `'30E/360 ISDA'` when `end` is the last day of February and `maturity` isn't given.

### interest

`interest<C extends string>(principal: Money<C>, rate: Factor, period: InterestPeriod, rounding?: RoundingInput): Money<C>`

Simple interest, `principal × rate × yearFraction`, where `rate` is an annual rate (`'0.05'` for 5%).

- **Rounds:** once.

### interestExact

`interestExact<C extends string>(principal: Money<C>, rate: Factor, period: InterestPeriod): ExactMoney<C>`

The same, unrounded.

### compound

`compound<C extends string>(principal: Money<C>, rate: Factor, options: CompoundOptions, rounding?: RoundingInput): Money<C>`

Periodic compounding over a whole number of periods: `principal × (1 + rate/perYear)^periods`, an exact integer power. Fractional periods and continuous compounding are irrational, so they aren't offered.

- **Rounds:** once.
- **Throws:** `RangeError` for more than 100,000 periods, a periods count that isn't a non-negative integer, or a rate that loses everything in one period.

## Loans

### amortise

`amortise<C extends string>(loan: Money<C>, options: AmortiseOptions<C>): Amortisation<C>`

An annuity, linear or interest-only repayment schedule. Each period's interest is the balance times `rate / perYear`, rounded; the principal part is the payment minus the interest. The principal parts sum exactly to the loan, the balance never goes negative, and it ends at exactly zero, because the rounding residual goes to the last payment (or, with `residual: 'lastInterest'`, to the last interest). If rounded payments clear the loan early, the schedule ends with the payment that clears it, so it can have fewer rows than `periods`. With a zero rate, the payments are `instalments(loan, periods, { remainder: 'toLast' })`. It takes a `balloon` and a `firstPayment` date.

- **Rounds:** every payment and interest charge, once each, with `options.rounding`.
- **Throws:** `RangeError` when the loan isn't positive, the balloon isn't between zero and the loan, an `'interestOnly'` loan has a balloon, the loan or the balloon isn't a multiple of the rounding's unit (0.01 EUR, or a policy's increment), the rate is negative, `residual: 'lastInterest'` is used on anything but an annuity with a non-zero rate, there are more than 100,000 periods, or the payment dates run past the year 9999.

## Present value and IRR

### npv

`npv<C extends string>(rate: Factor, flows: readonly Money<C>[], rounding?: RoundingInput): Money<C>`

Excel's NPV: `Σ flowᵢ / (1 + rate)ⁱ` for i = 1, 2…, so the first flow is at the end of period 1. Like Excel, an initial outlay at period 0 goes outside: `flows[0] + npv(rate, rest)`, or use `discountedSum`.

- **Rounds:** once, so it matches Excel to the cent.
- **Throws:** `RangeError` for no flows, or a rate not above −1.

### npvExact

`npvExact<C extends string>(rate: Factor, flows: readonly Money<C>[]): ExactMoney<C>`

Excel's NPV, unrounded.

### discountedSum

`discountedSum<C extends string>(rate: Factor, flows: readonly Money<C>[], rounding?: RoundingInput): Money<C>`

The discounted sum of flows at periods 0, 1, 2…, `Σ flowₜ / (1 + rate)ᵗ`: the textbook NPV, with the first flow not discounted. It is `flows[0] + npv(rate, flows.slice(1))`. (Not Excel's PV, which is an annuity's present value.)

- **Rounds:** once.
- **Throws:** as `npv`.

### discountedSumExact

`discountedSumExact<C extends string>(rate: Factor, flows: readonly Money<C>[]): ExactMoney<C>`

The same, unrounded.

### irr

`irr(flows: readonly Money<string>[], options?: IrrOptions): IrrResult`

Excel's IRR: the rate at which the NPV of flows at periods 0, 1, 2… is zero, exact to `digits` places (default 10), floored. `rate` is `lower`, and the IRR lies between `lower` and `upper`, 10^−digits apart. It bisects in exact integer arithmetic on the grid of `digits`-place decimals: no floats and no Newton steps.

- **Throws:** `RangeError` where Excel guesses: when the flows never change sign (Excel's #NUM!), and when they change sign more than once unless a `bracket` (in place of Excel's `guess`) selects one root. Also `RangeError` for a bracket that isn't two increasing rates above −1, a bracket whose ends have NPVs of the same sign, an IRR within 10^−digits of −1, and an IRR above 2^1024 (the search for a positive root doubles at most 1,024 times).

### periodicRate

`periodicRate(annual: Factor, options: PeriodicRateOptions): PeriodicRateResult`

The periodic rate equivalent to an effective annual rate, `(1 + annual)^(1/perYear) − 1` (the monthly rate of a savings plan). The root is irrational in general, so, as `irr` does, it is found to `digits` places (default 10, at most 100), floored, by exact bisection: `(1 + lower)^perYear ≤ 1 + annual < (1 + upper)^perYear`, with `upper = lower + 10^−digits` and `rate` equal to `lower`. `exact` is set when the root is rational (the reduced numerator and denominator of `1 + annual` are both perfect `perYear`th powers): `'0.21'` with `perYear: 2` gives 1/10, and `periodicRate(annualRate(p)).exact` is `p`. It isn't `rate / perYear`, the nominal split that `compound` and `amortise` use, and it isn't an Excel name (Excel's RRI and EFFECT compute the same values from other arguments).

- **Throws:** `RangeError` for an annual rate at or below −1, a `perYear` that isn't a positive integer, `digits` outside 0–100 or `digits × perYear` over 50,000, and when the periodic rate is within 10^−digits of −1 (ask for more digits).

### annualRate

`annualRate(periodic: Factor, options: AnnualRateOptions): Ratio`

The effective annual rate of a periodic rate, `(1 + periodic)^perYear − 1`, exactly, as a reduced `Ratio`. The inverse of `periodicRate`.

- **Throws:** `RangeError` for a `perYear` that isn't a positive integer up to 100,000, or a periodic rate at or below −1.

```ts
import { annualRate, periodicRate } from '@ducatjs/money/finance';

periodicRate('0.05', { perYear: 12, digits: 8 }); // → { rate: '0.00407412', lower: '0.00407412', upper: '0.00407413' }
periodicRate('0.21', { perYear: 2 }).exact; // → { num: 1n, den: 10n, n: 1, d: 10 }
annualRate('0.1', { perYear: 2 }); // → { num: 21n, den: 100n, n: 21, d: 100 }
```

## Annuities: Excel's FV, PV, PMT, NPER and RATE

Excel's names, so Excel's arguments, sign convention (money paid out is negative, money received positive), `type` (0 = payments at the end of each period, the default; 1 = at the start) and values. Excel's required arguments are positional in Excel's order; the optional ones go in an options object, and the rounding comes last. Amounts are `Money` of one currency, and the rate is the rate per period, a `Factor` (`ratio('0.08', 12)` for 8% a year paid monthly). Where Excel would compute something else, they throw rather than give another value: `nper` must be a whole number for `fv`, `pv`, `pmt` and `rate` (Excel takes fractions, whose powers are irrational), a rate at or below −1 is refused, and `type` is 0 or 1.

### fv

`fv<C extends string>(rate: Factor, nper: number, pmt: Money<C>, options?: FvOptions<C>, rounding?: RoundingInput): Money<C>`

Excel's FV: the future value of `pmt` every period for `nper` periods, on top of `pv`: `−(pv·(1 + rate)^nper + pmt·(1 + rate·type)·((1 + rate)^nper − 1)/rate)`, and at a rate of 0, `−(pv + pmt·nper)`. Exact, then rounded once.

- **Rounds:** once; it is `fvExact(…).round(rounding)`.
- **Throws:** `RangeError` for an `nper` that isn't a whole number from 0 to 100,000, a rate at or below −1, a `type` other than 0 or 1, or when `(1 + rate)^nper` would pass 2^20 bits (2^17 for the `…Exact` forms, which reduce their fraction).

### fvExact

`fvExact<C extends string>(rate: Factor, nper: number, pmt: Money<C>, options?: FvOptions<C>): ExactMoney<C>`

The same, unrounded.

### pv

`pv<C extends string>(rate: Factor, nper: number, pmt: Money<C>, options?: PvOptions<C>, rounding?: RoundingInput): Money<C>`

Excel's PV: the present value of `pmt` every period for `nper` periods, plus `fv`: `−(fv + pmt·(1 + rate·type)·((1 + rate)^nper − 1)/rate) / (1 + rate)^nper`, and at a rate of 0, `−(fv + pmt·nper)`.

- **Rounds:** once.
- **Throws:** as `fv`.

### pvExact

`pvExact<C extends string>(rate: Factor, nper: number, pmt: Money<C>, options?: PvOptions<C>): ExactMoney<C>`

The same, unrounded.

### pmt

`pmt<C extends string>(rate: Factor, nper: number, pv: Money<C>, options?: PvOptions<C>, rounding?: RoundingInput): Money<C>`

Excel's PMT: the payment every period that settles `pv` and `fv` in `nper` periods: `−(pv·(1 + rate)^nper + fv)·rate / ((1 + rate·type)·((1 + rate)^nper − 1))`, and at a rate of 0, `−(pv + fv)/nper`. Paying the rounded payment every period leaves a residual; `amortise` and `savingsPlan` build schedules that settle it.

- **Rounds:** once.
- **Throws:** as `fv`, with `nper` from 1.

### pmtExact

`pmtExact<C extends string>(rate: Factor, nper: number, pv: Money<C>, options?: PvOptions<C>): ExactMoney<C>`

The same, unrounded.

### nper

`nper<C extends string>(rate: Factor, pmt: Money<C>, pv: Money<C>, options?: NperOptions<C>): NperResult`

Excel's NPER: `ln((pmt·(1 + rate·type) − fv·rate) / (pmt·(1 + rate·type) + pv·rate)) / ln(1 + rate)`, and at a rate of 0, `−(pv + fv)/pmt`. It can be fractional or negative, as in Excel. The logarithms are irrational in general, so the result is to `digits` places (default 10, at most 100), floored, from rigorous rational bounds on each logarithm: the number of periods lies in [`lower`, `upper`), and `exact` is set when it is rational. Excel's value is a double within its own rounding of that interval.

- **Throws:** `RangeError` where Excel returns #NUM! or #DIV/0! (the payments never settle the amounts, or no payment at a rate of 0), for `digits` outside 0–100, when the result is too close to a `digits`-place decimal to settle within 16,384 bits, and for a rate too close to 0 for `ln(1 + rate)` to be bounded away from 0 within them.

### rate

`rate<C extends string>(nper: number, pmt: Money<C>, pv: Money<C>, options?: RateOptions<C>): IrrResult`

Excel's RATE, as `irr` of the flows it implies: `pv` at period 0, `pmt` at periods 1 to `nper` (0 to `nper − 1` with `type: 1`), and `fv` at period `nper`. Exact to `digits` places, floored, between `lower` and `upper`. A `bracket` replaces Excel's `guess`. Microsoft documents that RATE iterates until it is within 0.0000001, so Excel's value is that close to [`lower`, `upper`].

- **Throws:** `RangeError` where Excel guesses: when the implied flows change sign more than once (several rates fit) unless a `bracket` selects one, and when they never change sign (Excel's #NUM!); for an `nper` that isn't a whole number from 1 to 100,000, `digits` outside 0–100, `(1 + rate)^nper` past 2^19 bits at `digits` places, and a rate above 2^1024. Otherwise as `irr`.

```ts
import { money, ratio } from '@ducatjs/money';
import { fv, nper, pmt, pv, rate } from '@ducatjs/money/finance';

const usd = (amount: string) => money(amount, 'USD');
pmt(ratio('0.08', 12), 10, usd('10000')); // → -1037.03 USD
fv('0.005', 10, usd('-200'), { pv: usd('-500'), type: 1 }); // → 2581.40 USD
pv(ratio('0.08', 12), 240, usd('500')); // → -59777.15 USD
nper('0.01', usd('-100'), usd('-1000'), { fv: usd('10000'), type: 1, digits: 7 }).nper; // → '59.6738656'
rate(48, usd('-200'), usd('8000'), { digits: 8 }).rate; // → '0.00770147'
```

## Proration

### prorate

`prorate<C extends string>(price: Money<C>, options: ProrateOptions, rounding?: RoundingInput): Money<C>`

The part of `price` for the `used` part of a billing `period`: `price × used / period`, counted in days, or with `unit: 'second'` in seconds. Periods are end-exclusive.

- **Rounds:** once.
- **Throws:** `RangeError` when a period doesn't end after it starts, `used` isn't inside `period`, or an instant is invalid (a Unix time needs whole seconds and `unit: 'second'`).

### splitPeriod

`splitPeriod<C extends string>(price: Money<C>, options: SplitPeriodOptions): Money<C>[]`

Splits one period's price at change points (plan changes) in proportion to the days (or seconds) in each piece, through `allocate`, so the pieces always sum exactly to the price.

- **Rounds:** no; leftover minor units go by `remainder` (default `'largest'`).
- **Throws:** `RangeError` when the change points don't increase or don't lie strictly inside the period.

```ts
import { money } from '@ducatjs/money';
import { compound, yearFraction } from '@ducatjs/money/finance';

yearFraction('2026-01-15', '2026-07-15', 'ACT/360'); // → { num: 181n, den: 360n, n: 181, d: 360 }
compound(money('1000', 'EUR'), '0.05', { periods: 12, perYear: 12 }, 'halfEven'); // → 1051.16 EUR
yearFraction('2026-07-15', '2026-01-15', 'ACT/360'); // throws RangeError
```

## Types

- `CalendarDate`: a `'YYYY-MM-DD'` string or `{ year; month; day }` (month 1–12), such as a `Temporal.PlainDate` in the ISO calendar. Proleptic Gregorian, years 0 to 9999, no time and no time zone.
- `DayCount`: `'ACT/360'`, `'ACT/365F'` (actual days over 360 or 365), `'ACT/ACT ISDA'` (days in leap years over 366 plus days in other years over 365), `'30/360'` (Bond Basis, §4.16(f)), `'30E/360'` (Eurobond Basis, §4.16(g)) or `'30E/360 ISDA'` (§4.16(h), which treats the last day of February as the 30th except on the termination date).
- `YearFractionOptions`: `{ maturity?: boolean }`. `'30E/360 ISDA'` only: whether `end` is the termination date. Required when `end` is the last day of February, because the two readings differ by up to two days.
- `InterestPeriod`: `YearFractionOptions` and `{ from: CalendarDate; to: CalendarDate; dayCount: DayCount }` (`to` exclusive).
- `CompoundOptions`: `{ periods: number; perYear: number }`.
- `AmortiseOptions<C>`: `{ rate: Factor; perYear: number; periods: number; method?: AmortisationMethod; rounding?: RoundingInput; balloon?: Money<C>; firstPayment?: CalendarDate; residual?: AmortisationResidual }`. With `perYear` 1, 2, 3, 4, 6 or 12, payments after `firstPayment` follow monthly on its day of the month, clamped to shorter months (not the end-of-month rule: pass an anchor of 31 for month ends); with 26 or 52 they are every 14 or 7 days.
- `AmortisationMethod`: `'annuity'` (French: equal payments, the default), `'linear'` (German: equal principal parts, so payments fall) or `'interestOnly'` (bullet: the principal with the last payment).
- `AmortisationResidual`: `'lastPayment'` (the default, which most lenders use) or `'lastInterest'`, which keeps the last payment equal to the others.
- `Amortisation<C>`: `{ payment: Money<C>; rows: AmortisationRow<C>[]; totalInterest: Money<C> }`. `payment` is the regular payment: for `'annuity'` every payment but possibly the last, for `'linear'` the first (the largest), for `'interestOnly'` the interest payment.
- `AmortisationRow<C>`: `{ period: number; date?: string; payment; interest; principal; balance: Money<C>; days?: number; yearFraction?: Ratio }`. `date` is set when `firstPayment` is given; `days` and `yearFraction` are reserved and not set yet.
- `IrrOptions`: `{ digits?: number; bracket?: readonly [Factor, Factor] }`.
- `IrrResult`: `{ rate: string; lower: string; upper: string }`, decimal strings with `digits` places.
- `PeriodicRateOptions`: `{ perYear: number; digits?: number }`; `perYear` is the periods per year (12 for monthly), `digits` the decimal places of the result (default 10, at most 100; `digits × perYear` at most 50,000).
- `AnnualRateOptions`: `{ perYear: number }`, a positive integer up to 100,000.
- `PeriodicRateResult`: `{ rate: string; lower: string; upper: string; exact?: Ratio }`, as `IrrResult`, with `exact` when the rate is rational.
- `PaymentTiming`: `0 | 1`, Excel's `type`: 0 when payments are at the end of each period (the default), 1 at the start.
- `FvOptions<C>`: `{ pv?: Money<C>; type?: PaymentTiming }`, Excel's optional arguments to FV (`pv` defaults to zero).
- `PvOptions<C>`: `{ fv?: Money<C>; type?: PaymentTiming }`, Excel's optional arguments to PV and PMT (`fv` defaults to zero).
- `NperOptions<C>`: `PvOptions<C>` and `{ digits?: number }` (default 10, at most 100).
- `RateOptions<C>`: `PvOptions<C>` and `{ digits?: number; bracket?: readonly [Factor, Factor] }`, as `IrrOptions`.
- `NperResult`: `{ nper: string; lower: string; upper: string; exact?: Ratio }`, decimal strings with `digits` places: `nper` is `lower`, and `exact` is set when the number of periods is rational.
- `ProrationInstant`: a `CalendarDate` (midnight UTC), or with `unit: 'second'` an ISO date-time in UTC (`'2026-03-11T09:30:00Z'`) or a Unix time in whole seconds.
- `ProrationPeriod`: `{ start: ProrationInstant; end: ProrationInstant }`, `end` exclusive.
- `ProrationUnit`: `'day'` (the default) or `'second'`.
- `ProrateOptions`: `{ period: ProrationPeriod; used: ProrationPeriod; unit?: ProrationUnit }`.
- `SplitPeriodOptions`: `{ period: ProrationPeriod; at: readonly ProrationInstant[]; unit?: ProrationUnit; remainder?: Remainder }`.
