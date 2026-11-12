# How to send amounts to Stripe, Adyen and other payment processors

This guide shows you how to turn a Money into the amount a payment processor expects, how to read processor amounts back, and how to read the exchange rate a payment actually settled at. Each processor is its own opt-in entry: `@ducatjs/money/stripe`, `/adyen`, `/checkout`, `/paypal`, `/braintree` and `/klarna`. They encode each processor's own exponents, which differ from ISO 4217 for some currencies.

## Convert an amount for the processor

Import the processor's entry, and call its `to…` function where you build the API request:

```ts
import { money } from '@ducatjs/money';
import { toStripe, toStripeAmount, fromStripe } from '@ducatjs/money/stripe';
import { toAdyen, fromAdyen } from '@ducatjs/money/adyen';
import { toCheckout, fromCheckout } from '@ducatjs/money/checkout';
import { toPayPal, fromPayPal } from '@ducatjs/money/paypal';
import { toBraintree, fromBraintree } from '@ducatjs/money/braintree';
import { toKlarna, fromKlarna } from '@ducatjs/money/klarna';

toStripe(money('10.99', 'USD')); // → { amount: 1099, currency: 'usd' }
toStripeAmount(money('5', 'ISK')); // → 500     (Stripe: two-decimal value ending in 00)
toStripeAmount(money('10.45', 'HUF'), { payout: true }); // throws RoundingError: payouts must be whole HUF
toStripeAmount(money('5.124', 'KWD'), { rounding: 'halfEven' }); // → 5120 (last digit must be 0)
toAdyen(money('15000', 'IDR')); // → { value: 15000, currency: 'IDR' }  (Adyen: IDR has 0 decimals)
toAdyen(money('5000', 'CLP')); // → { value: 500000, currency: 'CLP' } (Adyen: CLP has 2 decimals)
toCheckout(money('5000', 'CLP')); // → { amount: 500000, currency: 'CLP' } (Checkout.com: 2 decimals, must end in 00)
toCheckout(money('1.001', 'BHD')); // throws RoundingError: Checkout.com needs the last digit 0
toPayPal(money('10.99', 'USD')); // → { currency_code: 'USD', value: '10.99' }  (PayPal: exact decimal string)
toPayPal(money('1000', 'HUF')); // → { currency_code: 'HUF', value: '1000' }  (PayPal: HUF takes no decimals)
toBraintree(money('5000', 'LAK')); // → '5000'  (Braintree: LAK is zero-decimal; the merchant account sets the currency)
toKlarna(money('1000', 'HUF')); // → 100000  (Klarna: ISO minor units, so HUF in fillér)
```

The same 1000 units of each currency on the wire (from `test/processors.test.ts`):

|     | ISO exp | `toStripeAmount` | `toAdyen().value` | `toCheckoutAmount` | `toPayPalValue` | `toBraintree` | `toKlarna` |
| --- | ------- | ---------------: | ----------------: | -----------------: | --------------: | ------------: | ---------: |
| USD | 2       |           100000 |            100000 |             100000 |       "1000.00" |     "1000.00" |     100000 |
| JPY | 0       |             1000 |              1000 |               1000 |          "1000" |        "1000" |          - |
| ISK | 0       |           100000 |            100000 |               1000 |               - |        "1000" |          - |
| IDR | 2       |           100000 |              1000 |             100000 |               - |     "1000.00" |          - |
| CLP | 0       |             1000 |            100000 |             100000 |               - |        "1000" |          - |
| KWD | 3       |          1000000 |           1000000 |            1000000 |               - |             - |          - |
| HUF | 2       |           100000 |            100000 |             100000 |          "1000" |     "1000.00" |     100000 |

## Decide how to round when the processor needs fewer decimals

When the processor needs less precision than the value has, the conversion throws unless you pass a rounding mode. This happens for IDR or CVE on Adyen, MGA on Stripe, Stripe's HUF/TWD payouts, CLP payments on Checkout.com, HUF/TWD on PayPal, LAK on Braintree and three-decimal currencies on Stripe and Checkout.com. If you accept rounding there, pass `{ rounding }`, as the KWD line above does. PayPal and Braintree amounts are decimal strings, built from the exact value and never through a float.

## Send refunds and discounts with the right sign

Signs follow each processor's docs and are checked after rounding. Checkout.com (a card verification) and PayPal (breakdown fields) take zero, Braintree doesn't ("Amount must be greater than zero"), and none of the three takes negative amounts: send refunds as positive amounts. Klarna takes both, because its order lines document negative amounts for discounts ("Negative when type is discount").

## Read amounts back

`fromStripe`, `fromAdyen`, `fromCheckout`, `fromPayPal`, `fromBraintree` and `fromKlarna` return the value at its ISO scale when that is exact, and otherwise keep the processor's extra precision instead of rounding it away.

## Read the rate a payment settled at

For what a payment actually settled at, read the processor's own rate: `stripeRate` and `stripeImpliedRate` (`@ducatjs/money/stripe-fx`) from a Stripe balance transaction, and `adyenRate` (`@ducatjs/money/adyen-fx`) from an Adyen settlement details row. Each returns a `Rate` you can convert with ([How to convert currencies](convert-currencies.md)).

## Related

- Reference: [processor entries](../reference/processors.md), [settlement rates](../reference/rate-sources.md), [currency data and processor differences](../reference/currency-data.md), [known limitations](../reference/limitations.md)
- Explanation: [Decisions](../explanation/decisions.md) (why Stripe UGX is ×100)
