# How to round cash payments

This guide shows you how to round an amount paid in cash to the smallest coin the country uses (0.05 CHF, 1 SEK, 0.05 EUR in the Netherlands), and how to show it with the right number of decimals. The functions are in `@ducatjs/money/cash`.

Round **only cash tenders**: card payments are never rounded in any of these jurisdictions.

## Round a cash amount

Call `cashRound(m, { country? })`. It uses the rule for the currency (CHF 0.05, SEK and NOK 1.00, DKK 0.50, and the others listed in the reference). For EUR, pass the `country`, because there is no euro-wide rule:

```ts
import { money } from '@ducatjs/money';
import { cashRound } from '@ducatjs/money/cash';

cashRound(money('10.03', 'CHF')); // → 10.05 CHF
cashRound(money('12.42', 'EUR'), { country: 'NL' }); // → 12.40 EUR
cashRound(money('10.50', 'RSD')); // → 10.00 RSD (Serbia rounds a 50 para tie down)
```

Each rule follows its source's tie rule. If you need another, pass `rounding`. If you want only rules confirmed by a primary source, pass `includeUnverified: false`.

## Round to a cash policy inside a calculation

If the amount comes out of a multiplication, division, tax or conversion, round it straight to cash with `cashPolicy(currency, { country? })`, so it rounds once. Unlike `cashRound`, which keeps a larger scale (10.034 CHF gives 10.050), a policy always returns its own scale (10.05). It throws when no rule applies. Or apply a step as one link of a chain with `with`:

```ts
import { money, type Money } from '@ducatjs/money';

const toFiveRappen = (value: Money<'CHF'>) => value.divide(5).round('halfExpand').multiply(5);
money('10.00', 'CHF').multiply('1.077').with(toFiveRappen); // → 10.75 CHF
```

## Show the cash amount with the right decimals

`currencyDigits(code, { usage: 'cash', country? })` gives the decimals a cash amount is shown with: `currencyDigits('SEK', { usage: 'cash' })` is 0, CHF and DKK stay at 2. The smallest coin is `cashUnit(code, { country? })`. [Where money arithmetic goes wrong](../explanation/footguns.md#currencies-with-other-exponents-and-cash-rounding) shows what goes wrong when a library assumes two decimals for every currency.

## Related

- Reference: [`@ducatjs/money/cash`](../reference/cash.md) (the full rule table and its sources), [known limitations](../reference/limitations.md) (unverified rules)
- How-to: [How to round to a policy](round-to-a-policy.md)
- Explanation: [What is proved](../explanation/proofs.md) (the cash-rounding model)
