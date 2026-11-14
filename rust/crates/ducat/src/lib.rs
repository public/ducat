//! Exact, typed money: a Rust port of [@ducatjs/money](https://github.com/public/ducat), verified
//! against ducat's conformance suite.
//!
//! - [`Money<C>`] is an amount in a currency known at compile time (`Money<Eur>`), and
//!   [`AnyMoney`] one whose currency is known only at run time. Both are an `i128` count of
//!   10^−scale units, `Copy`, and never use floats in arithmetic.
//! - Every operation that may round takes a [`Rounding`]; there is no default.
//! - Every factor (multiplier, divisor, rate) is an exact [`Ratio`].
//! - Fallible operations return [`Result`] with an [`Error`].
//!
//! ```
//! use ducat::{AnyMoney, Money, Rounding};
//! use ducat::iso::{Eur, Gbp};
//!
//! let net: Money<Gbp> = "9.99".parse()?;
//! assert_eq!(net.divide("1.2", Rounding::HalfEven)?.to_string(), "8.32 GBP");
//!
//! let bill: Money<Eur> = "100.00".parse()?;
//! let third = bill.divide(3, Rounding::Trunc)?;
//! assert_eq!(third.to_decimal(), "33.33");
//!
//! let any: AnyMoney = "12.34 EUR".parse()?;
//! assert_eq!(Money::<Eur>::try_from(any)?, "12.34".parse::<Money<Eur>>()?);
//! # Ok::<(), ducat::Error>(())
//! ```
#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]
#![warn(missing_docs)]

extern crate alloc;

/// Defines the ISO marker types, from the generated table.
#[cfg(feature = "iso")]
macro_rules! iso_markers {
    ($($name:ident = $code:literal, $exponent:literal, $doc:literal;)*) => {$(
        #[doc = $doc]
        #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name;

        impl $crate::Currency for $name {
            const CODE: $crate::CurrencyCode = $crate::currency::__iso_or_panic($code);
        }
    )*};
}

#[cfg(feature = "allocate")]
pub mod allocate;
mod amount;
mod any;
#[cfg(feature = "cash")]
mod cash;
mod currency;
mod decimal;
mod error;
#[cfg(feature = "iso")]
pub mod iso;
#[rustfmt::skip] // generated: tests/iso_table.rs checks it byte for byte
mod iso_table;
mod money;
mod ratio;
mod rounding;
#[cfg(feature = "serde")]
mod serde_impl;
mod wide;

pub use amount::Factor;
pub use any::AnyMoney;
#[doc(hidden)]
pub use currency::__custom_or_panic;
pub use currency::{Currency, CurrencyCode, MAX_CUSTOM_EXPONENT};
pub use decimal::MAX_SCALE;
pub use error::{Error, ErrorKind};
pub use iso_table::ISO_4217_PUBLISHED;
pub use money::Money;
pub use ratio::Ratio;
pub use rounding::Rounding;
