# ducat-sql-core

**An internal detail of [ducat-sqlx](https://crates.io/crates/ducat-sqlx) and
[ducat-diesel](https://crates.io/crates/ducat-diesel), with no stability promise. Use those crates.**

It is published to crates.io only because they depend on it. It holds what they share: exact
decimals and their text grammar, NUMERIC(p, s) column sizes, Postgres NUMERIC's base-10000 digits
and binary format, and ducat's composite money type. Each of those crates has its own public types
(Rust's orphan rule: sqlx's and diesel's traits can only be implemented for a crate's own types)
and wraps these. Its items are `#[doc(hidden)]`, and any release may change them, whatever its
version number says.

License: MIT.
