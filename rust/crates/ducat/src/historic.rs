//! Withdrawn ISO 4217 codes and a few non-ISO ones, with the exponent each had while it was current
//! and, for ISO codes, the month ISO withdrew it (ducat's `/historic`).
//!
//! The exponent is ISO's, from when the code was current: what stored minor units of it mean. It
//! isn't CLDR's display digits, nor a cash rule. A historic code is a currency outside today's ISO
//! 4217, so it never parses as one: `"HRK".parse::<CurrencyCode>()` is an error, and
//! [`CurrencyCode::historic`] builds it, as a code of its own.
//!
//! ```
//! use ducat::{AnyMoney, CurrencyCode};
//! use ducat::historic;
//!
//! let kuna = CurrencyCode::historic("HRK")?;
//! assert_eq!(kuna.exponent(), 2);
//! assert_eq!(historic::currency("HRK").and_then(|entry| entry.withdrawn()), Some("2023-01"));
//! assert!("HRK".parse::<CurrencyCode>().is_err());
//! assert_eq!(AnyMoney::parse("100", kuna)?.to_string(), "100.00 HRK");
//! # Ok::<(), ducat::Error>(())
//! ```

use crate::currency_data::{HISTORIC, ISO_4217_LIST_THREE_PUBLISHED};
use crate::{CurrencyCode, Error};

/// The publication date of the ISO 4217 List Three snapshot the table comes from.
pub const LIST_THREE_PUBLISHED: &str = ISO_4217_LIST_THREE_PUBLISHED;

/// One entry of the historic table.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct HistoricCurrency {
    code: CurrencyCode,
    name: &'static str,
    numeric: Option<&'static str>,
    withdrawn: Option<&'static str>,
}

impl HistoricCurrency {
    fn of(index: usize) -> Self {
        let (code, exponent, name, numeric, withdrawn) = HISTORIC[index];
        Self {
            code: CurrencyCode::build(code.as_bytes(), exponent),
            name,
            numeric,
            withdrawn,
        }
    }

    /// The code, with the exponent ISO gave it while it was current.
    #[must_use]
    pub const fn code(&self) -> CurrencyCode {
        self.code
    }

    /// The exponent ISO gave it while it was current: what stored minor units of it mean.
    #[must_use]
    pub const fn exponent(&self) -> u8 {
        self.code.exponent()
    }

    /// The name ISO 4217 List Three gives it (for a non-ISO code, a descriptive name).
    #[must_use]
    pub const fn name(&self) -> &'static str {
        self.name
    }

    /// The ISO 4217 numeric code; `None` for a code that was never ISO (CNH).
    #[must_use]
    pub const fn numeric(&self) -> Option<&'static str> {
        self.numeric
    }

    /// The year and month ISO 4217 withdrew it (`"2023-01"`), from List Three: the latest date of
    /// its entry, and of the entry with the latest one for a code withdrawn country by country.
    /// `None` for a code that was never ISO.
    #[must_use]
    pub const fn withdrawn(&self) -> Option<&'static str> {
        self.withdrawn
    }
}

/// The table entry for a code, or `None` for a code that isn't in it.
#[must_use]
pub fn currency(code: &str) -> Option<HistoricCurrency> {
    HISTORIC
        .binary_search_by(|entry| entry.0.cmp(code))
        .ok()
        .map(HistoricCurrency::of)
}

/// Every entry of the table, by code.
pub fn currencies() -> impl ExactSizeIterator<Item = HistoricCurrency> {
    (0..HISTORIC.len()).map(HistoricCurrency::of)
}

impl CurrencyCode {
    /// A withdrawn ISO 4217 code or a non-ISO one from the historic table, with the exponent ISO
    /// gave it while it was current (ducat's `defineHistoricCurrencies`). It equals
    /// `CurrencyCode::custom(code, exponent)`, and never an active ISO code.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCurrency`] for a code that isn't in the historic table.
    pub fn historic(code: &str) -> Result<Self, Error> {
        currency(code)
            .map(|entry| entry.code)
            .ok_or(Error::UnknownCurrency)
    }
}
