//! Klarna's amounts (Klarna Payments and Order Management, encoded in `data/klarna.json`): integers
//! "in minor units according to the ISO 4217 standard", in the one local currency of each purchase
//! country: 25 EUR is 2500, 1000 HUF is 100000 (fillér; PayPal sends HUF without decimals).
//! Negative amounts pass through, for discount order lines.

use super::tables::KLARNA;
use super::{ExponentEntry, Sign, from_integer, lookup, to_integer};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Money, Rounding};

/// Every currency Klarna lists with its exponent, sorted by code: ducat's `KLARNA_EXPONENTS`
/// (code → exponent) as a slice.
///
/// ```
/// use ducat::processors::klarna;
///
/// let entry = klarna::exponents().iter().find(|entry| entry.code == "EUR").unwrap();
/// assert_eq!(entry.exponent, 2);
/// ```
#[must_use]
pub fn exponents() -> &'static [ExponentEntry] {
    &KLARNA
}

/// The ISO 4217 exponent of a Klarna purchase currency (case-insensitive), or `None` for any other.
#[must_use]
pub fn rule(currency: &str) -> Option<u8> {
    lookup(&KLARNA, currency, false, |entry| entry.code).map(|entry| entry.exponent)
}

/// Whether the currency is one of Klarna's purchase currencies (case-insensitive).
#[must_use]
pub fn is_currency(currency: &str) -> bool {
    rule(currency).is_some()
}

/// As [`rule`].
///
/// # Errors
///
/// [`Error::UnsupportedCurrency`] for a currency that isn't a Klarna purchase currency.
pub fn exponent(currency: &str) -> Result<u8, Error> {
    rule(currency).ok_or(Error::UnsupportedCurrency)
}

fn to_amount(
    amount: &crate::amount::Amount,
    currency: CurrencyCode,
    rounding: Rounding,
) -> Result<i64, Error> {
    to_integer(amount, exponent(currency.as_str())?, 1, rounding, Sign::Any)
}

impl<C: Currency> Money<C> {
    /// The integer for any Klarna amount field: 25 EUR is 2500. A bare number, because Klarna
    /// gives the currency once per order (`purchase_currency`).
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] for more decimals than the currency has and
    /// [`Rounding::Unnecessary`]; [`Error::UnsupportedCurrency`]; [`Error::AmountTooLarge`] beyond
    /// 2^53 − 1.
    pub fn to_klarna(&self, rounding: Rounding) -> Result<i64, Error> {
        to_amount(&self.amount, C::CODE, rounding)
    }

    /// Reads a Klarna amount field: 2500 EUR from Klarna is 25.00 EUR.
    ///
    /// # Errors
    ///
    /// [`Error::UnsupportedCurrency`].
    pub fn from_klarna(amount: i64) -> Result<Self, Error> {
        Ok(Self::from_amount(from_integer(
            amount,
            exponent(C::CODE.as_str())?,
            C::CODE,
        )))
    }
}

impl AnyMoney {
    /// As [`Money::to_klarna`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_klarna`].
    pub fn to_klarna(&self, rounding: Rounding) -> Result<i64, Error> {
        to_amount(&self.amount, self.currency(), rounding)
    }

    /// As [`Money::from_klarna`], in `currency`.
    ///
    /// # Errors
    ///
    /// As [`Money::from_klarna`].
    pub fn from_klarna(amount: i64, currency: CurrencyCode) -> Result<Self, Error> {
        Ok(Self::from_parts(
            from_integer(amount, exponent(currency.as_str())?, currency),
            currency,
        ))
    }
}
