# `@ducatjs/money/finance`

Day counts, interest, loan schedules, NPV, IRR and proration, in exact arithmetic. **Installs:** nothing; every function is a free function.

Related: [How to calculate interest and loans](../how-to/calculate-interest-and-loans.md) · [The finance module's design](../explanation/finance-design.md) · [About rounding](../explanation/rounding.md)

Every amount that is paid or booked is rounded once from its exact value, with a rounding mode (to the currency's exponent) or a rounding policy (to its scale and increment); the default is `'halfExpand'`. Dates are `'YYYY-MM-DD'` strings or `{ year, month, day }` objects (so a `Temporal.PlainDate` works), never `Date`. Functions named after Excel's (NPV, IRR) give Excel's values; others have other names.

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

- **Throws:** `RangeError` where Excel guesses: when the flows never change sign (Excel's #NUM!), and when they change sign more than once unless a `bracket` (in place of Excel's `guess`) selects one root. Also `RangeError` for a bracket that isn't two increasing rates above −1, a bracket whose ends have NPVs of the same sign, and an IRR within 10^−digits of −1.

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
- `ProrationInstant`: a `CalendarDate` (midnight UTC), or with `unit: 'second'` an ISO date-time in UTC (`'2026-03-11T09:30:00Z'`) or a Unix time in whole seconds.
- `ProrationPeriod`: `{ start: ProrationInstant; end: ProrationInstant }`, `end` exclusive.
- `ProrationUnit`: `'day'` (the default) or `'second'`.
- `ProrateOptions`: `{ period: ProrationPeriod; used: ProrationPeriod; unit?: ProrationUnit }`.
- `SplitPeriodOptions`: `{ period: ProrationPeriod; at: readonly ProrationInstant[]; unit?: ProrationUnit; remainder?: Remainder }`.
