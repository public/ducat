//! Checkout.com's amounts (<https://www.checkout.com/docs/payments/accept-payments/format-the-amount-value>,
//! encoded in `data/checkout.json`): an integer at Checkout.com's exponent:
//!
//! - the full amount: BIF DJF GNF ISK JPY KMF KRW PYG RWF UGX VUV VND XAF XOF XPF;
//! - divided by 1000, last digit 0: BHD IQD JOD KWD LYD OMR TND;
//! - divided by 100 for every other currency. CLP is here too (ISO says 0 decimals), and a payment
//!   request's last two digits must be 00 (5000 CLP is 500000); the Standalone API is exempt.
//!
//! Negative amounts are refused: refunds are sent as positive amounts.

use alloc::string::String;

use super::tables::CHECKOUT;
use super::{Sign, from_integer, lookup, to_integer};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Money, Rounding};

/// Checkout.com's rule for a currency.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CheckoutRule {
    /// The exponent Checkout.com's API uses (CLP 2, JPY 0, BHD 3).
    pub exponent: u8,
    /// The multiple a payment amount must be: 100 for CLP, 10 for the three-decimal currencies.
    pub multiple: u64,
    /// The multiple an authentication request to the Standalone API must be (CLP 1).
    pub standalone_multiple: u64,
}

/// A row of Checkout.com's table (ducat's `CHECKOUT_RULES`): a currency and its rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct CheckoutEntry {
    /// The currency code, in uppercase.
    pub code: &'static str,
    /// As [`CheckoutRule::exponent`].
    pub exponent: u8,
    /// As [`CheckoutRule::multiple`].
    pub multiple: u64,
    /// As [`CheckoutRule::standalone_multiple`].
    pub standalone_multiple: u64,
}

impl CheckoutEntry {
    /// The entry's rule, as [`rule`] gives it.
    #[must_use]
    pub const fn rule(&self) -> CheckoutRule {
        CheckoutRule {
            exponent: self.exponent,
            multiple: self.multiple,
            standalone_multiple: self.standalone_multiple,
        }
    }
}

/// Every currency Checkout.com lists with its rule, sorted by code: ducat's `CHECKOUT_RULES`
/// (code → `[exponent, multiple, standaloneMultiple]`) as a slice.
///
/// ```
/// use ducat::processors::checkout;
///
/// let clp = checkout::rules().iter().find(|entry| entry.code == "CLP").unwrap();
/// assert_eq!((clp.exponent, clp.multiple, clp.standalone_multiple), (2, 100, 1));
/// ```
#[must_use]
pub fn rules() -> &'static [CheckoutEntry] {
    &CHECKOUT
}

/// Checkout.com's rule for a currency (case-insensitive), or `None` for one it doesn't list.
#[must_use]
pub fn rule(currency: &str) -> Option<CheckoutRule> {
    lookup(&CHECKOUT, currency, false, |entry| entry.code).map(CheckoutEntry::rule)
}

/// Whether Checkout.com lists the currency (case-insensitive).
#[must_use]
pub fn is_currency(currency: &str) -> bool {
    rule(currency).is_some()
}

/// The exponent Checkout.com's API uses for a currency.
///
/// # Errors
///
/// [`Error::UnsupportedCurrency`] for a currency it doesn't list.
pub fn exponent(currency: &str) -> Result<u8, Error> {
    rule(currency)
        .map(|rule| rule.exponent)
        .ok_or(Error::UnsupportedCurrency)
}

/// How a Checkout.com amount is made.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CheckoutOptions {
    /// An authentication request to the Standalone API, where CLP's "last two digits 00" rule
    /// doesn't apply.
    pub standalone: bool,
    /// How to round when Checkout.com needs a coarser amount; [`Rounding::Unnecessary`] (the
    /// default) refuses.
    pub rounding: Rounding,
}

impl Default for CheckoutOptions {
    /// A payment request, never rounded.
    fn default() -> Self {
        Self {
            standalone: false,
            rounding: Rounding::Unnecessary,
        }
    }
}

/// `{ amount, currency }` for a payment request.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CheckoutAmount {
    /// The integer amount.
    pub amount: i64,
    /// The currency code, in uppercase.
    pub currency: String,
}

fn to_amount(
    amount: &crate::amount::Amount,
    currency: CurrencyCode,
    options: &CheckoutOptions,
) -> Result<i64, Error> {
    let rule = rule(currency.as_str()).ok_or(Error::UnsupportedCurrency)?;
    let multiple = if options.standalone {
        rule.standalone_multiple
    } else {
        rule.multiple
    };
    // "be greater than zero", except 0 for a card verification; refunds are positive
    to_integer(
        amount,
        rule.exponent,
        multiple,
        options.rounding,
        Sign::NonNegative,
    )
}

impl<C: Currency> Money<C> {
    /// The integer `amount` to send: 5000 CLP is 500000.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] when a coarser amount is needed and `options.rounding` is
    /// [`Rounding::Unnecessary`] (CLP payments need whole units; the three-decimal currencies a
    /// last digit of 0); [`Error::NegativeAmount`]; [`Error::UnsupportedCurrency`];
    /// [`Error::AmountTooLarge`] beyond 2^53 − 1.
    pub fn to_checkout_amount(&self, options: &CheckoutOptions) -> Result<i64, Error> {
        to_amount(&self.amount, C::CODE, options)
    }

    /// `{ amount, currency }` for a payment request, the code in uppercase (as ducat's
    /// `toCheckout`, for a custom currency defined in lowercase).
    ///
    /// # Errors
    ///
    /// As [`Money::to_checkout_amount`].
    pub fn to_checkout(&self, options: &CheckoutOptions) -> Result<CheckoutAmount, Error> {
        Ok(CheckoutAmount {
            amount: self.to_checkout_amount(options)?,
            currency: C::CODE.as_str().to_ascii_uppercase(),
        })
    }

    /// Reads a Checkout.com amount: 500000 CLP from Checkout.com is 5000 CLP.
    ///
    /// # Errors
    ///
    /// [`Error::UnsupportedCurrency`].
    pub fn from_checkout(amount: i64) -> Result<Self, Error> {
        Ok(Self::from_amount(from_integer(
            amount,
            exponent(C::CODE.as_str())?,
            C::CODE,
        )))
    }
}

impl AnyMoney {
    /// As [`Money::to_checkout_amount`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_checkout_amount`].
    pub fn to_checkout_amount(&self, options: &CheckoutOptions) -> Result<i64, Error> {
        to_amount(&self.amount, self.currency(), options)
    }

    /// As [`Money::to_checkout`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_checkout_amount`].
    pub fn to_checkout(&self, options: &CheckoutOptions) -> Result<CheckoutAmount, Error> {
        Ok(CheckoutAmount {
            amount: self.to_checkout_amount(options)?,
            currency: self.currency().as_str().to_ascii_uppercase(),
        })
    }

    /// As [`Money::from_checkout`], in `currency`.
    ///
    /// # Errors
    ///
    /// As [`Money::from_checkout`].
    pub fn from_checkout(amount: i64, currency: CurrencyCode) -> Result<Self, Error> {
        Ok(Self::from_parts(
            from_integer(amount, exponent(currency.as_str())?, currency),
            currency,
        ))
    }
}
