# `@ducatjs/money/pricing`

Retail price endings, and tiered and volume pricing. **Installs:** nothing.

Related: [How to set prices](../how-to/set-prices.md)

## Functions

### priceEnding

`priceEnding(options: PriceEndingOptions): PriceEnding`

Builds a rule that moves a computed price to a retail ending: the allowed prices are `ending + k × step` for every integer `k`, and `rounding` picks one. The rule is a function, so `price.with(rule)` and `prices.map(rule)` work. The result is exact, at the price's scale. The options are checked when the rule is built.

- `ending`: what prices end in, in major units, as a decimal string or an integer (`'0.99'`; `'9.90'` with `step: 10`; `0` with `step: 5`). At least 0 and less than `step`.
- `step`: the distance between allowed prices, in major units (default 1).
- `rounding`: `'ceil'` (default) the next allowed price at or above, `'floor'` the next at or below, `'halfCeil'` the nearest (ties go up), or any other mode applied to the count of steps. `'unnecessary'` throws unless the price already has the ending.
- **Throws:** when built, `RangeError` for an ending outside `[0, step)`, a step that isn't positive, a number that isn't a valid decimal, or an invalid mode; `TypeError` for an ending or step of another type. When applied, `RangeError` when the ending or step has more decimals than the price (0.99 for a whole-yen price), and `RoundingError` for `'unnecessary'`.

```ts
import { money } from '@ducatjs/money';
import { priceEnding } from '@ducatjs/money/pricing';

const charm = priceEnding({ ending: '0.99' });
money('23.41', 'EUR').with(charm); // → 23.99 EUR
money('23.41', 'EUR').with(priceEnding({ ending: '9.90', step: 10 })); // → 29.90 EUR
money('22.50', 'EUR').with(priceEnding({ ending: 0, step: 5, rounding: 'halfCeil' })); // → 25.00 EUR
money('100', 'JPY').with(charm); // throws RangeError: JPY has no cents
charm.ending; // → '0.99'
```

### tieredPrice

`tieredPrice<C extends string>(quantity: Quantity, options: TieredPriceOptions<C>): TieredPrice<C>`

The price of `quantity` under tiers in the style of Stripe's, exactly, with the total rounded once and a line per tier.

- **Tiers:** each covers quantities above the previous tier's `upTo`, up to and including its own. The last may be open (`upTo: 'inf'`, `null` or `Infinity`). Each has a `unitAmount` (sub-cent amounts are fine), a `flatAmount`, or both.
- **Modes:** `'graduated'`: each tier prices the units that fall in it, and the charges add up; a tier's flat amount is charged once the quantity reaches it. `'volume'`: the tier the whole quantity falls in prices every unit.
- **Quantity 0** falls in the first tier, so its flat amount is charged.
- **Rounds:** the exact total once, with `rounding` (default `'halfExpand'`, to the currency's exponent) or a policy. Each line's `amount` is the rounded running total minus the rounded running total before it, so the lines sum exactly to the total.
- **Beyond a bounded last tier:** throws by default; `beyondLastTier: 'cap'` charges as if the quantity were the last `upTo`. A `chargeQuantity` is not capped.
- **`chargeQuantity`** (volume mode only): the quantity the chosen tier's `unitAmount` multiplies, when it isn't the quantity that chose the tier. The tier's `flatAmount` is charged once.
- **Throws:** `RangeError` for no tiers, a tier with neither amount, bounds that don't increase (the message names the tier), an open tier that isn't last, a negative quantity, a quantity past a bounded last tier without `'cap'`, or an invalid `mode` or `beyondLastTier`; `TypeError` for `chargeQuantity` in graduated mode; `CurrencyMismatchError` for tiers in more than one currency.

```ts
import { money } from '@ducatjs/money';
import { tieredPrice } from '@ducatjs/money/pricing';

const tiers = [
  { upTo: 5, unitAmount: money('5', 'USD'), flatAmount: money('10', 'USD') },
  { upTo: 10, unitAmount: money('4', 'USD'), flatAmount: money('20', 'USD') },
  { upTo: 'inf', unitAmount: money('3', 'USD'), flatAmount: money('30', 'USD') },
] as const;
tieredPrice(12, { mode: 'graduated', tiers }).total; // → 111.00 USD
tieredPrice(12, { mode: 'volume', tiers }).total; // → 66.00 USD
tieredPrice(12, { mode: 'volume', tiers }).lines[0]?.quantity; // → '12'
```

## Types

- `PriceEndingOptions`: `{ ending: string | number; step?: string | number; rounding?: RoundingMode }`.
- `PriceEnding`: the rule, a function `<C extends string>(money: Money<C>) => Money<C>` with readonly `ending` and `step` (exact decimal strings in major units) and `rounding`.
- `Quantity`: a `Factor`, exact and not negative: an integer, bigint, decimal string (`'12.25'` kWh), `'a/b'` string (`'250/3'`), `ratio()` or `Fixed`.
- `PriceTier<C>`: `{ upTo: Quantity | 'inf' | null; unitAmount?: Money<C>; flatAmount?: Money<C> }`.
- `TiersMode`: `'graduated' | 'volume'`.
- `TieredPriceOptions<C>`: `{ mode: TiersMode; tiers: readonly PriceTier<C>[]; rounding?: RoundingInput; beyondLastTier?: 'throw' | 'cap'; chargeQuantity?: Quantity }`.
- `TierLine<C>`: `{ tier: number; quantity: string; exact: ExactMoney<C>; amount: Money<C> }`: the tier's index, the units priced in it (a decimal string, or `'num/den'` when it doesn't terminate), the exact charge, and the rounded amount.
- `TieredPrice<C>`: `{ total: Money<C>; exact: ExactMoney<C>; lines: TierLine<C>[] }`. `lines` lists every tier the quantity reached, in order (one in volume mode).
