//! PayPal's amounts for the REST APIs (Orders v2, Payments v2;
//! <https://developer.paypal.com/api/rest/reference/currency-codes/>, encoded in
//! `data/paypal.json`): `value` is a decimal string in major units, with at most 15 digits before
//! the point. HUF, JPY and TWD take no decimals (`"1000"`, never `"1000.00"`; ISO gives HUF and TWD
//! 2); every other listed currency takes 2. Negative amounts are refused: refunds are positive.

use alloc::string::String;

use super::tables::PAYPAL;
use super::{Sign, all_digits, from_decimal, lookup, to_decimal};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Money, Rounding};

/// PayPal allows at most 15 digits before the decimal point.
const MAX_INTEGER_DIGITS: usize = 15;

/// The `value` field's maxLength in the Orders v2 schema.
const MAX_VALUE_LENGTH: usize = 32;

/// The decimals PayPal takes for a currency (JPY, HUF and TWD 0; the others 2), case-insensitive,
/// or `None` for one it doesn't list.
#[must_use]
pub fn rule(currency: &str) -> Option<u8> {
    lookup(&PAYPAL, currency, false, |entry| entry.0).map(|entry| entry.1)
}

/// Whether PayPal lists the currency (case-insensitive).
#[must_use]
pub fn is_currency(currency: &str) -> bool {
    rule(currency).is_some()
}

/// As [`rule`].
///
/// # Errors
///
/// [`Error::UnsupportedCurrency`] for a currency PayPal doesn't list.
pub fn exponent(currency: &str) -> Result<u8, Error> {
    rule(currency).ok_or(Error::UnsupportedCurrency)
}

/// A PayPal `money` object.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PayPalAmount {
    /// The currency code, in uppercase.
    pub currency_code: String,
    /// The exact decimal string.
    pub value: String,
}

fn to_value(
    amount: &crate::amount::Amount,
    currency: CurrencyCode,
    rounding: Rounding,
) -> Result<String, Error> {
    // "The amount must be a positive number"; zero stays allowed for breakdown fields such as a
    // zero tax_total
    let value = to_decimal(
        amount,
        exponent(currency.as_str())?,
        rounding,
        Sign::NonNegative,
    )?;
    let whole = value.split('.').next().unwrap_or("");
    if whole.len() > MAX_INTEGER_DIGITS {
        return Err(Error::AmountTooLarge);
    }
    Ok(value)
}

/// The Orders v2 schema's `value` pattern, `^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$`, and its
/// maxLength.
fn well_formed(value: &str) -> bool {
    if value.len() > MAX_VALUE_LENGTH {
        return false;
    }
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    match unsigned.split_once('.') {
        None => all_digits(unsigned),
        Some((whole, fraction)) => (whole.is_empty() || all_digits(whole)) && all_digits(fraction),
    }
}

fn from_value(value: &str, currency: CurrencyCode) -> Result<crate::amount::Amount, Error> {
    // the currency first, so an unlisted one is the error reported
    exponent(currency.as_str())?;
    if !well_formed(value) {
        return Err(Error::Syntax);
    }
    from_decimal(value, currency)
}

impl<C: Currency> Money<C> {
    /// The exact `value` string: `"10.99"` for 10.99 USD, `"1000"` for 1000 HUF.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] when PayPal needs fewer decimals (HUF, JPY, TWD) and `rounding` is
    /// [`Rounding::Unnecessary`]; [`Error::NegativeAmount`]; [`Error::AmountTooLarge`] for more than
    /// 15 digits before the point; [`Error::UnsupportedCurrency`].
    pub fn to_paypal_value(&self, rounding: Rounding) -> Result<String, Error> {
        to_value(&self.amount, C::CODE, rounding)
    }

    /// A PayPal `money` object.
    ///
    /// # Errors
    ///
    /// As [`Money::to_paypal_value`].
    pub fn to_paypal(&self, rounding: Rounding) -> Result<PayPalAmount, Error> {
        Ok(PayPalAmount {
            currency_code: String::from(C::CODE.as_str()),
            value: self.to_paypal_value(rounding)?,
        })
    }

    /// Reads a PayPal `value` exactly: `"230.00"` USD is 230.00 USD.
    ///
    /// # Errors
    ///
    /// [`Error::UnsupportedCurrency`]; [`Error::Syntax`] for a value outside the Orders v2 pattern
    /// or longer than 32 characters.
    pub fn from_paypal(value: &str) -> Result<Self, Error> {
        Ok(Self::from_amount(from_value(value, C::CODE)?))
    }
}

impl AnyMoney {
    /// As [`Money::to_paypal_value`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_paypal_value`].
    pub fn to_paypal_value(&self, rounding: Rounding) -> Result<String, Error> {
        to_value(&self.amount, self.currency(), rounding)
    }

    /// As [`Money::to_paypal`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_paypal_value`].
    pub fn to_paypal(&self, rounding: Rounding) -> Result<PayPalAmount, Error> {
        Ok(PayPalAmount {
            currency_code: String::from(self.currency().as_str()),
            value: self.to_paypal_value(rounding)?,
        })
    }

    /// As [`Money::from_paypal`], in `currency`.
    ///
    /// # Errors
    ///
    /// As [`Money::from_paypal`].
    pub fn from_paypal(value: &str, currency: CurrencyCode) -> Result<Self, Error> {
        Ok(Self::from_parts(from_value(value, currency)?, currency))
    }
}
