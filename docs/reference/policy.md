# `@ducatjs/money/policy`

Rounding policies: a scale, an increment and a mode as one value. **Installs:** nothing.

Related: [How to round to a policy](../how-to/round-to-a-policy.md) · [`cashPolicy`](cash.md) · [About rounding](../explanation/rounding.md)

A policy goes wherever a rounding mode goes (every parameter typed `RoundingInput`): `multiply`, `divide`, `round`, `percentage`, `discount`, `addTax`, `extractTax`, `average`, `ExactMoney#round`, conversion and `tieredPrice`. The result is rounded once, straight to the policy, never twice through the amount's own scale. A policy is also a function that rounds an amount: `amounts.map(policy)`, `m.with(policy)`. Policies are passed explicitly, never stored on amounts or set globally.

## Functions

### roundingPolicy

`roundingPolicy(options?: RoundingPolicyOptions): RoundingPolicy`

Builds a policy. The options are checked here, once.

- `scale`: decimal places of the result (default: the currency's exponent).
- `increment`: a positive safe integer count of 10^-scale units to round to (default 1; 5 for 0.05 at scale 2).
- `rounding`: the mode (default `'halfExpand'`).
- `currency`: restricts the policy to one currency.
- **Throws:** `RangeError` for an increment that isn't a positive integer, an invalid mode or scale, or an unknown currency. Applying the policy to an amount in another currency than `currency` throws `CurrencyMismatchError`.

### isoPolicy

`isoPolicy: RoundingPolicy`

The currency's exponent, half up: the policy most amounts should end with.

### assertScale

`assertScale(money: Money<string>, policy: RoundingPolicy): void`

Checks that `money` is exactly what `policy` produces, for example before it is booked or sent to a processor.

- **Throws:** `RangeError` unless `money` is at the policy's scale and a multiple of its increment; `CurrencyMismatchError` when the policy has another currency.

Only policies built by this copy of the package are accepted. A lookalike function, or a policy from a second installed copy, throws a `TypeError` wherever it is passed.

```ts
import { money } from '@ducatjs/money';
import { assertScale, isoPolicy, roundingPolicy } from '@ducatjs/money/policy';

const unitPrice = roundingPolicy({ scale: 4, rounding: 'halfEven' });
money('10.00', 'EUR').divide(3, unitPrice); // → 3.3333 EUR
const downToHundreds = roundingPolicy({ scale: 0, increment: 100, rounding: 'floor' });
money('12345.60', 'CHF').round(downToHundreds); // → 12300 CHF
[money('1.234', 'EUR', { scale: 3 })].map(isoPolicy); // → [1.23 EUR]
assertScale(money('1.234', 'EUR', { scale: 3 }), isoPolicy); // throws RangeError
roundingPolicy({ increment: 0 }); // throws RangeError
```

## Types

- `RoundingPolicy`: a function `<C extends string>(money: Money<C>) => Money<C>` with readonly fields `scale` (`number | undefined`; undefined means the currency's exponent), `increment` (`number`), `rounding` (`RoundingMode`) and `currency` (`string | undefined`).
- `RoundingPolicyOptions`: `{ scale?: number; increment?: number; rounding?: RoundingMode; currency?: string }`, every field optional.
- `RoundingInput`: `RoundingMode | RoundingPolicy`, what every `rounding` parameter accepts.
