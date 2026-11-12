# How to round to a policy, and round once at the end

This guide shows you how to round amounts to a fixed scale, increment and mode ("4 decimals, half even", "CHF cash", "down to whole hundreds"), how to check an amount is already rounded before it is booked, and how to keep a chain of calculations exact so it rounds only once.

## Build a policy and pass it where a mode goes

Build a policy with `roundingPolicy({ scale?, increment?, rounding?, currency? })` from `@ducatjs/money/policy`, or use `isoPolicy` (the currency's exponent, half up) or `cashPolicy(currency)` from `@ducatjs/money/cash`. Pass it wherever a rounding mode goes: `multiply`, `divide`, `round`, `percentage`, `discount`, `addTax`, `extractTax`. The result is rounded once, straight to the policy. A policy is also a function, so `amounts.map(policy)` and `m.with(policy)` work.

```ts
import { money } from '@ducatjs/money';
import { assertScale, isoPolicy, roundingPolicy } from '@ducatjs/money/policy';
import { cashPolicy } from '@ducatjs/money/cash';

money('10.00', 'CHF').multiply('1.077', cashPolicy('CHF')); // → 10.75 CHF
const unitPrice = roundingPolicy({ scale: 4, rounding: 'halfEven' });
money('10.00', 'EUR').divide(3, unitPrice); // → 3.3333 EUR
[money('1.234', 'EUR', { scale: 3 })].map(isoPolicy); // → [1.23 EUR]
assertScale(money('1.234', 'EUR', { scale: 3 }), isoPolicy); // throws RangeError
```

If the policy is for one currency only, pass `currency`: it then refuses amounts in other currencies.

Pass policies explicitly every time; they are never stored on amounts or set globally. Use the policies of the copy of ducat you call: a policy from a second installed copy throws a `TypeError`.

## Check an amount before you book it

Call `assertScale(m, policy)`, as in the last line above. It throws a `RangeError` unless `m` is already at the policy's scale and on its increment.

## Round to tens, hundreds or thousands

A scale is never negative (it counts decimal places, from 0 to 1000), so `round('floor', -2)` throws. To round to whole hundreds (Swiss tax rounds taxable income down to 100 CHF, for example), use an increment: a policy at scale 0 with `increment: 100`, or `roundToIncrement` from `@ducatjs/money/cash`. The same increment does tens, thousands and cash rounding.

```ts
import { money } from '@ducatjs/money';
import { roundingPolicy } from '@ducatjs/money/policy';
import { roundToIncrement } from '@ducatjs/money/cash';

const downToHundreds = roundingPolicy({ scale: 0, increment: 100, rounding: 'floor' });
money('12345.60', 'CHF').round(downToHundreds); // → 12300 CHF
roundToIncrement(money('12345.60', 'CHF'), money('100', 'CHF'), 'floor'); // → 12300.00 CHF
money('12345.60', 'CHF').round('floor', -2); // throws RangeError
```

## Keep intermediate values exact and round once

Rounding at every step adds up the errors: 99.99 ÷ 119 × 100 is 84.00 on `Money`, rounded at each step, and 84.03 rounded once ([Where money arithmetic goes wrong](../explanation/footguns.md#rounding-at-every-step-and-a-default-you-didnt-choose)). If a calculation has several steps, keep the intermediate amount as `ExactMoney` (`@ducatjs/money/exact`), a rational amount, and round only at the end. It has the helpers Money has (`abs`, `isPositive`, `isNegative`, `isZero`, the comparisons, `min`, `max`, `clamp`, `percentage` and `ratioOf`), `add`, `subtract`, the comparisons, `min`, `max` and `clamp` take a Money of the same currency as well, and `round` takes a policy:

```ts
import { money } from '@ducatjs/money';
import { cashPolicy } from '@ducatjs/money/cash';
import { exact } from '@ducatjs/money/exact';

const share = exact(money('10.03', 'CHF')).divide(3); // → 1003/300 CHF
share.add(money('0.50', 'CHF')).max(money('3.50', 'CHF')); // → 1153/300 CHF
share.lessThan(money('3.35', 'CHF')); // → true
share.round(cashPolicy('CHF')); // → 3.35 CHF
```

## Related

- Reference: [`@ducatjs/money/policy`](../reference/policy.md), [`@ducatjs/money/exact`](../reference/exact.md), [rounding modes](../reference/money.md)
- Explanation: [About rounding](../explanation/rounding.md), [Decisions](../explanation/decisions.md)
