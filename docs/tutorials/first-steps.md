# Your first program with ducat

In this tutorial we will write a small program that works out a restaurant bill: we add up what was ordered, add a tip, split the bill between three friends, print the shares, and save the total so it can be read back later. On the way we will meet the few ideas that everything else in ducat builds on.

You need Node 24 or later (or Bun or Deno) and a TypeScript project. Every code block on this page runs as it is: the `// →` comments show what each line gives.

## Install ducat

```sh
pnpm add @ducatjs/money
```

(`npm install @ducatjs/money` and `yarn add @ducatjs/money` work too.)

## Create some amounts

Make a file, `bill.ts`, and create the two dishes that were ordered. Each step below adds to the same file:

```ts
import { money } from '@ducatjs/money';

const pasta = money('14.50', 'EUR');
const pizza = money('12.90', 'EUR');

pasta; // → 14.50 EUR
pizza.currency; // → 'EUR'
```

We wrote the amounts as strings. A string says exactly which decimal we mean, so ducat never has to guess, and the currency comes with the amount: `pasta` is a `Money<'EUR'>`.

## Add them up

<!-- doctest: continue -->

```ts
const wine = money('24', 'EUR');
const food = pasta.add(pizza); // → 27.40 EUR
const total = food.add(wine); // → 51.40 EUR
```

Notice that `money('24', 'EUR')` became 24.00 EUR: an amount always has at least its currency's decimals. Notice too that `add` gave us a new value; `pasta` is still 14.50 EUR. Amounts never change once made.

Now let's try adding dollars to our euros:

<!-- doctest: continue -->

```ts
const tipInDollars = money('5', 'USD');
total.add(tipInDollars); // compile error, and throws if types are erased
```

TypeScript refuses it, because a `Money<'EUR'>` and a `Money<'USD'>` don't mix. Delete those two lines before you go on.

## Add a tip

We'll tip 12.5% of the food. 12.5% of 27.40 is 3.425, which has one decimal too many for euros, so ducat has to round it:

<!-- doctest: continue -->

```ts
food.multiply('0.125'); // → 3.43 EUR
```

By default ducat rounds a half away from zero, so 3.425 became 3.43. When you want a different rule, say so:

<!-- doctest: continue -->

```ts
food.multiply('0.125', 'halfEven'); // → 3.42 EUR
food.multiply('0.125', 'unnecessary'); // throws RoundingError
```

`'halfEven'` sends the half to the even cent. `'unnecessary'` says "this should never need rounding" and throws if it does. We'll keep the default, so delete those two lines and add the tip to the bill:

<!-- doctest: continue -->

```ts
const tip = food.multiply('0.125'); // → 3.43 EUR
const bill = total.add(tip); // → 54.83 EUR
```

## Split the bill

Splitting is in its own module, `@ducatjs/money/allocate`. Importing it adds the methods to Money. Add the import at the top of `bill.ts`, next to the first one, and split the bill three ways:

<!-- doctest: continue -->

```ts
import '@ducatjs/money/allocate';

const shares = bill.split(3); // → [18.28 EUR, 18.28 EUR, 18.27 EUR]
```

54.83 doesn't divide evenly by three, so the extra cent went to the first share. Let's check that nothing was lost:

<!-- doctest: continue -->

```ts
import { sum } from '@ducatjs/money';

sum(shares); // → 54.83 EUR
```

The shares always add up to the bill exactly.

## Print the shares

Formatting is another module, `@ducatjs/money/format`. It uses the platform's `Intl`, so we pass a locale:

<!-- doctest: continue -->

```ts
import '@ducatjs/money/format';

shares[0]?.format('en-IE'); // → '€18.28'
shares[0]?.format('de-DE'); // → '18,28 €'
```

## Save the total and read it back

To store or send an amount, turn it into JSON. The amount is written as a decimal string, next to its currency:

<!-- doctest: continue -->

```ts
import { fromJSON } from '@ducatjs/money';

const saved = JSON.stringify(bill); // → '{"amount":"54.83","currency":"EUR"}'
const loaded = fromJSON(JSON.parse(saved)); // → 54.83 EUR
loaded.equals(bill); // → true
```

## What we've done

We built a bill from exact decimal amounts, added them, rounded a tip once with a rule we could see, split the bill so the shares sum to the total, printed it for two locales and saved it as JSON. That's the whole shape of ducat: exact amounts, explicit rounding, and opt-in modules for everything beyond the core.

Next, [build a checkout](checkout.md) from a basket to the amount you charge. Or go straight to what you need:

- [How-to guides](../README.md#how-to-guides), for tasks such as storing amounts in a database or charging through Stripe.
- [The reference](../reference/money.md), for every function of the core.
- [About rounding](../explanation/rounding.md), for why ducat rounds the way it does.
