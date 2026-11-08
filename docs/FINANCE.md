# `@ducatjs/money/finance`: design

Status: approved design (#54), implemented in v0.3.0 (#135). XNPV and XIRR are planned for v0.4.0 (#136).

Billing and lending code keeps re-implementing the same few calculations, usually in floats: loan
and amortisation schedules, interest between two dates under a day-count convention, net present
value and internal rate of return, and subscription proration. This module gives them ducat's
guarantees: exact arithmetic, one rounding per amount that is actually paid or booked, and totals
that reconcile to the cent.

## Principles

- **Exact, no floats anywhere.** Rates, year fractions, discount factors and payments are exact
  rationals (`ExactMoney` and `Ratio` from `@ducatjs/money/exact`). A rate is a `Factor`: a decimal
  string (`'0.0525'`), an integer or a `ratio()`, never a JS float. Anything whose exact value is
  irrational (continuous compounding, fractional powers) is either out of scope or computed to a
  precision the caller states, with a guaranteed bound (see IRR).
- **Round once per paid amount.** Each payment, interest charge or prorated charge is rounded once,
  from its exact value, with a rounding mode or a rounding policy (`@ducatjs/money/policy`),
  wherever ducat already accepts one. Intermediate quantities are never rounded.
- **Totals reconcile.** A schedule's principal parts sum exactly to the loan, its final balance is
  exactly zero, and the pieces of a split billing period sum exactly to the period's price. The
  residual from rounding goes to one stated place (the last payment, by default), never into the
  void.
- **Calendar dates, not instants.** Dates are `'YYYY-MM-DD'` strings or `{ year, month, day }`
  objects. A `Temporal.PlainDate` works as is, because it has those three fields; a test checks
  that wherever the runtime has Temporal. No `Date`: an instant plus a time zone is how
  off-by-one-day interest bugs happen. Day arithmetic is proleptic Gregorian, done in integers.
- **Opt-in, free functions.** One entry point, `@ducatjs/money/finance`, with functions only (no
  `Money` methods). Every function takes an options object, which suits functions rather than
  methods. Nothing global, nothing network. Size: about +5 kB gzipped over the core
  (the module, `allocate` and `ExactMoney`).

## Scope

### 1. Day counts and interest

```ts
yearFraction('2026-01-15', '2026-07-15', 'ACT/360'); // ratio(181, 360)
interest(
  money('10000', 'EUR'),
  '0.05',
  {
    from: '2026-01-15',
    to: '2026-07-15',
    dayCount: 'ACT/365F',
  },
  'halfEven',
); // 247.95 EUR
```

- `yearFraction(start, end, convention, options?)` returns an exact `Ratio`.
- Conventions in the first version, with the definitions of the 2006 ISDA Definitions §4.16:
  - `ACT/360`, `ACT/365F` (Fixed);
  - `ACT/ACT ISDA` (days in leap and non-leap years apportioned separately);
  - `30/360` (Bond Basis, §4.16(f)), `30E/360` (Eurobond, §4.16(g)) and `30E/360 ISDA`
    (§4.16(h)), which keeps the last day of February only on the termination date: when the end
    date is the last day of February the caller must say whether it is with `maturity: true` or
    `false`, and it throws without the option, since the two readings differ by up to two days.
- Later, not in the first version: `ACT/ACT ICMA` (needs the coupon schedule and frequency),
  `ACT/365L`, `BUS/252` (needs a holiday calendar). There are no business-day calendars or
  holiday adjustments in this module. A caller with adjusted dates passes them in.
- `interest(principal, rate, { from, to, dayCount }, rounding)` is simple interest,
  `principal × rate × yearFraction`, rounded once. `interestExact` returns the `ExactMoney`.
- `compound(principal, rate, { periods, perYear }, rounding)` is periodic compounding,
  `principal × (1 + rate/perYear)^periods`, for an integer `periods`. An integer power of a
  rational is exact (`(241/240)^360`, 30 years monthly at 5%, is about 3,000 bits). There is no
  continuous compounding and no fractional exponent, since both are irrational. A stub period uses
  simple interest for its fraction, the usual market convention.

### 2. Loan and amortisation schedules

```ts
const plan = amortise(money('200000', 'EUR'), {
  rate: '0.045',
  perYear: 12,
  periods: 300, // 4.5% nominal, monthly, 25 years
  method: 'annuity', // or 'linear', 'interestOnly'
  rounding: 'halfEven', // or a policy
});
plan.payment; // 1111.66 EUR
plan.rows[0]; // { period: 1, payment, interest: 750.00, principal: 361.66, balance: 199638.34 }
plan.totalInterest; // exact sum of the interest column
```

- Methods:
  - `annuity` (French): equal payments, `P·r / (1 − (1 + r)^−n)` with `r` the periodic rate,
    computed exactly and rounded once;
  - `linear` (German): equal principal parts, using `instalments` from `/allocate`, so the parts
    already sum exactly;
  - `interestOnly` / bullet: interest each period, principal at the end.
  - Options: `balloon` (an amount left at the end), `firstPayment` (a date, which with
    `perYear` gives the payment dates; months roll at month end, so 31 January + 1 month is
    28 February, then 31 March).
- Each period's interest is `round(balance × r)` from the exact balance, which is a rounded
  amount, because that is what lenders book. The principal part is `payment − interest`.
- **Residual:** the last payment absorbs whatever rounding left over, so the final balance is
  exactly zero and the principal column sums exactly to the loan. `residual: 'lastPayment'` is
  the default; `'lastInterest'` is the alternative some lenders use.
- **Early payoff:** when rounded payments would clear a small loan before its last period, the
  schedule ends with the payment that clears it, so the balance never goes negative.
- Invariants, as property tests (fast-check) and, where the existing allocation proofs make it
  cheap, in Lean:
  - principal parts sum to the loan;
  - the balance never goes negative and ends at 0;
  - every payment except the last is equal (annuity);
  - every amount is at the currency's scale or the policy's;
  - zero rate gives `instalments(loan, n, { remainder: 'toLast' })`, the residual on the last
    payment.
- Per-period interest from a day count (`interestBasis: 'ACT/365F'` with payment dates, as UK
  mortgages and some consumer loans compute it) is the natural second step. It is in the design so
  the row type has room for it (`days`, `yearFraction`), but it's a design fork (below).

### 3. NPV and IRR

```ts
presentValue(
  '0.08',
  [money('-1000', 'EUR'), money('300', 'EUR'), money('400', 'EUR'), money('500', 'EUR')],
  'halfEven',
);
// 17.63 EUR: Σ CFₜ / (1 + r)ᵗ from t = 0, exact, rounded once
npv(
  '0.08',
  [money('-1000', 'EUR'), money('300', 'EUR'), money('400', 'EUR'), money('500', 'EUR')],
  'halfEven',
);
// 16.32 EUR: Excel's NPV, the first flow at the end of period 1
irr([money('-1000', 'EUR'), money('300', 'EUR'), money('400', 'EUR'), money('500', 'EUR')], {
  digits: 8,
});
// { rate: '0.08896339', lower: '0.08896339', upper: '0.08896340' }
```

- `npv(rate, flows, rounding)` is Excel's NPV: flows at the ends of periods 1, 2…, so the first
  is discounted once, exact and rounded once (it matches Excel to the cent). Like Excel, an
  initial outlay at period 0 goes outside: `flows[0] + npv(rate, rest)`. `npvExact` returns the
  `ExactMoney`.
- `presentValue(rate, flows, rounding)` and `presentValueExact` are the textbook form, flows at
  periods 0, 1, 2…, with the first undiscounted.
- `irr` is Excel's IRR (its first value is at period 0, the same root as `presentValue`). The
  rate is exact to `digits` places, floored. Where Excel guesses, it throws instead: no sign
  change (Excel's #NUM!), several sign changes without a `bracket` (which replaces Excel's
  `guess`; Excel returns whichever root its Newton iteration finds), and an IRR within
  10^−digits of −1. A bracket's NPV signs are taken at the exact rates given, and the IRR
  returned is inside it.
- `irr(flows, { digits, bracket? })`: the IRR is a polynomial root, irrational in general, so it
  is computed to `digits` decimal places by bisection in exact rational arithmetic, with no floats
  and no Newton steps that can diverge. The result guarantees that NPV changes sign between `lower`
  and `upper`, which are 10^−digits apart, and `rate` is `lower` (truncated, never rounded up past
  the root).
  - It throws when the flows have no sign change (no IRR).
  - Flows with more than one sign change can have several IRRs (Descartes), so they throw unless a
    `bracket` with a sign change is given: picking one silently is the classic IRR bug.
  - Each midpoint is kept to a decimal, not the exact midpoint, so the bigints stay bounded: the
    interval still halves and its ends stay decimals. The implementation bisects on the grid of
    `digits`-place decimals itself (the integer midpoint of two grid points), which needs no guard
    digits: the bracket ends exactly 10^−digits apart, with no rounding step at the end.
  - Only the NPV's sign is needed at each step, and for a rate of `m / 10^digits` that is the sign
    of `Σ flowₜ · 10^(digits·t) · (10^digits + m)^(n−t)`, an integer computed by Horner's rule:
    nothing is divided.
  - Cost: about `digits × 3.3` steps, each an exact NPV by Horner's rule. Worst case documented:
    360 monthly periods at the default `digits: 10` takes 34 steps on integers of about 17,000
    bits (2 kB). An unoptimised exact-fraction prototype of the same arithmetic took 1.3 s in
    total; the implementation must beat that by a wide margin, and the benchmark tracks it.
- `XNPV` and `XIRR` (flows on arbitrary dates) are **not** in the first version: their discount
  factors `(1 + r)^(days/365)` are fractional powers, so even XNPV isn't exact. They are planned
  for v0.4.0, as results to a stated precision with a proven error bound.

### 4. Subscription proration

```ts
prorate(
  money('30', 'EUR'),
  {
    period: { start: '2026-03-01', end: '2026-04-01' }, // the billing period, end exclusive
    used: { start: '2026-03-11', end: '2026-04-01' }, // the part being charged or credited
  },
  'halfEven',
); // 20.32 EUR (21 of 31 days)

splitPeriod(money('30', 'EUR'), {
  period: { start: '2026-03-01', end: '2026-04-01' },
  at: ['2026-03-11', '2026-03-20'], // plan changes
}); // [9.68, 8.71, 11.61]: sums to exactly 30.00
```

- `prorate(price, { period, used, unit }, rounding)` is `price × days(used) / days(period)`, exact,
  rounded once. `unit: 'day'` is the default; `unit: 'second'` takes ISO date-times in UTC for
  processors that prorate by the second (Stripe does).
- `splitPeriod(price, { period, at })` splits one period's price at the change points, through
  `allocate` with day weights, so the pieces always sum exactly to the price. A plan change is then
  "credit `prorate(old, unused)`, charge `prorate(new, remaining)`", and both are exact and rounded
  once each.
- Calendar-month subtleties (a 31-day and a 28-day month at the same price) are the caller's
  choice of `period`. The module does no month normalisation.

## Testing

- Published examples as fixtures:
  - day-count fractions from the ISDA 2006 definitions' worked examples and OpenGamma Strata's
    day-count tests;
  - annuity payments and schedules checked against the CFPB amortisation examples and against
    spreadsheet `PMT`/`IPMT`/`PPMT` values where these agree to the cent;
  - `npv` and `irr` checked against Microsoft's documented NPV and IRR examples, and against a
    few hundred LibreOffice Calc results (`scripts/gen-calc-vectors.py`): NPV at 15 significant
    digits or within Calc's double rounding, IRR within Excel's stated 0.00001 percent.
- Property tests for every invariant above, with an exact oracle (Python `fractions`, like the
  existing `pydecimal` vectors) for the schedules.
- Lean, when it pays: the schedule's reconciliation (principal sums to the loan, the balance ends
  at zero) fits the existing instalment proofs.

## Decisions

The review took the recommendation on every fork:

1. **Dates:** strings and `{ year, month, day }` only (so `Temporal.PlainDate` too); no `Date`.
2. **IRR:** exact bisection to a stated number of digits, on the grid of `digits`-place
   decimals (no guard digits are needed), with a guaranteed bracket.
3. **XNPV and XIRR:** not in the first version; v0.4.0, with a proven error bound.
4. **Schedule residual:** the last payment by default, `'lastInterest'` as an option.
5. **Day-count interest inside schedules** (`interestBasis`): the second version; the row type
   reserves the fields.
6. **Methods on Money:** none.
7. **Excel names mean Excel's semantics** (v0.3.0). A function named after an Excel function
   gives Excel's value, compared at Excel's 15 significant digits, since this module is exact
   where Excel uses doubles; it may throw where Excel guesses (`irr`), but never returns a
   different value. Anything with other semantics gets another name. So `npv` is Excel's NPV,
   the first flow at the end of period 1, and the period-0 form the design first had is
   `presentValue`. The tests check both against Microsoft's documented examples and against
   LibreOffice Calc. `yearFraction`, `amortise`, `interest` and `prorate` aren't Excel names
   and follow ISDA and lender practice; `yearFraction` is not YEARFRAC, and a schedule's
   payments are positive and its interest is rounded every period, unlike PMT, IPMT and PPMT.
   No other Excel-named function (YEARFRAC, PMT, DAYS360…) is added without matching Excel
   exactly.

## Design forks (as reviewed)

1. **Dates.** I recommend strings and `{ year, month, day }` only. The alternative also accepts
   `Date` as a UTC calendar day, which is convenient but invites time-zone bugs.
2. **IRR.** I recommend exact bisection to a stated number of digits, with a guaranteed bracket.
   The alternatives are leaving IRR out (it isn't exact), or Newton in floats (fast, but against
   the no-floats rule).
3. **XNPV and XIRR.** I recommend leaving them out of the first version. If they're wanted, the
   only exact-in-spirit option is bounded evaluation: XNPV to a stated number of digits with
   rational bounds on each fractional power. That is doable but about as much work as the rest of
   the module together.
4. **Schedule residual.** I recommend the last payment by default (what most lenders do), with
   `'lastInterest'` as an option. The alternative spreads it, which no lender does.
5. **Day-count interest inside schedules** (`interestBasis`). I recommend the second version,
   after periodic schedules ship. The row type reserves the fields.
6. **Methods on Money.** I recommend none. The alternative is `money.interest(...)` and similar
   through `extendMoney`, but options-heavy functions read badly as methods.
