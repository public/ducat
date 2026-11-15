//! The database-library independent core of [`ducat-sqlx`] and [`ducat-diesel`]: exact decimals
//! (units and scale) with their text grammar, NUMERIC(p, s) column sizes and the check that a
//! column holds a value unchanged, Postgres NUMERIC's base-10000 digits and binary format, and
//! ducat's composite money type (its text and binary record forms and its DDL).
//!
//! This is an implementation detail of those two crates, with no stability promise: use theirs.
//! It exists because their public types (`Decimal`, `DecimalColumnSize`, `Error`…) must be local
//! to each crate (Rust's orphan rule: sqlx's and diesel's traits can only be implemented for a
//! crate's own types), while the algorithms behind them are the same. Each crate wraps these
//! types and converts [`Error`] into its own.
//!
//! [`ducat-sqlx`]: https://github.com/public/ducat/tree/main/rust/crates/ducat-sqlx
//! [`ducat-diesel`]: https://github.com/public/ducat/tree/main/rust/crates/ducat-diesel
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod decimal;
mod error;
pub mod numeric;
pub mod record;

pub use decimal::{ColumnSize, Decimal};
pub use error::Error;

/// Checks that an amount at `scale` is at `currency`'s exponent, the one scale a column of minor
/// units or a fixed-currency decimal stores (ducat's `checkIsoScale`).
///
/// # Errors
///
/// [`Error::ScaleMismatch`].
pub fn check_exponent_scale(currency: ducat::CurrencyCode, scale: u16) -> Result<(), Error> {
    let expected = u16::from(currency.exponent());
    if scale != expected {
        return Err(Error::ScaleMismatch { scale, expected });
    }
    Ok(())
}
