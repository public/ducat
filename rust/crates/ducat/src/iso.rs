//! A zero-sized marker type for every ISO 4217 currency with a minor unit, generated from ISO 4217
//! List One: `Money<Eur>`, `Money<Jpy>`.
//!
//! ```
//! use ducat::Money;
//! use ducat::iso::{Eur, Jpy};
//!
//! let price: Money<Eur> = "12.34".parse()?;
//! let yen: Money<Jpy> = "1000".parse()?;
//! assert_eq!(price.to_string(), "12.34 EUR");
//! assert_eq!(yen.scale(), 0);
//! # Ok::<(), ducat::Error>(())
//! ```

pub use crate::iso_table::*;
