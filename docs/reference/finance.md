# `@ducatjs/money/finance`

Day counts, interest, periodic and annual rates, loan and savings schedules, discounted sums and proration, in exact arithmetic, under ducat's own names. Excel's financial functions are in [`@ducatjs/money/excel`](excel.md). **Installs:** nothing; every function is a free function.

Related: [How to calculate interest and loans](../how-to/calculate-interest-and-loans.md) · [The finance module's design](../explanation/finance-design.md) · [About rounding](../explanation/rounding.md)

Every amount that is paid or booked is rounded once from its exact value, with a rounding mode (to the currency's exponent) or a rounding policy (to its scale and increment); the default is `'halfExpand'`. Dates are `'YYYY-MM-DD'` strings or `{ year, month, day }` objects (so a `Temporal.PlainDate` works), never `Date`. None of these is an Excel name: Excel's NPV, IRR, FV, PV, PMT, NPER and RATE, with Excel's semantics, are in [`@ducatjs/money/excel`](excel.md).

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

### savingsPlan

`savingsPlan<C extends string>(options: SavingsPlanOptions<C>): SavingsPlan<C>`

A savings schedule: a `contribution` every period, or the contribution that reaches a `target`, earning `rate / perYear` per period. Each period's interest is the balance it earns on (the balance before the period, plus the contribution when it is paid at the start) times the periodic rate, rounded once, as a bank credits it. Nothing else is rounded, so the final balance is exactly `initial + totalContributions + totalInterest`. With a `target`, the regular contribution is Excel's PMT for it, rounded, and the last contribution takes the residual, so the plan ends exactly on the target, as `amortise` settles a loan on its last payment. With `timing: 'start'`, the last contribution `c` is solved so that the balance plus `c` plus the rounded interest on both is the target, so interest is only ever credited on what was paid in; where the rounding skips the target, the unit left over is an `adjustment` on the last row, paid at the end of the period, after interest. At a rate of 0 the regular contribution is `(target − initial) / periods`, rounded. Rates down to −perYear (excluded), negative contributions (withdrawals) and targets below what `initial` grows to are allowed. It isn't an Excel name; its amounts are positive when paid in.

- **Rounds:** every interest credit, and a target's regular contribution, once each, with `options.rounding`.
- **Throws:** `RangeError` when both or neither of `contribution` and `target` are given, for a `periods` count that isn't a whole number from 1 to 100,000, a `perYear` that isn't a positive integer, a rate that loses everything in one period, a `timing` other than `'end'` or `'start'`, or amounts that aren't multiples of the rounding's unit; `CurrencyMismatchError` for amounts in different currencies.

```ts
import { money } from '@ducatjs/money';
import { savingsPlan } from '@ducatjs/money/finance';

const plan = savingsPlan({
  rate: '0.05',
  perYear: 12,
  periods: 216,
  target: money('50000', 'USD'),
});
plan.contribution; // → 143.18 USD
plan.rows.at(-1)?.contribution; // → 144.38 USD
plan.balance; // → 50000.00 USD
```

## Discounted sums and rates

### discountedSum

`discountedSum<C extends string>(rate: Factor, flows: readonly Money<C>[], rounding?: RoundingInput): Money<C>`

The discounted sum of flows at periods 0, 1, 2…, `Σ flowₜ / (1 + rate)ᵗ`: the textbook NPV, with the first flow not discounted. It is `flows[0] + npv(rate, flows.slice(1))` with `/excel`'s `npv`. (Not Excel's PV, which is an annuity's present value.)

- **Rounds:** once.
- **Throws:** `RangeError` for no flows, or a rate not above −1.

### discountedSumExact

`discountedSumExact<C extends string>(rate: Factor, flows: readonly Money<C>[]): ExactMoney<C>`

The same, unrounded.

### periodicRate

`periodicRate(annual: Factor, options: PeriodicRateOptions): PeriodicRateResult`

The periodic rate equivalent to an effective annual rate, `(1 + annual)^(1/perYear) − 1` (the monthly rate of a savings plan). The root is irrational in general, so, as `/excel`'s `irr` does, it is found to `digits` places (default 10, at most 100), floored, by exact bisection: `(1 + lower)^perYear ≤ 1 + annual < (1 + upper)^perYear`, with `upper = lower + 10^−digits` and `rate` equal to `lower`. `exact` is set when the root is rational (the reduced numerator and denominator of `1 + annual` are both perfect `perYear`th powers): `'0.21'` with `perYear: 2` gives 1/10, and `periodicRate(annualRate(p)).exact` is `p`. It isn't `rate / perYear`, the nominal split that `compound` and `amortise` use, and it isn't an Excel name (Excel's RRI and EFFECT compute the same values from other arguments).

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

## Deprecated re-exports

`npv`, `npvExact` and `irr`, and the types `IrrOptions` and `IrrResult`, moved to [`@ducatjs/money/excel`](excel.md) in 0.4. `/finance` still re-exports them in 0.4, marked `@deprecated`, so imports from 0.3 keep working; they are removed in 0.5. Import them from `@ducatjs/money/excel`.

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
- `ContributionTiming`: `'end'` (the default, Excel's `type` 0) or `'start'` (`type` 1).
- `SavingsPlanOptions<C>`: `{ rate: Factor; perYear: number; periods: number; contribution?: Money<C>; target?: Money<C>; initial?: Money<C>; timing?: ContributionTiming; rounding?: RoundingInput; firstContribution?: CalendarDate }`, with exactly one of `contribution` and `target`. The contribution dates follow `firstContribution` as `amortise`'s follow `firstPayment`.
- `SavingsPlan<C>`: `{ contribution: Money<C>; rows: SavingsPlanRow<C>[]; totalContributions: Money<C>; totalInterest: Money<C>; balance: Money<C> }`. `contribution` is the regular one (with a `target`, every one but possibly the last).
- `SavingsPlanRow<C>`: `{ period: number; date?: string; contribution; interest; adjustment?; balance: Money<C> }`. `date` is set when `firstContribution` is given. `interest` is always on the previous balance, plus this row's `contribution` when it is paid at the start. `adjustment` is set only on the last row of a start-timed target plan whose target the rounding skipped: one unit, paid after interest, counted in `totalContributions`.
- `PeriodicRateOptions`: `{ perYear: number; digits?: number }`; `perYear` is the periods per year (12 for monthly), `digits` the decimal places of the result (default 10, at most 100; `digits × perYear` at most 50,000).
- `AnnualRateOptions`: `{ perYear: number }`, a positive integer up to 100,000.
- `PeriodicRateResult`: `{ rate: string; lower: string; upper: string; exact?: Ratio }`, as `IrrResult`, with `exact` when the rate is rational.
- `ProrationInstant`: a `CalendarDate` (midnight UTC), or with `unit: 'second'` an ISO date-time in UTC (`'2026-03-11T09:30:00Z'`) or a Unix time in whole seconds.
- `ProrationPeriod`: `{ start: ProrationInstant; end: ProrationInstant }`, `end` exclusive.
- `ProrationUnit`: `'day'` (the default) or `'second'`.
- `ProrateOptions`: `{ period: ProrationPeriod; used: ProrationPeriod; unit?: ProrationUnit }`.
- `SplitPeriodOptions`: `{ period: ProrationPeriod; at: readonly ProrationInstant[]; unit?: ProrationUnit; remainder?: Remainder }`.
