# Build a checkout

In this tutorial we will build the money side of a small shop's checkout: a basket of items with quantities, a discount code, VAT, the amount we ask Stripe to charge, and the order record we save. Each step uses what the step before it made.

We'll assume you've done [Your first program with ducat](first-steps.md), so `money`, `add` and rounding are familiar. Every code block on this page runs as it is.

## The basket

Our shop sells in pounds. Prices are before VAT. A customer has put three things in the basket:

```ts
import { money, sum } from '@ducatjs/money';

const basket = [
  { name: 'Notebook', unitPrice: money('4.50', 'GBP'), quantity: 3 },
  { name: 'Fountain pen', unitPrice: money('18.00', 'GBP'), quantity: 1 },
  { name: 'Ink, 50 ml', unitPrice: money('6.25', 'GBP'), quantity: 2 },
];
```

## Line totals and the subtotal

A line's total is its unit price times its quantity. Multiplying by a whole number never needs rounding:

<!-- doctest: continue -->

```ts
const lines = basket.map((item) => ({
  ...item,
  total: item.unitPrice.multiply(item.quantity),
}));
lines.map((line) => line.total); // → [13.50 GBP, 18.00 GBP, 12.50 GBP]

const subtotal = sum(lines.map((line) => line.total)); // → 44.00 GBP
```

`sum` adds a list of amounts in one currency.

## A discount code

The customer has a code for 15% off. Discounts are in the tax module, `@ducatjs/money/tax`:

<!-- doctest: continue -->

```ts
import '@ducatjs/money/tax';

const discounted = subtotal.discount(15); // → 37.40 GBP
const saving = subtotal.subtract(discounted); // → 6.60 GBP
```

`discount(15)` takes 15 percent off. Notice that we can work out the saving by subtracting: the discounted price and the saving always add up to the subtotal.

## Add VAT

UK VAT is 20%. `addTax` gives us all three parts of the price at once:

<!-- doctest: continue -->

```ts
const { net, tax, gross } = discounted.addTax(20);
net; // → 37.40 GBP
tax; // → 7.48 GBP
gross; // → 44.88 GBP
```

`net` plus `tax` is always exactly `gross`, so the invoice adds up whatever the rates are.

## Ask Stripe to charge it

Stripe wants an integer amount in the currency's smallest unit and a lower-case currency code. The Stripe module builds exactly that:

<!-- doctest: continue -->

```ts
import { toStripe } from '@ducatjs/money/stripe';

toStripe(gross); // → { amount: 4488, currency: 'gbp' }
```

4488 pence is £44.88. We'd pass this object to Stripe's API when we create the payment.

## Save the order

Last, we save the order. Each amount goes into JSON as a decimal string with its currency, so nothing is lost on the way to the database or another service:

<!-- doctest: continue -->

```ts
import { fromJSON } from '@ducatjs/money';

const order = {
  lines: lines.map((line) => ({ name: line.name, quantity: line.quantity, total: line.total })),
  discount: saving,
  net,
  tax,
  gross,
};
const saved = JSON.stringify(order);
JSON.parse(saved).gross; // → { amount: '44.88', currency: 'GBP' }

const reloaded = fromJSON(JSON.parse(saved).gross); // → 44.88 GBP
reloaded.equals(gross); // → true
```

## What we've done

We priced a basket line by line, added it up, took a discount, added VAT so that net and tax add up to the gross, turned the gross into the amount Stripe expects, and saved the order so every amount reads back exactly.

Real shops need more than this, and the how-to guides cover it:

- [How to add and extract tax](../how-to/add-and-extract-tax.md): prices that include VAT, several rates, report totals.
- [How to send amounts to payment processors](../how-to/send-amounts-to-payment-processors.md): Adyen, PayPal and the others, zero-decimal currencies, and reading amounts back.
- [How to split and allocate](../how-to/split-and-allocate.md): splitting a payment or a discount across lines.
- [How to store money in a database](../how-to/store-money-in-a-database.md): columns rather than JSON.
- [How to round cash amounts](../how-to/round-cash.md): totals paid in cash where the smallest coin is 5 cents.
