# How to add and extract VAT and other taxes

This guide shows you how to add tax to a net price, extract it from a gross price, apply a percentage or a discount, and keep report totals exact across many rows. The functions are in `@ducatjs/money/tax`; the exact variants are in `@ducatjs/money/exact`.

## Add tax to a net price, or extract it from a gross price

Import `@ducatjs/money/tax`, then call `addTax(percent)` on a net amount or `extractTax(percent)` on a gross one. Both return `{ net, tax, gross }`, and net + tax is always exactly gross:

```ts
import { money } from '@ducatjs/money';
import '@ducatjs/money/tax';

money('12', 'GBP').extractTax(20); // → { net: 10.00 GBP, tax: 2.00 GBP, gross: 12.00 GBP }
money('10', 'GBP').addTax(20); // → { net: 10.00 GBP, tax: 2.00 GBP, gross: 12.00 GBP }
money('80.00', 'EUR').discount(15); // → 68.00 EUR
money('80.00', 'EUR').percentage(19); // → 15.20 EUR
```

## Round the part that is charged

Pass a rounding mode or a rounding policy as the last argument. With a policy, the tax functions apply it to the amount they compute: the **gross** for `addTax` (the amount charged), the **net** for `extractTax`, and the **discounted price** for `discount`. The other part is the exact difference, so net + tax is still exactly gross. With a plain rounding mode, `addTax` and `discount` round the tax and the discount amount. See [How to round to a policy](round-to-a-policy.md).

## Keep a report's totals exact

If a report rounds each row's net and then sums them, it drifts (see [Where money arithmetic goes wrong](../explanation/footguns.md#rounding-at-every-step-and-a-default-you-didnt-choose)). Use `extractTaxExact(gross, percent)` and `addTaxExact(net, percent)` from `@ducatjs/money/exact`, which split an amount (Money or ExactMoney) into exact `{ net, tax, gross }` parts, then sum the exact parts and round once:

```ts
import { money } from '@ducatjs/money';
import { extractTaxExact, sumExact } from '@ducatjs/money/exact'; // also adds the methods
import '@ducatjs/money/tax';

const rows = Array.from({ length: 7 }, () => money('1.00', 'CHF'));
rows.map((row) => row.extractTax('7.7', 'halfEven').net); // seven times 0.93 CHF: 6.51 in total
sumExact(rows.map((row) => row.extractTaxExact('7.7').net)).round('halfEven'); // → 6.50 CHF
extractTaxExact(money('12', 'EUR'), '20'); // → { net: 10 EUR, tax: 2 EUR, gross: 12 EUR }
```

## Related

- Reference: [`@ducatjs/money/tax`](../reference/tax.md), [`@ducatjs/money/exact`](../reference/exact.md), [`@ducatjs/money/policy`](../reference/policy.md)
- Explanation: [About rounding](../explanation/rounding.md), [What is proved](../explanation/proofs.md) (the tax model)
