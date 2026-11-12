# `@ducatjs/money/excel`

Excel's financial functions, NPV, IRR, FV, PV, PMT, NPER and RATE, with Excel's arguments and sign convention, in exact arithmetic. **Installs:** nothing; every function is a free function.

Related: [How to calculate interest and loans](../how-to/calculate-interest-and-loans.md) · [The finance module's design](../explanation/finance-design.md) · [`@ducatjs/money/finance`](finance.md), ducat's own calculations

These functions are named after Excel's, so they follow the Excel rule: Excel's arguments, sign convention (money paid out is negative, money received positive) and `type` (0 = payments at the end of each period, the default; 1 = at the start). Excel's required arguments are positional in Excel's order; the optional ones go in an options object, and the rounding comes last. Amounts are `Money` of one currency, and a rate is a `Factor` (`ratio('0.08', 12)` for 8% a year paid monthly). Where Excel's own evaluation in doubles is well conditioned, each matches Excel's value at its 15 significant digits. Where it isn't (RATE for a tiny rate over many periods, say, where Excel's iteration or its doubles lose digits), these return the exact value, or the exact root to the digits asked for, and that is the correct answer, not Excel's. Every amount is rounded once from its exact value, with a rounding mode or a rounding policy; the default is `'halfExpand'`.

**Interface differences from Excel.** Each is a refusal, never another value, except where Excel's doubles are ill-conditioned (above):

- `nper` must be a whole number for `fv`, `pv`, `pmt` and `rate` (Excel takes fractions, whose powers are irrational).
- A rate at or below −1 throws, and `type` is 0 or 1.
- `irr` and `rate` take a `bracket` in place of Excel's `guess`, and throw where the flows can have several rates and no bracket selects one: Excel returns whichever its iteration from `guess` reaches. They throw where the flows never change sign (Excel's #NUM!).
- `nper` and `rate` return their result to `digits` places, floored, with the bracket around it, rather than a double.
- Powers past a size limit throw rather than take minutes (see each function).

All functions throw `CurrencyMismatchError` for amounts in more than one currency.

## Present value and IRR

### npv

`npv<C extends string>(rate: Factor, flows: readonly Money<C>[], rounding?: RoundingInput): Money<C>`

Excel's NPV: `Σ flowᵢ / (1 + rate)ⁱ` for i = 1, 2…, so the first flow is at the end of period 1. Like Excel, an initial outlay at period 0 goes outside: `flows[0] + npv(rate, rest)`, or use `discountedSum`.

- **Rounds:** once, so it matches Excel to the cent.
- **Throws:** `RangeError` for no flows, or a rate not above −1.

### npvExact

`npvExact<C extends string>(rate: Factor, flows: readonly Money<C>[]): ExactMoney<C>`

Excel's NPV, unrounded.

### irr

`irr(flows: readonly Money<string>[], options?: IrrOptions): IrrResult`

Excel's IRR: the rate at which the NPV of flows at periods 0, 1, 2… is zero, exact to `digits` places (default 10), floored. `rate` is `lower`, and the IRR lies between `lower` and `upper`, 10^−digits apart. It bisects in exact integer arithmetic on the grid of `digits`-place decimals: no floats and no Newton steps.

- **Throws:** `RangeError` where Excel guesses: when the flows never change sign (Excel's #NUM!), and when they change sign more than once unless a `bracket` (in place of Excel's `guess`) selects one root. Also `RangeError` for a bracket that isn't two increasing rates above −1, a bracket whose ends have NPVs of the same sign, an IRR within 10^−digits of −1, and an IRR above 2^1024 (the search for a positive root doubles at most 1,024 times).

```ts
import { money } from '@ducatjs/money';
import { irr, npv } from '@ducatjs/money/excel';

const flows = ['-1000', '300', '400', '500'].map((amount) => money(amount, 'EUR'));
npv('0.08', flows.slice(1), 'halfEven'); // → 1017.63 EUR (Excel's NPV: add the outlay yourself)
irr(flows, { digits: 8 }); // → { rate: '0.08896339', lower: '0.08896339', upper: '0.08896340' }
```

## Annuities: FV, PV, PMT, NPER and RATE

### fv

`fv<C extends string>(rate: Factor, nper: number, pmt: Money<C>, options?: FvOptions<C>, rounding?: RoundingInput): Money<C>`

Excel's FV: the future value of `pmt` every period for `nper` periods, on top of `pv`: `−(pv·(1 + rate)^nper + pmt·(1 + rate·type)·((1 + rate)^nper − 1)/rate)`, and at a rate of 0, `−(pv + pmt·nper)`. Exact, then rounded once.

- **Rounds:** once; it is `fvExact(…).round(rounding)`.
- **Throws:** `RangeError` for an `nper` that isn't a whole number from 0 to 100,000, a rate at or below −1, a `type` other than 0 or 1, or when `(1 + rate)^nper` would pass 2^20 bits (2^16 for the `…Exact` forms, which reduce their fraction).

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

Excel's RATE, as `irr` of the flows it implies: `pv` at period 0, `pmt` at periods 1 to `nper` (0 to `nper − 1` with `type: 1`), and `fv` at period `nper`. Exact to `digits` places, floored, between `lower` and `upper`. A `bracket` replaces Excel's `guess`. Microsoft documents that RATE iterates until it is within 0.0000001, so Excel's value is that close to [`lower`, `upper`]; where RATE is ill-conditioned, ducat's bracket is the correct root and Excel's double may be further off.

- **Throws:** `RangeError` where Excel guesses: when the implied flows change sign more than once (several rates fit) unless a `bracket` selects one, and when they never change sign (Excel's #NUM!); for an `nper` that isn't a whole number from 1 to 100,000, `digits` outside 0–100, `(1 + rate)^nper` past 2^19 bits at any rate the bisection tries, and a rate above 2^1024. Otherwise as `irr`.

```ts
import { money, ratio } from '@ducatjs/money';
import { fv, nper, pmt, pv, rate } from '@ducatjs/money/excel';

const usd = (amount: string) => money(amount, 'USD');
pmt(ratio('0.08', 12), 10, usd('10000')); // → -1037.03 USD
fv('0.005', 10, usd('-200'), { pv: usd('-500'), type: 1 }); // → 2581.40 USD
pv(ratio('0.08', 12), 240, usd('500')); // → -59777.15 USD
nper('0.01', usd('-100'), usd('-1000'), { fv: usd('10000'), type: 1, digits: 7 }).nper; // → '59.6738656'
rate(48, usd('-200'), usd('8000'), { digits: 8 }).rate; // → '0.00770147'
```

## Types

- `IrrOptions`: `{ digits?: number; bracket?: readonly [Factor, Factor] }`.
- `IrrResult`: `{ rate: string; lower: string; upper: string }`, decimal strings with `digits` places.
- `PaymentTiming`: `0 | 1`, Excel's `type`: 0 when payments are at the end of each period (the default), 1 at the start.
- `FvOptions<C>`: `{ pv?: Money<C>; type?: PaymentTiming }`, Excel's optional arguments to FV (`pv` defaults to zero).
- `PvOptions<C>`: `{ fv?: Money<C>; type?: PaymentTiming }`, Excel's optional arguments to PV and PMT (`fv` defaults to zero).
- `NperOptions<C>`: `PvOptions<C>` and `{ digits?: number }` (default 10, at most 100).
- `RateOptions<C>`: `PvOptions<C>` and `{ digits?: number; bracket?: readonly [Factor, Factor] }`, as `IrrOptions`.
- `NperResult`: `{ nper: string; lower: string; upper: string; exact?: Ratio }`, decimal strings with `digits` places: `nper` is `lower`, and `exact` is set when the number of periods is rational.
