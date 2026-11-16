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

/// The scale read from a scale column (ducat's `readScale`): an integer from 0 to
/// [`ducat::MAX_SCALE`], capped like parsed decimals so that a corrupt row can't build a huge
/// power of ten. `None` is a NULL scale.
///
/// # Errors
///
/// [`Error::InvalidScaleColumn`] for NULL, a negative scale or one beyond [`ducat::MAX_SCALE`].
pub fn read_scale(value: Option<i64>) -> Result<u16, Error> {
    value
        .and_then(|scale| u16::try_from(scale).ok())
        .filter(|scale| *scale <= ducat::MAX_SCALE)
        .ok_or(Error::InvalidScaleColumn(value))
}

/// The units and scale to store in a minor-unit column with a scale column (ducat's
/// `minorToDriver` with a scale): the amount in units of 10^−scale, at the money's own scale,
/// and that scale.
///
/// # Errors
///
/// [`Error::OutOfRange`] beyond ±(2^63 − 1) units, where MySQL outside strict mode would store
/// the nearest limit instead.
pub fn scaled_units(units: &ducat::Int, scale: u16) -> Result<(i64, i16), Error> {
    let units = units.to_i64().ok_or(Error::OutOfRange)?;
    // ducat keeps scales within MAX_SCALE (1000), which a SMALLINT holds
    let scale = i16::try_from(scale).map_err(|_| Error::Ducat(ducat::Error::InvalidScale))?;
    Ok((units, scale))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_scale_takes_0_to_max_scale() {
        // ducat's test/sql.test.ts readScale cases
        assert_eq!(read_scale(Some(0)), Ok(0));
        assert_eq!(read_scale(Some(2)), Ok(2));
        assert_eq!(read_scale(Some(1000)), Ok(1000));
        for value in [
            None,
            Some(-1),
            Some(1001),
            Some(i64::MAX),
            Some(i64::MIN),
            Some(65_536),
        ] {
            assert_eq!(read_scale(value), Err(Error::InvalidScaleColumn(value)));
        }
    }

    #[test]
    fn scaled_units_refuses_beyond_bigint() {
        let max = ducat::Int::from(i64::MAX);
        assert_eq!(scaled_units(&max, 9), Ok((i64::MAX, 9)));
        let beyond = ducat::Int::from(i128::from(i64::MAX) + 1);
        assert_eq!(scaled_units(&beyond, 9), Err(Error::OutOfRange));
    }
}
