# How to set prices: price endings, tiers and unit prices

This guide shows you how to move a computed price to a retail ending (.99, 9.90, the nearest 5), how to price a quantity under graduated or volume tiers, how to compose discounts and rates exactly, and how to work with unit prices finer than the currency. Price endings and tiers are in `@ducatjs/money/pricing`.

## Move a price to a retail ending

Build a rule with `priceEnding({ ending, step?, rounding? })` and apply it with `price.with(rule)` or `prices.map(rule)`. The allowed prices are `ending + k × step` (step 1 by default); `'ceil'` (the default) picks the next one up, `'floor'` the next one down, and `'halfCeil'` the nearest.

```ts
import { money } from '@ducatjs/money';
import { priceEnding } from '@ducatjs/money/pricing';

const charm = priceEnding({ ending: '0.99' });
money('23.41', 'EUR').with(charm); // → 23.99 EUR
money('23.41', 'EUR').with(priceEnding({ ending: '9.90', step: 10 })); // → 29.90 EUR
money('22.50', 'EUR').with(priceEnding({ ending: 0, step: 5, rounding: 'halfCeil' })); // → 25.00 EUR
money('1234', 'JPY').with(priceEnding({ ending: 80, step: 100 })); // → 1280 JPY
money('100', 'JPY').with(charm); // throws RangeError: JPY has no cents
```

## Price a quantity under tiers

Write the tiers in the style of Stripe's: each tier has an inclusive `upTo` (`'inf'` on the last), a `unitAmount` (sub-cent amounts are fine) and a `flatAmount`, either or both. Then call `tieredPrice(quantity, { mode, tiers })`. In `'graduated'` mode each tier prices the units that fall in it; in `'volume'` mode the tier the whole quantity falls in prices every unit. The total is rounded once, and the breakdown's `lines` always sum to it.

```ts
import { money } from '@ducatjs/money';
import { tieredPrice } from '@ducatjs/money/pricing';

const tiers = [
  { upTo: 5, unitAmount: money('5', 'USD'), flatAmount: money('10', 'USD') },
  { upTo: 10, unitAmount: money('4', 'USD'), flatAmount: money('20', 'USD') },
  { upTo: 'inf', unitAmount: money('3', 'USD'), flatAmount: money('30', 'USD') },
] as const;
tieredPrice(12, { mode: 'graduated', tiers }).total; // → 111.00 USD
tieredPrice(12, { mode: 'graduated', tiers }).lines.map((line) => line.amount); // → [35.00 USD, 40.00 USD, 36.00 USD]
tieredPrice(12, { mode: 'volume', tiers }).total; // → 66.00 USD
tieredPrice(0, { mode: 'volume', tiers }).total; // → 10.00 USD (the first tier's flat amount)
```

## Handle real tier tables

- If quantities are fractional (`'12.25'` kWh), pass a decimal string, an `'a/b'` string (`'250/3'`), a `ratio()` or a `Fixed`.
- If the last tier is open, write `upTo: 'inf'`, `null` or `Infinity`.
- If quantities can go past a bounded last tier, decide: by default they throw; with `beyondLastTier: 'cap'` they are charged as if they were the last `upTo`.
- If tiers are chosen by one quantity but charged by another (meters chosen, units charged), pass `chargeQuantity` in volume mode. It multiplies the chosen tier's `unitAmount`; the tier's `flatAmount` is charged once. Graduated mode has no single tier, so `chargeQuantity` throws there.

```ts
import { money } from '@ducatjs/money';
import { fixed } from '@ducatjs/money/fixed';
import { tieredPrice } from '@ducatjs/money/pricing';

const capped = [
  { upTo: 10, unitAmount: money('2', 'EUR') },
  { upTo: 100, unitAmount: money('1.50', 'EUR'), flatAmount: money('5', 'EUR') },
];
tieredPrice(250, { mode: 'graduated', tiers: capped, beyondLastTier: 'cap' }).total; // → 160.00 EUR
tieredPrice(250, { mode: 'graduated', tiers: capped }); // throws RangeError
tieredPrice('250/3', { mode: 'volume', tiers: capped }).total; // → 130.00 EUR
tieredPrice(fixed('12.25'), { mode: 'volume', tiers: capped }).total; // → 23.38 EUR

const perMeter = [
  { upTo: 1, unitAmount: money('0.30', 'EUR'), flatAmount: money('10', 'EUR') },
  { upTo: null, unitAmount: money('0.25', 'EUR'), flatAmount: money('25', 'EUR') },
];
tieredPrice(3, { mode: 'volume', tiers: perMeter, chargeQuantity: '1234.5' }).total; // → 333.63 EUR
```

## Compose discounts and rates exactly

To combine rates and shares without going through strings, use the Ratio arithmetic in `@ducatjs/money/math` (`ratioAdd`, `ratioSubtract`, `ratioMultiply`, `ratioDivide`, `ratioNegate`, `ratioComplement`, `ratioCompare`). The result is a reduced `Ratio`, which every factor parameter accepts:

```ts
import { money, ratio } from '@ducatjs/money';
import { ratioAdd, ratioCompare, ratioComplement } from '@ducatjs/money/math';

const afterDiscount = ratioComplement('0.15'); // → { num: 17n, den: 20n, n: 17, d: 20 }
money('80.00', 'EUR').multiply(afterDiscount); // → 68.00 EUR
ratioAdd('0.19', ratio(1, 3)); // → { num: 157n, den: 300n, n: 157, d: 300 }
ratioCompare('1/3', '0.3333'); // → 1
```

## Work with unit prices finer than the currency

Keep quantities, unit prices with more decimals than the currency, and rates as `Fixed` values (`@ducatjs/money/fixed`), an exact decimal without a currency:

```ts
import { fixed, fromScaled } from '@ducatjs/money/fixed';

const unitPrice = fixed('0.0425'); // → 0.0425 (scale 4)
const total = unitPrice.multiply(1200); // → 51.0000, exact
const perDay = fixed('100.00').divide(3, 'halfEven'); // → 33.33: rounded once, to this value's scale
fixed('1.5').add('0.25'); // → 1.75: mixed scales align to the larger one
fixed('2.5').round('halfEven'); // → 2: round() defaults to scale 0
fromScaled(12345, 3).toString(); // → '12.345'
JSON.stringify({ unitPrice }); // → '{"unitPrice":"0.0425"}'
fixed('12.3400').trimScale(); // → 12.34: the smallest exact scale (at least the argument, default 0)
fixed('0.1').toNumber(); // → 0.1: the nearest double, for display and charts only
```

If you divide to another scale, pass the scale instead of calling `toScale` afterwards, which would round twice: `fixed('9.990').divide('1.2', 'halfEven', { scale: 2 })` is 8.32.

Use a `Fixed` directly as a factor wherever Money takes one: `multiply`, `divide`, the tax and percentage functions, `ExactMoney`, conversion and rates. Keep `toRatio()` for reuse:

```ts
import { money } from '@ducatjs/money';
import { fixed } from '@ducatjs/money/fixed';

const vat = fixed('0.0725');
money('199.99', 'EUR').multiply(vat, 'halfEven'); // → 14.50 EUR
vat.toRatio(); // → { num: 29n, den: 400n, n: 29, d: 400 }
```

To turn a Fixed into Money and back, import `@ducatjs/money/fixed/money` instead of `/fixed`. `toMoney` throws a `RoundingError` when it would drop digits, unless you pass a rounding mode:

```ts
import { money } from '@ducatjs/money';
import { fixed } from '@ducatjs/money/fixed/money';

money('12.34', 'EUR').toFixedPoint(); // → 12.34
fixed('1.005').toMoney('EUR', 'halfEven'); // → 1.00 EUR
fixed('1.005').toMoney('EUR'); // throws RoundingError
```

## Related

- Reference: [`@ducatjs/money/pricing`](../reference/pricing.md), [`@ducatjs/money/math`](../reference/math.md), [`@ducatjs/money/fixed`](../reference/fixed.md)
- Explanation: [About exactness](../explanation/exactness.md)
