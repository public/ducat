//! Adyen's amounts (<https://docs.adyen.com/development-resources/currency-codes>, encoded in
//! `data/adyen.json`): an integer at Adyen's exponent. Adyen's table is authoritative where it
//! differs from ISO 4217: CLP 2 (ISO 0), ISK 2 (ISO 0), IDR 0 (ISO 2), CVE 0 (ISO 2). Codes are
//! looked up as given, in uppercase. The Terminal API takes major units instead.

use super::tables::ADYEN;
use super::{ExponentEntry, Sign, from_integer, lookup, to_integer};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Money, Rounding};

/// Every currency Adyen lists with its exponent, sorted by code: ducat's `ADYEN_EXPONENTS`
/// (code → exponent) as a slice.
///
/// ```
/// use ducat::processors::adyen;
///
/// let entry = adyen::exponents().iter().find(|entry| entry.code == "IDR").unwrap();
/// assert_eq!(entry.exponent, 0);
/// ```
#[must_use]
pub fn exponents() -> &'static [ExponentEntry] {
    &ADYEN
}

/// The exponent Adyen's API uses for a currency (CLP 2, ISK 2, IDR 0 and CVE 0 differ from ISO),
/// or `None` for a code not in its table. Unlike the other processors, the code is case-sensitive.
#[must_use]
pub fn rule(currency: &str) -> Option<u8> {
    lookup(&ADYEN, currency, true, |entry| entry.code).map(|entry| entry.exponent)
}

/// Whether Adyen lists the currency (its table, not ISO 4217).
#[must_use]
pub fn is_currency(currency: &str) -> bool {
    rule(currency).is_some()
}

/// As [`rule`].
///
/// # Errors
///
/// [`Error::UnsupportedCurrency`] for a code not in Adyen's table.
pub fn exponent(currency: &str) -> Result<u8, Error> {
    rule(currency).ok_or(Error::UnsupportedCurrency)
}

/// Adyen's `amount` object.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct AdyenAmount {
    /// The integer value at Adyen's exponent.
    pub value: i64,
    /// The currency.
    pub currency: CurrencyCode,
}

fn to_value(
    amount: &crate::amount::Amount,
    currency: CurrencyCode,
    rounding: Rounding,
) -> Result<i64, Error> {
    to_integer(amount, exponent(currency.as_str())?, 1, rounding, Sign::Any)
}

impl<C: Currency> Money<C> {
    /// Adyen's `amount` object: 15000 IDR is `{ value: 15000, currency: IDR }` (Adyen: IDR has 0
    /// decimals), and 5000 CLP `{ value: 500000, currency: CLP }` (CLP has 2).
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] when Adyen needs fewer decimals (IDR, CVE) and `rounding` is
    /// [`Rounding::Unnecessary`]; [`Error::UnsupportedCurrency`]; [`Error::AmountTooLarge`] beyond
    /// 2^53 − 1.
    pub fn to_adyen(&self, rounding: Rounding) -> Result<AdyenAmount, Error> {
        Ok(AdyenAmount {
            value: to_value(&self.amount, C::CODE, rounding)?,
            currency: C::CODE,
        })
    }

    /// Reads an Adyen amount value: 15000 IDR from Adyen is 15000 IDR.
    ///
    /// # Errors
    ///
    /// [`Error::UnsupportedCurrency`].
    pub fn from_adyen(value: i64) -> Result<Self, Error> {
        Ok(Self::from_amount(from_integer(
            value,
            exponent(C::CODE.as_str())?,
            C::CODE,
        )))
    }
}

impl AnyMoney {
    /// As [`Money::to_adyen`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_adyen`].
    pub fn to_adyen(&self, rounding: Rounding) -> Result<AdyenAmount, Error> {
        Ok(AdyenAmount {
            value: to_value(&self.amount, self.currency(), rounding)?,
            currency: self.currency(),
        })
    }

    /// Reads an Adyen `amount` object.
    ///
    /// # Errors
    ///
    /// As [`Money::from_adyen`].
    pub fn from_adyen(amount: AdyenAmount) -> Result<Self, Error> {
        Ok(Self::from_parts(
            from_integer(
                amount.value,
                exponent(amount.currency.as_str())?,
                amount.currency,
            ),
            amount.currency,
        ))
    }
}
