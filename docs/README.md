# ducat documentation

ducat (`@ducatjs/money`) is an exact, fast, typed Money type for TypeScript. These pages are organised by what you need at the moment you open them.

## How these docs are organised

|                                 | when you are…           | they…                                           |
| ------------------------------- | ----------------------- | ----------------------------------------------- |
| [Tutorials](#tutorials)         | learning ducat          | take you through a working program step by step |
| [How-to guides](#how-to-guides) | doing a particular task | give the steps for one goal                     |
| [Reference](#reference)         | looking something up    | describe every entry, function, type and error  |
| [Explanation](#explanation)     | trying to understand    | discuss why ducat works the way it does         |

New to ducat? Start with [Your first program with ducat](tutorials/first-steps.md).

## Tutorials

- [Your first program with ducat](tutorials/first-steps.md): amounts, adding, rounding, splitting, formatting and JSON, in one small program.
- [Build a checkout](tutorials/checkout.md): a basket to an invoice, with a discount, VAT and the amount Stripe charges.

## How-to guides

**Amounts and rounding**

- [How to round to a policy](how-to/round-to-a-policy.md)
- [How to round cash amounts](how-to/round-cash.md)
- [How to split and allocate amounts](how-to/split-and-allocate.md)
- [How to set prices](how-to/set-prices.md): price endings, tiered and volume pricing
- [How to work in one currency](how-to/work-in-one-currency.md)
- [How to use other currencies](how-to/use-other-currencies.md): your own codes, withdrawn codes, crypto

**Tax, finance and conversion**

- [How to add and extract tax](how-to/add-and-extract-tax.md)
- [How to calculate interest, loans, NPV and proration](how-to/calculate-interest-and-loans.md)
- [How to convert currencies](how-to/convert-currencies.md)
- [How to use historical exchange rates](how-to/use-historical-rates.md)

**Input and output**

- [How to format amounts for display](how-to/format-amounts.md)
- [How to parse amounts people type](how-to/parse-user-input.md)
- [How to validate amounts at an API boundary](how-to/validate-api-input.md)
- [How to exchange amounts in other systems' formats](how-to/exchange-wire-formats.md)
- [How to write amounts in words](how-to/write-amounts-in-words.md)
- [How to send amounts to payment processors](how-to/send-amounts-to-payment-processors.md)

**Storage**

- [How to store money in a database](how-to/store-money-in-a-database.md), then [Prisma](how-to/prisma.md), [Drizzle](how-to/drizzle.md), [Kysely](how-to/kysely.md), [TypeORM](how-to/typeorm.md) or [node-postgres](how-to/node-postgres.md)

**Your project**

- [How to test code that uses money](how-to/test-code-that-uses-money.md)
- [How to keep bundles small](how-to/keep-bundles-small.md)
- [How to use ducat from CommonJS](how-to/use-from-commonjs.md)
- [How to add your own methods to Money](how-to/add-your-own-methods.md)
- [How to migrate from dinero.js](how-to/migrate-from-dinero.md)

## Reference

[The entries](reference/README.md) lists every package entry: what it installs on `Money` and what it exports.

- The core: [`@ducatjs/money`](reference/money.md), [`/fn` and `/iso`](reference/fn.md), [`/all`](reference/all.md)
- Arithmetic and rounding: [`/allocate`](reference/allocate.md), [`/tax`](reference/tax.md), [`/math`](reference/math.md), [`/exact`](reference/exact.md), [`/policy`](reference/policy.md), [`/cash`](reference/cash.md), [`/pricing`](reference/pricing.md), [`/context`](reference/context.md), [`/finance`](reference/finance.md)
- Decimals: [`/fixed` and `/fixed/money`](reference/fixed.md)
- Conversion: [`/convert`](reference/convert.md), [rate sources](reference/rate-sources.md) (`/convert/ecb`, `/history`, `/boc`, `/fed`, `/boe`, `/hmrc`, `/fetch`, `/stripe-fx`, `/adyen-fx`)
- Text: [`/format`](reference/format.md), [`/parse`](reference/parse.md), [`/words`](reference/words.md)
- Currencies: [`/currencies`, `/territories`, `/historic` and `/crypto`](reference/currencies.md), [currency data and its sources](reference/currency-data.md)
- Payments and wire formats: [processors](reference/processors.md) (`/stripe`, `/adyen`, `/checkout`, `/paypal`, `/braintree`, `/klarna`), [`/wire`](reference/wire.md)
- Databases: [`/prisma`](reference/prisma.md), [`/drizzle/*`](reference/drizzle.md), [`/kysely`](reference/kysely.md), [`/typeorm`](reference/typeorm.md), [`/pg`](reference/pg.md)
- Validation and tests: [`/zod` and `/valibot`](reference/schemas.md), [`/testing`](reference/testing.md)
- [Known limitations](reference/limitations.md)

## Explanation

- [About the representation](explanation/representation.md): integer minor units in a JS number, with a bigint fallback
- [About rounding](explanation/rounding.md): why rounding is explicit and happens once
- [About exactness](explanation/exactness.md): no floats, and the strict decimal grammar
- [About modules](explanation/modules.md): opt-in modules, installed methods and `/fn`
- [About storing amounts](explanation/storage.md): decimal strings, minor units and changing exponents
- [What is proved](explanation/proofs.md): the Lean proofs and what is only tested
- [How ducat is tested](explanation/how-ducat-is-tested.md), and the [equivalent mutants](explanation/equivalent-mutants.md) its mutation run leaves
- [Decisions](explanation/decisions.md): the product decisions, with their reasons
- [How ducat compares](explanation/comparison.md): correctness, speed and size against other libraries
- [The finance module's design](explanation/finance-design.md)
