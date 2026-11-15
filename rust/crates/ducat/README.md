# ducat

Exact, typed money: a Rust port of [@ducatjs/money](https://github.com/public/ducat), verified
against ducat's language-neutral conformance suite.

- `Money<C>` is an amount in a currency known at compile time (`Money<Eur>`), and `AnyMoney` one
  whose currency is known only at run time. Both are an exact count of 10^−scale units of any size
  (machine arithmetic while it is small, arbitrary precision beyond), and never use floats in
  arithmetic.
- Every operation that may round takes a `Rounding`; there is no default.
- Every factor (multiplier, divisor, rate) is an exact `Ratio`.
- Fallible operations return `Result` with an `Error`.

```rust
use ducat::{AnyMoney, Money, Rounding};
use ducat::iso::{Eur, Gbp};

let net: Money<Gbp> = "9.99".parse()?;
assert_eq!(net.divide("1.2", Rounding::HalfEven)?.to_string(), "8.32 GBP");

let bill: Money<Eur> = "100.00".parse()?;
let third = bill.divide(3, Rounding::Trunc)?;
assert_eq!(third.to_decimal(), "33.33");

let any: AnyMoney = "12.34 EUR".parse()?;
assert_eq!(Money::<Eur>::try_from(any)?, "12.34".parse::<Money<Eur>>()?);
```

Beyond the core (parsing, rounding, arithmetic, conversion at a rate, comparison, serde), Cargo
features add allocation and splits, cash rounding, tax, `Fixed` decimals, `ExactMoney`, exchange
rates and the rate-source parsers (ECB, Bank of Canada, Federal Reserve, Bank of England, HMRC,
Stripe, Adyen), finance and Excel's functions, rounding policies, pricing, wire formats, currency
data and payment processors' amounts. Most are on by default; the core needs only `alloc`
(`default-features = false`). See the [API documentation](https://docs.rs/ducat) for each feature.

Companion crates: [ducat-words](https://crates.io/crates/ducat-words) (amounts in words),
[ducat-format](https://crates.io/crates/ducat-format) (locale formatting and parsing),
[ducat-sqlx](https://crates.io/crates/ducat-sqlx) and [ducat-diesel](https://crates.io/crates/ducat-diesel)
(money columns), [ducat-fetch](https://crates.io/crates/ducat-fetch) (reference-rate fetchers).

MSRV: Rust 1.85 (the `proptest` feature needs 1.88). License: MIT.
