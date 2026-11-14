# ducat for Rust

A Rust port of ducat (`@ducatjs/money`): exact, typed money, verified against ducat's language-neutral conformance
suite in [`spec/`](../spec). The crate is `ducat`; it isn't published yet.

```rust
use ducat::{Money, Rounding};
use ducat::iso::Eur;

let price: Money<Eur> = "25.00".parse()?;
let gross = price.multiply("1.075", Rounding::HalfEven)?;
assert_eq!(gross.to_string(), "26.88 EUR");
# Ok::<(), ducat::Error>(())
```

- `Money<C>` (a currency known at compile time) and `AnyMoney` (one known at run time), both an `i128` count of
  10^−scale units. No floats in arithmetic, ever.
- Every operation that may round takes a `Rounding`, one of ducat's nine modes or `Unnecessary`.
- Factors and rates are exact `Ratio`s.

Status: milestone 1, the core (parsing, rounding, add, subtract, multiply, divide, convert at a rate, compare, serde)
and the conformance runner. See [docs/design.md](docs/design.md).

## Conformance

The runner reads the repository's `spec/` and `data/` directly, so the Rust port is always checked against the spec
at the same commit. From `rust/`, `cargo test -p ducat --test spec` runs every vector and prints what passed, failed
and was skipped, and why, per area and operation.
