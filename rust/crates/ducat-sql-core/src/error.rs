//! The core's error type.

use crate::ColumnSize;

/// Why a value couldn't be read or written; each crate converts it into its own `Error`, whose
/// variants of the same names document them.
#[derive(Clone, Debug, PartialEq, Eq)]
#[allow(missing_docs)] // documented on ducat-sqlx's and ducat-diesel's `Error`
pub enum Error {
    NotANumber,
    Infinite { negative: bool },
    Malformed(&'static str),
    OutOfRange,
    ScaleMismatch { scale: u16, expected: u16 },
    NullField(&'static str),
    InvalidColumnSize(ColumnSize),
    ColumnScaleBelowExponent { size: ColumnSize, exponent: u8 },
    WouldRound { size: ColumnSize, decimals: u16 },
    TooManyIntegerDigits { size: ColumnSize },
    Ducat(ducat::Error),
}

impl From<ducat::Error> for Error {
    fn from(error: ducat::Error) -> Self {
        Self::Ducat(error)
    }
}
