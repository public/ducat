//! Locale formatting and parsing of money for [`ducat`]: a port of ducat's `@ducatjs/money/format`
//! and `@ducatjs/money/parse`, from CLDR 48's data (the repository's `data/cldr/`, with the
//! values ICU 78.3 ships instead of CLDR's in `data/icu/`), with no ICU.

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]
#![warn(missing_docs)]

extern crate alloc;

#[rustfmt::skip]
#[allow(dead_code)]
mod data;
mod error;
#[rustfmt::skip]
#[allow(dead_code)]
mod icu;
mod locale;
#[allow(dead_code)]
mod tables;

pub use error::Error;
pub use locale::{Locale, locales};

/// The CLDR release the data comes from.
pub const CLDR_VERSION: &str = data::CLDR_VERSION;
/// The ICU release whose overrides of CLDR's data are applied.
pub const ICU_VERSION: &str = icu::ICU_VERSION;
