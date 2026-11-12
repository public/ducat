# Payment processors

`@ducatjs/money/stripe`, `/adyen`, `/checkout`, `/paypal`, `/braintree` and `/klarna`: the amount each processor's API expects, and back. Each is its own opt-in entry.

**Installs:** `toStripe` and `toStripeAmount` (`/stripe`), `toAdyen` (`/adyen`), `toCheckout` and `toCheckoutAmount` (`/checkout`), `toPayPal` and `toPayPalValue` (`/paypal`), `toBraintree` (`/braintree`), `toKlarna` (`/klarna`) on `Money`. The method takes the same arguments without the first.

Related: [How to send amounts to payment processors](../how-to/send-amounts-to-payment-processors.md) · [Currency data](currency-data.md) (the processor differences, with sources) · [Rate sources](rate-sources.md) (`stripeRate`, `adyenRate`)

## Common rules

- **Exponents** are each processor's own, from its documentation (`data/<processor>.json`), not ISO 4217's where they differ.
- **Rounding:** when the processor needs less precision than the value has, a `to…` function throws `RoundingError` unless a rounding mode is passed (default `'unnecessary'`). This happens for IDR or CVE on Adyen, MGA on Stripe, Stripe's HUF/TWD payouts, CLP payments on Checkout.com, HUF/TWD on PayPal, LAK on Braintree and three-decimal currencies on Stripe and Checkout.com. A mode rounds once, to the processor's exponent and multiple.
- **Signs** are checked after rounding, so −0.004 USD rounded to 0 counts as zero:

  | processor    | zero                                              | negative                                                                                        |
  | ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | Stripe       | yes                                               | not checked                                                                                     |
  | Adyen        | yes                                               | not checked                                                                                     |
  | Checkout.com | yes                                               | `RangeError` (refunds are sent as positive amounts)                                             |
  | PayPal       | yes                                               | `RangeError` (refunds are sent as positive amounts)                                             |
  | Braintree    | `RangeError` ("Amount must be greater than zero") | `RangeError`                                                                                    |
  | Klarna       | yes                                               | yes: its order lines document negative amounts for discounts ("Negative when type is discount") |

- **Integers:** an integer amount that isn't a safe integer throws `RangeError` ("too large"). A zero amount is never written as `-0`.
- **Unknown currencies:** every function throws `RangeError` for a currency the processor doesn't list.
- **Reading back:** `fromStripe`, `fromAdyen`, `fromCheckout`, `fromPayPal`, `fromBraintree` and `fromKlarna` return the value at its ISO scale when that is exact, and otherwise keep the processor's extra precision instead of rounding it away. Integer readers throw `RangeError` for a number that isn't a safe integer; decimal-string readers throw `SyntaxError` for a string that isn't in the processor's documented format. PayPal and Braintree amounts are decimal strings, built from the exact value and never through a float.

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

## `@ducatjs/money/stripe`

### toStripeAmount

`toStripeAmount(money: Money<string>, options?: StripeAmountOptions): number`

The integer `amount` to send: `toStripeAmount(money('5', 'ISK'))` is 500 (Stripe: a two-decimal value ending in 00). With `{ payout: true }`, payout rules apply (HUF and TWD: whole units).

- **Rounds:** only with `options.rounding`, to Stripe's exponent and multiple.
- **Throws:** `RoundingError` when Stripe needs a coarser amount and no mode is given (ISK and UGX need a multiple of 100; payouts of HUF and TWD whole units; BHD, JOD, KWD, OMR and TND a last digit of 0); `RangeError` for a currency Stripe doesn't present in, or an amount beyond a safe integer.

### toStripe

`toStripe(money: Money<string>, options?: StripeAmountOptions): { amount: number; currency: string }`

`{ amount, currency }` with Stripe's lowercase currency code, ready for a PaymentIntent. Rounds and throws as `toStripeAmount`.

### fromStripe

`fromStripe<C extends CurrencyInput>(amount: number | bigint, currency: C): Money<Uppercase<C>>`

Reads a Stripe amount (from a webhook, say): `fromStripe(500, 'isk')` is 5 ISK. The currency may be lowercase.

### stripeExponent, isStripeCurrency, STRIPE_RULES

- `stripeExponent(currency: string): number`: the exponent Stripe's API uses (ISK 2, JPY 0, KWD 3, MGA 0). Throws `RangeError` for a currency Stripe doesn't list.
- `isStripeCurrency(currency: string): boolean`: whether Stripe supports it as a presentment currency.
- `STRIPE_RULES`: `Record<string, [exponent, chargeMultiple, payoutMultiple]>` for every presentment currency. A multiple of 100 means "send a two-decimal value whose decimal part is always 00" (ISK, UGX) or, for payouts only, whole units (HUF, TWD). A multiple of 10 is the three-decimal rule (last digit must be 0).
- `StripeAmountOptions`: `{ payout?: boolean; rounding?: RoundingMode }`.

## `@ducatjs/money/adyen`

### toAdyen

`toAdyen(money: Money<string>, rounding?: RoundingMode): { value: number; currency: string }`

Adyen's `amount` object: `toAdyen(money('15000', 'IDR'))` is `{ value: 15000, currency: 'IDR' }` (Adyen: IDR has 0 decimals), and `toAdyen(money('5000', 'CLP'))` is `{ value: 500000, currency: 'CLP' }` (CLP has 2).

- **Rounds:** only with `rounding`, to Adyen's exponent.
- **Throws:** `RoundingError` when Adyen needs fewer decimals and no mode is given (IDR, CVE); `RangeError` for a currency not in Adyen's table, or an amount beyond a safe integer.

### fromAdyen

`fromAdyen<C extends CurrencyInput>(amount: { value: number | bigint; currency: C }): Money<C>`

Reads an Adyen `amount` object: `fromAdyen({ value: 15000, currency: 'IDR' })` is 15000 IDR.

### adyenExponent, isAdyenCurrency, ADYEN_EXPONENTS

- `adyenExponent(currency: string): number`: the exponent Adyen's API uses (CLP 2, ISK 2, IDR 0 and CVE 0 differ from ISO). Throws `RangeError` for a currency not in its table.
- `isAdyenCurrency(currency: string): boolean`: whether Adyen lists it (its table, not ISO 4217).
- `ADYEN_EXPONENTS`: `Record<string, number>`, Adyen's minor-unit exponents. Adyen's table is authoritative where it differs from ISO.

## `@ducatjs/money/checkout`

### toCheckoutAmount

`toCheckoutAmount(money: Money<string>, options?: CheckoutAmountOptions): number`

The integer `amount` to send: `toCheckoutAmount(money('5000', 'CLP'))` is 500000 (Checkout.com: 2 decimals, must end in 00). SLL and XDR are on Checkout.com's list but not in ISO 4217's active list: call `defineCurrency('SLL', 2)` or `defineCurrency('XDR', 2)` before using them.

- **Rounds:** only with `options.rounding`, to Checkout.com's exponent and multiple.
- **Throws:** `RoundingError` when a coarser amount is needed and no mode is given (CLP payments need a multiple of 100; three-decimal currencies a last digit of 0); `RangeError` for a negative amount, a currency Checkout.com doesn't list, or an amount beyond a safe integer.

### toCheckout

`toCheckout(money: Money<string>, options?: CheckoutAmountOptions): { amount: number; currency: string }`

`{ amount, currency }` for a payment request. Rounds and throws as `toCheckoutAmount`.

### fromCheckout

`fromCheckout<C extends CurrencyInput>(amount: number | bigint, currency: C): Money<Uppercase<C>>`

Reads a Checkout.com amount: `fromCheckout(500000, 'CLP')` is 5000 CLP.

### checkoutExponent, isCheckoutCurrency, CHECKOUT_RULES

- `checkoutExponent(currency: string): number`: the exponent Checkout.com's API uses (CLP 2, JPY 0, BHD 3). Throws `RangeError` for a currency it doesn't list.
- `isCheckoutCurrency(currency: string): boolean`: whether Checkout.com lists it (case-insensitive).
- `CHECKOUT_RULES`: `Record<string, [exponent, multiple, standaloneMultiple]>`: the API exponent, the payment amount multiple, and the multiple for the Standalone API (authentication). CLP is two-decimal with a multiple of 100; three-decimal currencies need a multiple of 10.
- `CheckoutAmountOptions`: `{ rounding?: RoundingMode; standalone?: boolean }`. `standalone` is for an authentication request to the Standalone API, where CLP's "last two digits 00" rule doesn't apply.

## `@ducatjs/money/paypal`

### toPayPalValue

`toPayPalValue(money: Money<string>, options?: PayPalAmountOptions): string`

The exact `value` string: `'10.99'` for 10.99 USD, `'1000'` for 1000 HUF (PayPal: HUF takes no decimals).

- **Rounds:** only with `options.rounding`, to PayPal's decimals.
- **Throws:** `RoundingError` when PayPal needs fewer decimals and no mode is given (HUF, JPY, TWD); `RangeError` for a negative amount, more than 15 digits before the point, or a currency PayPal doesn't list.

### toPayPal

`toPayPal(money: Money<string>, options?: PayPalAmountOptions): { currency_code: string; value: string }`

A PayPal `money` object. Rounds and throws as `toPayPalValue`.

### fromPayPal

`fromPayPal<C extends CurrencyInput>(amount: { currency_code: C; value: string }): Money<Uppercase<C>>`

Reads a PayPal `money` object exactly: `fromPayPal({ currency_code: 'USD', value: '230.00' })`.

- **Throws:** `SyntaxError` for a `value` that doesn't match PayPal's Orders v2 pattern or is longer than 32 characters.

### paypalExponent, isPayPalCurrency, PAYPAL_EXPONENTS

- `paypalExponent(currency: string): number`: the decimals PayPal takes (JPY, HUF and TWD 0; the others 2). Throws `RangeError` for a currency PayPal doesn't list.
- `isPayPalCurrency(currency: string): boolean`: whether PayPal lists it (case-insensitive).
- `PAYPAL_EXPONENTS`: `Record<string, number>`, PayPal's decimals per currency.
- `PayPalAmountOptions`: `{ rounding?: RoundingMode }`.

## `@ducatjs/money/braintree`

### toBraintree

`toBraintree(money: Money<string>, options?: BraintreeAmountOptions): string`

The exact `amount` string: `'10.00'` for 10 USD, `'100'` for 100 JPY, `'5000'` for 5000 LAK (zero-decimal on Braintree). Braintree has no currency field on a transaction: the merchant account sets the currency.

- **Rounds:** only with `options.rounding`, to Braintree's decimals.
- **Throws:** `RoundingError` when Braintree needs fewer decimals and no mode is given (LAK); `RangeError` for a zero or negative amount, or a currency Braintree doesn't list.

### fromBraintree

`fromBraintree<C extends CurrencyInput>(amount: string, currency: C): Money<Uppercase<C>>`

Reads a Braintree amount string exactly: `fromBraintree('10.00', 'USD')`.

- **Throws:** `SyntaxError` for anything but digits with an optional fraction (no sign).

### braintreeExponent, isBraintreeCurrency, BRAINTREE_EXPONENTS

- `braintreeExponent(currency: string): number`: the decimals Braintree takes (JPY 0, LAK 0, USD 2). Throws `RangeError` for a currency it doesn't list.
- `isBraintreeCurrency(currency: string): boolean`: whether Braintree lists it (case-insensitive).
- `BRAINTREE_EXPONENTS`: `Record<string, number>`, Braintree's decimals per currency. The zero-decimal list includes LAK (ISO 2).
- `BraintreeAmountOptions`: `{ rounding?: RoundingMode }`.

## `@ducatjs/money/klarna`

### toKlarna

`toKlarna(money: Money<string>, options?: KlarnaAmountOptions): number`

The integer for any Klarna amount field, in ISO minor units: `toKlarna(money('25', 'EUR'))` is 2500, and 1000 HUF is 100000 (fillér). A bare number, because Klarna gives the currency once per order (`purchase_currency`). Negative amounts pass through, for discount lines, though `order_amount` itself must be non-negative.

- **Rounds:** only with `options.rounding`, to the ISO exponent.
- **Throws:** `RoundingError` for more decimals than the currency has and no mode; `RangeError` for a currency that isn't a Klarna purchase currency, or an amount beyond a safe integer.

### fromKlarna

`fromKlarna<C extends CurrencyInput>(amount: number | bigint, currency: C): Money<Uppercase<C>>`

Reads a Klarna amount field: `fromKlarna(2500, 'EUR')` is 25.00 EUR.

### klarnaExponent, isKlarnaCurrency, KLARNA_EXPONENTS

- `klarnaExponent(currency: string): number`: the ISO 4217 exponent of a Klarna purchase currency. Throws `RangeError` for any other currency.
- `isKlarnaCurrency(currency: string): boolean`: whether it is a Klarna purchase currency (case-insensitive).
- `KLARNA_EXPONENTS`: `Record<string, number>`, Klarna's purchase currencies and their ISO exponents.
- `KlarnaAmountOptions`: `{ rounding?: RoundingMode }`.

```ts
import { money } from '@ducatjs/money';
import { fromStripe, toStripeAmount } from '@ducatjs/money/stripe';

toStripeAmount(money('10.45', 'HUF'), { payout: true }); // throws RoundingError: payouts must be whole HUF
toStripeAmount(money('5.124', 'KWD'), { rounding: 'halfEven' }); // → 5120 (last digit must be 0)
fromStripe(500, 'isk'); // → 5 ISK
```
