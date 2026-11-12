# How to calculate interest, loan schedules, NPV, IRR and proration

This guide shows you how to compute interest between two dates, build an amortisation schedule, take a net present value or an internal rate of return, and prorate a subscription, all in exact arithmetic with one rounding per amount paid or booked. ducat's own calculations are in `@ducatjs/money/finance`; Excel's financial functions (NPV, IRR, FV, PV, PMT, NPER and RATE), with Excel's arguments and sign convention, are in `@ducatjs/money/excel`.

Write dates as `'YYYY-MM-DD'` strings or `{ year, month, day }` objects (so a `Temporal.PlainDate` works), never `Date`.

```ts
import { money } from '@ducatjs/money';
import { irr, npv } from '@ducatjs/money/excel';
import { amortise, interest, discountedSum, prorate, splitPeriod } from '@ducatjs/money/finance';

const period = { from: '2026-01-15', to: '2026-07-15', dayCount: 'ACT/365F' } as const;
interest(money('10000', 'EUR'), '0.05', period, 'halfEven'); // → 247.95 EUR

const plan = amortise(money('200000', 'EUR'), { rate: '0.045', perYear: 12, periods: 300 });
plan.payment; // → 1111.66 EUR
plan.rows[0]?.interest; // → 750.00 EUR
plan.rows.at(-1)?.balance; // → 0.00 EUR
plan.totalInterest; // → 133500.69 EUR

const flows = ['-1000', '300', '400', '500'].map((amount) => money(amount, 'EUR'));
discountedSum('0.08', flows, 'halfEven'); // → 17.63 EUR
npv('0.08', flows.slice(1), 'halfEven'); // → 1017.63 EUR (Excel's NPV: add the outlay yourself)
irr(flows, { digits: 8 }); // → { rate: '0.08896339', lower: '0.08896339', upper: '0.08896340' }
irr(['-100', '230', '-132'].map((amount) => money(amount, 'EUR'))); // throws RangeError: two IRRs, 10% and 20%

const march = { start: '2026-03-01', end: '2026-04-01' };
prorate(money('30', 'EUR'), { period: march, used: { start: '2026-03-11', end: '2026-04-01' } }); // → 20.32 EUR
splitPeriod(money('30', 'EUR'), { period: march, at: ['2026-03-11', '2026-03-20'] }); // → [9.68 EUR, 8.71 EUR, 11.61 EUR]
```

## Compute interest over a day count

Call `interest(principal, rate, { from, to, dayCount }, rounding)` for simple interest, or `compound` for periodic compounding over a whole number of periods. Choose the day count your contract names: `ACT/360`, `ACT/365F`, `ACT/ACT ISDA`, `30/360` (Bond Basis), `30E/360` or `30E/360 ISDA` (pass `maturity: true` or `false` when the end date is the last day of February). `yearFraction(start, end, convention)` gives the exact fraction alone. It isn't Excel's YEARFRAC, whose bases differ.

## Build a loan schedule

Call `amortise(loan, { rate, perYear, periods })` for an annuity, linear or interest-only schedule. The principal parts sum exactly to the loan and the balance ends at zero, because the rounding residual goes to the last payment. If you want it on the last interest instead, pass `residual: 'lastInterest'`. For a final lump sum or a first payment date, pass `balloon` or `firstPayment`.

## Take NPV and IRR as Excel does

`npv(rate, flows)` is Excel's NPV: the first flow is at the end of period 1, so put an initial outlay at period 0 outside, `flows[0] + npv(rate, rest)`. If your flows start at period 0, use `discountedSum(rate, flows)`. `irr(flows, { digits })` is Excel's IRR, exact to `digits` places (floored). Where Excel guesses, it throws: with no sign change, and with more than one unless you pass a `bracket` (in place of Excel's `guess`) to select one root.

## Prorate a subscription

Charge the used part of a period with `prorate(price, { period, used })` (by the day, or with `unit: 'second'` by the second). To split a period's price at plan changes, use `splitPeriod(price, { period, at })`; the pieces sum exactly to it.

## Solve for a payment, a term or a rate as Excel does

`pmt`, `fv`, `pv`, `nper` and `rate` in `@ducatjs/money/excel` are Excel's PMT, FV, PV, NPER and RATE, with Excel's arguments and sign convention: money you pay out is negative. Pass the rate per period, so 8% a year paid monthly is `ratio('0.08', 12)`:

```ts
import { money, ratio } from '@ducatjs/money';
import { fv, nper, pmt, rate } from '@ducatjs/money/excel';

const usd = (amount: string) => money(amount, 'USD');
pmt(ratio('0.08', 12), 10, usd('10000')); // → -1037.03 USD (the monthly payment on a 10,000 loan)
pmt('0.005', 216, usd('0'), { fv: usd('50000') }); // → -129.08 USD (save 50,000 in 18 years)
fv('0.01', 12, usd('-1000')); // → 12682.50 USD
nper('0.01', usd('-100'), usd('-1000'), { fv: usd('10000'), type: 1, digits: 4 }).nper; // → '59.6738'
rate(48, usd('-200'), usd('8000'), { digits: 6 }).rate; // → '0.007701'
```

`fv`, `pv` and `pmt` are exact and rounded once (`pmtExact` and the others give the exact value). `nper` and `rate` are irrational in general, so ask for the digits you need: they come back floored, with the bracket around the true value. Where Excel picks one of several possible rates by its `guess`, `rate` throws until you pass a `bracket`.

## Plan regular savings

`savingsPlan` builds the schedule a savings calculator shows: the contribution, the interest credited and the balance, every period. Give it a fixed `contribution`, or a `target` to save up to. With a target it solves Excel's PMT, rounds it, and puts the rounding residual on the last contribution, so the plan ends exactly on the target:

```ts
import { money } from '@ducatjs/money';
import { savingsPlan } from '@ducatjs/money/finance';

const usd = (amount: string) => money(amount, 'USD');
const plan = savingsPlan({ rate: '0.05', perYear: 12, periods: 216, target: usd('50000') });
plan.contribution; // → 143.18 USD
plan.balance; // → 50000.00 USD
plan.totalInterest; // → 19071.92 USD

const monthly = savingsPlan({
  rate: '0.06',
  perYear: 12,
  periods: 10,
  contribution: usd('200'),
  initial: usd('500'),
  timing: 'start',
});
monthly.balance; // → 2581.40 USD
```

Each period's interest is rounded once, as a bank credits it, so the final balance can differ by a few cents from Excel's FV, which never rounds. If the product quotes an effective annual rate, convert it with `periodicRate` first.

## Value flows on arbitrary dates

`xnpv` and `xirr` in `@ducatjs/money/excel` are Excel's XNPV and XIRR, for flows that aren't periodic. Pass the values and their dates as Excel does; the first date starts the schedule:

```ts
import { money } from '@ducatjs/money';
import { xirr, xnpv, xnpvBounds } from '@ducatjs/money/excel';

const values = ['-10000', '2750', '4250', '3250', '2750'].map((amount) => money(amount, 'USD'));
const dates = ['2008-01-01', '2008-03-01', '2008-10-30', '2009-02-15', '2009-04-01'];
xnpv('0.09', values, dates); // → 2086.65 USD
xirr(values, dates, { digits: 6 }).rate; // → '0.373362'
xnpvBounds('0.09', values, dates, { digits: 4 }).exact; // → false
```

The discount factors are fractional powers, irrational in general, so `xnpv` brackets the value and rounds it once, when the whole interval rounds to the same amount; `xnpvBounds` gives you the interval itself. If several rates fit (the flows change sign more than once), `xirr` throws until you pass a `bracket`.

## Convert between annual and periodic rates

If a product quotes an effective annual rate and you need the monthly rate that compounds to it (a savings plan, say), use `periodicRate`. The root is irrational in general, so ask for the digits you need; the result is floored and bracketed, as `irr`'s is. `annualRate` goes the other way, exactly:

```ts
import { annualRate, periodicRate } from '@ducatjs/money/finance';

periodicRate('0.05', { perYear: 12, digits: 8 }).rate; // → '0.00407412'
annualRate('0.1', { perYear: 2 }); // → { num: 21n, den: 100n, n: 21, d: 100 }
```

Neither is `rate / perYear`, the nominal split that `compound` and `amortise` use. If your contract states a nominal rate, pass it to those directly.

## Related

- Reference: [`@ducatjs/money/finance`](../reference/finance.md)
- Explanation: [The finance module's design](../explanation/finance-design.md)
