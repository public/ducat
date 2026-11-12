# What's missing (honest list)

Known gaps and limitations, as of this version.

- **Stripe three-decimal rule.** The "last digit must be 0" rule comes from a June 2024 archived copy of Stripe's page. The live page no longer has that section (it is marked unverified in `data/stripe.json`).
- **Cash-rounding rules.** Some are backed only by secondary sources (`verified: false`): CHF, DKK, AUD, NZD, ILS, MYR, SGD, FI/IE/IT/SK/LT EUR, GYD, MRU, TZS and several others. MUR has no rule: CLDR says whole rupees, but the Bank of Mauritius doesn't list its coins, and secondary sources say 5 cent coins still circulate. `includeUnverified: false` turns them off.
  - Tie rules are `halfExpand` except Serbia's (ties down). Singapore's "round down in the customer's favour" practice and USD's state-by-state post-penny rules aren't modelled.
- **Checkout.com currency list.** The currency-codes page calls itself the "major currencies we support"; `toCheckout` refuses anything not on it. Its amount limits (the docs say greater than zero and at most nine digits, the API schema allows 0 for card verification and up to ten digits) aren't enforced.
- **PayPal.** Its two currency pages disagree: the REST reference page lists RUB and the other doesn't (`toPayPal` accepts RUB). The docs don't say whether a zero fraction such as `"100.00"` counts as a decimal for HUF, JPY or TWD, so `toPayPal` always sends whole numbers for them. BRL, CNY and MYR work for in-country accounts only, and that isn't checked. The schema allows a minus sign and the text says amounts are positive; the sign isn't checked either.
- **Braintree.** The currencies page gives only the zero-decimal list, so every other currency is assumed to take its ISO decimals, and the withdrawn codes it still lists (HRK, LTL, SLL, STD, ZMK, ZWD) are assumed to take 2. The GraphQL `Amount` type allows three decimals and the REST reference says `x.xx`; `toBraintree` sends the currency's own decimals, which both accept. Which currencies an account can use depends on its setup, and that isn't checked.
- **Klarna.** Amounts follow ISO 4217 minor units, as its docs say, but no Klarna page gives a HUF example, so HUF in fillér is unconfirmed. Each purchase country has one currency, and the country/currency pairing isn't checked. Only the Payments API schema was read; captures and refunds are assumed to use the same units. `toKlarna` returns a bare integer because Klarna sends the currency once per order (`purchase_currency`), not per amount. Klarna's `tax_rate` (a percentage with two implicit decimals, 2000 = 20%) has no helper.
- **Processor coverage.** Stripe, Adyen, Checkout.com, PayPal (REST APIs), Braintree and Klarna are covered. There is no Adyen Terminal API (it uses major units). There is no per-account-country Stripe currency availability; the table is the union of all countries.
- **Withdrawn and non-ISO codes.** `@ducatjs/money/historic` covers the 54 withdrawn codes whose ISO minor units are sourced, plus CNH. Codes withdrawn before about 1995 whose exponents aren't sourced (ARY, CSK, ZRN…) and the SDR (XDR, which ISO lists without minor units, though Checkout.com accepts it) still need `defineCurrency`. The exponents come from OpenJDK's ISO-derived currency data, because ISO's List Three of withdrawn codes doesn't carry minor units. It gives withdrawal months, not days, and no replacement codes.
- **Formatting gaps:**
  - No pluggable formatter for engines without Intl.
  - `parse` is lenient about group sizes (it accepts `1,23,4.00` in en-US). It also doesn't check the currency symbol in the text against the `currency` argument.
- **Not yet benchmarked:**
  - Browsers themselves; only their engines were tested via the jsvu shells.
  - Memory and GC pressure, which were reasoned about but not measured.
  - dinero.js's bigint calculator.
- **No Money arrays or columnar ops** (e.g. summing a `Float64Array`/`BigInt64Array` of minor units).
- **The root entry always bundles the ISO table** (about 0.55 KiB gzipped, 1 KiB minified). A program written with `/fn` imports only the currencies it uses (`@ducatjs/money/iso/EUR`), like dinero.js's per-currency objects.
- **Only the Prisma helpers have a scale column.** Without one, minor-unit columns can't round-trip values at a scale other than the currency's, so `toMinorColumns`, the Kysely `setMoney` and the Drizzle `moneyMinor` columns refuse them by design. With Prisma, `{ scale: 'amountScale' }` stores the scale alongside (see [Prisma](prisma.md)). Elsewhere, store `m.toScaledUnits()` and `m.scale` yourself, or use a decimal, JSON or the node-postgres composite column, which keep the scale.
- **No docs site yet.**
