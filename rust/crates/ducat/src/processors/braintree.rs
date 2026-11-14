//! Braintree's amounts (<https://developer.paypal.com/braintree/docs/reference/general/currencies>,
//! encoded in `data/braintree.json`): `amount` is a decimal string in major units, "formatted like
//! '10' or '10.00'". The zero-decimal currencies take no decimals (BIF CLP DJF GNF ISK JPY KMF KRW
//! LAK PYG RWF UGX VND VUV XAF XOF XPF; LAK has 2 in ISO 4217), the others their ISO decimals.
//! Amounts must be greater than zero, refunds and credits included. Braintree has no currency field
//! on a transaction: the merchant account sets it.

use alloc::string::String;

use super::tables::BRAINTREE;
use super::{Sign, all_digits, from_decimal, lookup, to_decimal};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Money, Rounding};

/// The decimals Braintree takes for a currency (JPY 0, LAK 0, USD 2), case-insensitive, or `None`
/// for one it doesn't list.
#[must_use]
pub fn rule(currency: &str) -> Option<u8> {
    lookup(&BRAINTREE, currency, false, |entry| entry.0).map(|entry| entry.1)
}

/// Whether Braintree lists the currency (case-insensitive).
#[must_use]
pub fn is_currency(currency: &str) -> bool {
    rule(currency).is_some()
}

/// As [`rule`].
///
/// # Errors
///
/// [`Error::UnsupportedCurrency`] for a currency Braintree doesn't list.
pub fn exponent(currency: &str) -> Result<u8, Error> {
    rule(currency).ok_or(Error::UnsupportedCurrency)
}

fn to_amount(
    amount: &crate::amount::Amount,
    currency: CurrencyCode,
    rounding: Rounding,
) -> Result<String, Error> {
    // 81531 "Amount must be greater than zero"; 81501: credits are positive too
    to_decimal(
        amount,
        exponent(currency.as_str())?,
        rounding,
        Sign::Positive,
    )
}

/// "Can only contain numbers and one decimal point (e.g. x.xx)": `^[0-9]+(\.[0-9]+)?$`.
fn well_formed(amount: &str) -> bool {
    match amount.split_once('.') {
        None => all_digits(amount),
        Some((whole, fraction)) => all_digits(whole) && all_digits(fraction),
    }
}

fn from_amount_text(amount: &str, currency: CurrencyCode) -> Result<crate::amount::Amount, Error> {
    // the currency first, so an unlisted one is the error reported
    exponent(currency.as_str())?;
    if !well_formed(amount) {
        return Err(Error::Syntax);
    }
    from_decimal(amount, currency)
}

impl<C: Currency> Money<C> {
    /// The exact `amount` string: `"10.00"` for 10 USD, `"100"` for 100 JPY, `"5000"` for 5000 LAK.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] when Braintree needs fewer decimals (LAK) and `rounding` is
    /// [`Rounding::Unnecessary`]; [`Error::ZeroAmount`] and [`Error::NegativeAmount`];
    /// [`Error::UnsupportedCurrency`].
    pub fn to_braintree(&self, rounding: Rounding) -> Result<String, Error> {
        to_amount(&self.amount, C::CODE, rounding)
    }

    /// Reads a Braintree amount string exactly: `"10.00"` USD is 10.00 USD.
    ///
    /// # Errors
    ///
    /// [`Error::UnsupportedCurrency`]; [`Error::Syntax`] for anything but digits with an optional
    /// fraction (no sign).
    pub fn from_braintree(amount: &str) -> Result<Self, Error> {
        Ok(Self::from_amount(from_amount_text(amount, C::CODE)?))
    }
}

impl AnyMoney {
    /// As [`Money::to_braintree`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_braintree`].
    pub fn to_braintree(&self, rounding: Rounding) -> Result<String, Error> {
        to_amount(&self.amount, self.currency(), rounding)
    }

    /// As [`Money::from_braintree`], in `currency`.
    ///
    /// # Errors
    ///
    /// As [`Money::from_braintree`].
    pub fn from_braintree(amount: &str, currency: CurrencyCode) -> Result<Self, Error> {
        Ok(Self::from_parts(
            from_amount_text(amount, currency)?,
            currency,
        ))
    }
}
