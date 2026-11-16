# ducat for Rust

A Rust port of ducat (`@ducatjs/money`): exact, typed money, verified against ducat's language-neutral conformance
suite in [`spec/`](../spec). The core crate is `ducat`; none of the crates is published yet.

```rust
use ducat::{Money, Rounding};
use ducat::iso::Eur;

let price: Money<Eur> = "25.00".parse()?;
let gross = price.multiply("1.075", Rounding::HalfEven)?;
assert_eq!(gross.to_string(), "26.88 EUR");
```

- `Money<C>` (a currency known at compile time) and `AnyMoney` (one known at run time), both an exact count of
  10^−scale units of any size, as in ducat: machine arithmetic while it is small, arbitrary precision
  beyond. No floats in arithmetic, ever.
- Every operation that may round takes a `Rounding`, one of ducat's nine modes or `Unnecessary`.
- Factors and rates are exact `Ratio`s.

Status: the core (parsing, rounding, add, subtract, multiply, divide, convert at a rate, compare, serde), allocation
(allocate, split, instalments, schedule, chunk), cash rounding, tax (percentages, discounts, adding and extracting
tax), `Fixed` decimals, `ExactMoney`, exchange rates (`Rate`, with their metadata, rate providers, `MoneyBag` and the rate-source parsers), rate fetchers for the ECB and the Bank of Canada (the `ducat-fetch` crate, sans-IO with a blocking ureq transport), amounts and numbers in words (the `ducat-words` crate), locale formatting and parsing (the `ducat-format` crate), finance (day counts, interest, loans, savings,
proration), Excel's functions, rounding policies, pricing and tiers, math, wire formats (google.type.Money, ISO 20022, dinero.js), currency data (historic codes, territories, crypto units, cash
rules), payment processors (Stripe, Adyen, Checkout.com, PayPal, Braintree, Klarna), Adyen's account time zone (the `tz` feature, off by default, with the IANA tz database 2026f bundled through jiff), proptest strategies and assertion macros (`ducat::testing`, the `proptest` feature, which needs Rust 1.88), exact money columns for sqlx and diesel (the `ducat-sqlx` and `ducat-diesel` crates: Postgres NUMERIC, BIGINT and the money composite, MySQL DECIMAL, SQLite TEXT and INTEGER), and the conformance runner. See [docs/design.md](docs/design.md).

## Conformance

The runner reads the repository's `spec/` and `data/` directly, so the Rust port is always checked against the spec
at the same commit. From `rust/`, `cargo test -p ducat --test it spec:: -- --nocapture` runs every vector and prints what passed, failed
and was skipped, and why, per area and operation.
