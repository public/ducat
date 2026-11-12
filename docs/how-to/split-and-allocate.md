# How to split a bill, allocate by weights and plan instalments

This guide shows you how to divide an amount into parts that always add up to the whole: equal splits, splits by weight, instalments, payment schedules and capped chunks. It also shows how to take an average, a share or a remainder. The functions are in `@ducatjs/money/allocate` and `@ducatjs/money/math`.

## Split evenly or by weights

Import `@ducatjs/money/allocate`, then call `split(n)` or `allocate(weights)`. The parts always sum to the whole, and the remainder goes to the buckets the strategy picks (`'largest'` by default for `allocate`):

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

money('100', 'EUR').allocate([1, 1, 1]); // → [33.34 EUR, 33.33 EUR, 33.33 EUR]
money('100', 'EUR').allocate(['33.3', '66.7']); // → [33.30 EUR, 66.70 EUR]
money('100', 'EUR').allocate([1, 1, 1], { remainder: 'toLast' }); // → [33.33 EUR, 33.33 EUR, 33.34 EUR]
money('-100', 'EUR').split(3); // → [-33.34 EUR, -33.33 EUR, -33.33 EUR]
```

Weights can be integers, bigints or decimal strings. If a bucket should get nothing, give it weight zero. A negative amount is allocated as the mirror image of the positive one. [Where money arithmetic goes wrong](../explanation/footguns.md#allocation-that-loses-or-invents-a-cent) shows how other libraries lose or invent a cent here.

## Plan instalments

Call `instalments(n)`. The first instalment absorbs the remainder by default. If every instalment should be a whole number of some unit, pass `unit`:

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

money('100', 'EUR').instalments(6); // → [16.70 EUR, 16.66 EUR, 16.66 EUR, 16.66 EUR, 16.66 EUR, 16.66 EUR]
money('100', 'EUR').instalments(3, { unit: money('1', 'EUR') }); // → [34.00 EUR, 33.00 EUR, 33.00 EUR]
```

## Build a payment schedule

If the parts are a mix of fixed amounts, capped percentages and the rest, use `schedule`. It throws if the tranches don't cover the total:

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

const tranches = [
  { percent: 30 },
  { amount: money('200', 'EUR') },
  { percent: 50, cap: money('100', 'EUR') },
  { rest: true },
] as const;
money('1000', 'EUR').schedule(tranches); // → [300.00 EUR, 200.00 EUR, 100.00 EUR, 400.00 EUR]
```

## Cap each part

To cut an amount into tranches no larger than a maximum, use `chunk(max)`:

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/allocate';

money('1000', 'EUR').chunk(money('300', 'EUR')); // → [300.00 EUR, 300.00 EUR, 300.00 EUR, 100.00 EUR]
```

## Take an average, a share or a remainder

`@ducatjs/money/math` has `average` (divides the exact sum by the count and rounds once), `ratioOf` (the exact share, as a `Ratio` that `multiply` and `allocate` accept), `divideToIntegral` and `remainder` (so `m = divisor × count + remainder` exactly), and `trimScale`:

```ts
import { money } from '@ducatjs/money';
import { average } from '@ducatjs/money/math';

average([money('10', 'EUR'), money('10', 'EUR'), money('10.01', 'EUR')]); // → 10.00 EUR
money('25', 'EUR').ratioOf(money('100', 'EUR')); // → { num: 1n, den: 4n, n: 1, d: 4 }
money('9.99', 'EUR').divideToIntegral(money('2.50', 'EUR')); // → 3
money('9.99', 'EUR').remainder(money('2.50', 'EUR')); // → 2.49 EUR
money('1.2300', 'EUR', { scale: 4 }).trimScale(); // → 1.23 EUR
```

## Related

- Reference: [`@ducatjs/money/allocate`](../reference/allocate.md) (every remainder strategy), [`@ducatjs/money/math`](../reference/math.md)
- Explanation: [What is proved](../explanation/proofs.md) (allocation, instalments, chunks and schedules)
