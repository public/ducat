//! What can go wrong formatting or parsing.

use core::fmt;

/// An error from formatting or parsing.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Error {
    /// A locale tag that isn't a structurally valid BCP 47 tag (`Intl`'s `RangeError`).
    InvalidLocale,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidLocale => f.write_str("not a valid BCP 47 locale tag"),
        }
    }
}

impl core::error::Error for Error {}
