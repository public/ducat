# About rounding

Money code rounds all the time: a VAT line, a third of a bill, a converted price, a cash total. Most money bugs are rounding bugs. Some round in the wrong place, some round twice, and some round silently where the code expected an exact result. ducat's rules on rounding are few, and each answers one of those failures. The modes and the functions that take them are listed in the [reference](../reference/money.md). The tasks are in [How to round to a policy](../how-to/round-to-a-policy.md) and [How to round cash](../how-to/round-cash.md).

## Rounding is never hidden in the representation

A `Money` holds an exact integer of minor units at an explicit scale, so storing a value never rounds it. Rounding happens only in operations that may need it, and each of them says so in its signature. Every operation that may need to round takes a `RoundingMode`. Arithmetic defaults to `'halfExpand'` (ties away from zero, the most common default; see [Decisions](decisions.md)). Pass `'unnecessary'` to throw `RoundingError` instead. Parsing never rounds by default: `money('1.005', 'EUR')` throws.

The modes are the strings `Intl.NumberFormat` uses for its `roundingMode` option, so a value formatted with the same mode it was computed with agrees with itself. `'unnecessary'` is the one mode Intl doesn't have. It turns "I expect this to be exact" into a check, so an assumption that fails raises an error instead of losing a cent.

## Why the default is half away from zero

The default is `'halfExpand'` (ties away from zero) for arithmetic, the most common default. It is the default of decimal.js, Prisma.Decimal, big.js, bignumber.js and `Intl.NumberFormat`, and what currency.js, js-money and ts-money intend with `Math.round` (which differs for negative ties). The minority defaults: half-even (dinero.js 1, bigint-money), throw (monetra), truncate (dinero.js 2 `transformScale`). A library that picks a minority default surprises everyone who moves to it from one of the others, so ducat matches the majority. Banker's rounding is a mode away (`'halfEven'`) where a ledger or a regulator wants it.

Input is treated differently from arithmetic. Parsing (`money('1.005','EUR')`, `fromDecimal`) and processor amounts (`toStripeAmount`, `toAdyen`) still throw unless a mode is passed, as ts-money and monetra do for input. A computed value has to be rounded to be stored. An input with more digits than the currency has is more often a bug upstream than something to round away, so ducat asks. The default is exported as `DEFAULT_ROUNDING`.

## Round once

Rounding twice is not the same as rounding once. 1.0049 rounded half up to three places is 1.005, and that rounded to two is 1.01. Rounded once, straight to two places, it is 1.00. Every rounding operation in ducat therefore computes the exact result first and rounds it once, with a single call to the proved kernel ([What is proved](proofs.md)):

- `multiply` and `divide` round the exact product or quotient once. A factor such as `'1.075'` is an exact rational, so there is no intermediate float to round.
- Conversion rounds once, at the end. Inverses and chains of rates are exact too: nothing is rounded until an amount is converted.
- `average` divides the exact sum by the count and rounds once. Tiered pricing does exact arithmetic and rounds the total once, and its lines are rounded from the running total so they always sum to it.
- In `@ducatjs/money/finance`, every amount that is paid or booked is rounded once from its exact value, with a rounding mode or a policy.
- `Fixed#divide` takes the target scale (`fixed('9.990').divide('1.2', 'halfEven', { scale: 2 })` is 8.32). Passing the scale avoids calling `toScale` afterwards, which would round twice.

For a chain of steps that should round only at the end, `ExactMoney` (`@ducatjs/money/exact`) keeps a rational amount between them. Reports that sum many rows show why it matters. A report that rounds each row's net and then sums them drifts. Summing the exact nets and rounding once doesn't. See [How to add and extract tax](../how-to/add-and-extract-tax.md).

## Rounding policies are explicit values

A policy bundles a scale, an increment and a mode ("CHF cash", "4 decimals, half even") into one value that goes wherever a rounding mode goes. The result is rounded once, straight to the policy, so it never rounds twice through the amount's own scale. That is the reason a policy exists at all: rounding 10.034 CHF to the currency's two decimals and then to the cash step of 0.05 is two roundings, and the policy is one.

Policies are passed explicitly, never stored on amounts or set globally. A policy is passed to each operation that rounds, the way a rounding mode is. A stored or global policy would make the same expression round differently depending on where a value came from or what ran earlier, which is the kind of action at a distance a money library should rule out. The cost is a little repetition at call sites. A [currency context](../how-to/work-in-one-currency.md) binds the plain functions to one currency without any global state, and the same reasoning applies there.

Only policies built by this copy of the package are accepted. A lookalike function, or a policy from a second installed copy of ducat, throws a `TypeError`, just as `isMoney` rejects the other copy's Money. A policy is also a plain function that rounds an amount, so any function would otherwise type-check where a policy goes. Checking the origin keeps a function that merely looks like a policy from bypassing the single-rounding guarantee.

## Which part of a split is rounded

When an operation produces several parts that must add up, only one of them can be rounded; the other is the exact difference. The tax functions apply a policy to the amount they compute: the **gross** for `addTax` (the amount charged), the **net** for `extractTax`, and the **discounted price** for `discount`. The other part is the exact difference, so net + tax is still exactly gross. With a plain rounding mode, `addTax` and `discount` round the tax and the discount amount instead. Allocation follows the same principle at a larger scale: the parts always sum to the whole, and the remainder is distributed deterministically (see [What is proved](proofs.md)).

## Why a scale is never negative

A scale counts decimal places, from 0 to 1000, so `round('floor', -2)` throws. Some libraries allow negative scales to mean tens or hundreds. ducat keeps one meaning for scale, "decimal places of the amount", which is also what the database helpers store, and expresses coarser steps as an increment instead. To round to whole hundreds (Swiss tax rounds taxable income down to 100 CHF, for example), use a policy at scale 0 with `increment: 100`, or `roundToIncrement` from `@ducatjs/money/cash`. The same increment does tens, thousands and cash rounding, so one mechanism covers all of them.

## Cash rounding is a separate rule

Cash rounding is a rule about tenders, not about amounts. Call it **only for cash tenders**: card payments are never rounded in any of these jurisdictions. That is why it is an opt-in module with its own data, sourced per country, and never a property of a currency. For EUR it needs the `country`, because there is no euro-wide rule. A rule follows its source's tie rule: Serbia rounds a 50 para tie down, every other rule rounds ties away from zero. The table, its sources and their verification are in the [cash reference](../reference/cash.md).
