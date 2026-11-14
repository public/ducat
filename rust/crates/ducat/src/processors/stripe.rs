//! Stripe's amounts (<https://docs.stripe.com/currencies>, encoded in `data/stripe.json`): an
//! integer at Stripe's exponent, which is ISO's except where Stripe documents otherwise:
//!
//! - zero-decimal: BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF (MGA: ISO says 2);
//! - ISK and UGX: two-decimal values whose last two digits are 00 (5 ISK is 500);
//! - HUF and TWD: two decimals for charges, whole units for payouts;
//! - BHD JOD KWD OMR TND: three decimals, the last digit 0.

use alloc::string::String;

use super::tables::STRIPE;
use super::{Sign, from_integer, lookup, to_integer};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Money, Rounding};

/// Stripe's rule for a presentment currency.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct StripeRule {
    /// The exponent Stripe's API uses (ISK 2, JPY 0, KWD 3, MGA 0).
    pub exponent: u8,
    /// The multiple a charge amount must be: 100 for ISK and UGX (two-decimal values ending in 00),
    /// 10 for the three-decimal currencies, else 1.
    pub charge_multiple: u64,
    /// The multiple a payout amount must be: as a charge's, and 100 for HUF and TWD (whole units).
    pub payout_multiple: u64,
}

/// Stripe's rule for a currency (case-insensitive), or `None` when it isn't a presentment currency.
#[must_use]
pub fn rule(currency: &str) -> Option<StripeRule> {
    lookup(&STRIPE, currency, false, |entry| entry.0).map(|&(_, exponent, charge, payout)| {
        StripeRule {
            exponent,
            charge_multiple: charge,
            payout_multiple: payout,
        }
    })
}

/// Whether Stripe supports the currency as a presentment currency (case-insensitive).
#[must_use]
pub fn is_currency(currency: &str) -> bool {
    rule(currency).is_some()
}

/// The exponent Stripe's API uses for a currency (ISK 2, JPY 0, KWD 3, MGA 0).
///
/// # Errors
///
/// [`Error::UnsupportedCurrency`] for a currency Stripe doesn't present in.
pub fn exponent(currency: &str) -> Result<u8, Error> {
    rule(currency)
        .map(|rule| rule.exponent)
        .ok_or(Error::UnsupportedCurrency)
}

/// How a Stripe amount is made.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct StripeOptions {
    /// A payout, with its stricter rules (HUF and TWD: whole units).
    pub payout: bool,
    /// How to round when Stripe needs a coarser amount; [`Rounding::Unnecessary`] (the default)
    /// refuses.
    pub rounding: Rounding,
}

impl Default for StripeOptions {
    /// A charge, never rounded.
    fn default() -> Self {
        Self {
            payout: false,
            rounding: Rounding::Unnecessary,
        }
    }
}

/// `{ amount, currency }` for a PaymentIntent, with Stripe's lowercase currency code.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct StripeAmount {
    /// The integer amount.
    pub amount: i64,
    /// The currency code in lowercase, as Stripe's API takes it.
    pub currency: String,
}

fn to_amount(
    amount: &crate::amount::Amount,
    currency: CurrencyCode,
    options: &StripeOptions,
) -> Result<i64, Error> {
    let rule = rule(currency.as_str()).ok_or(Error::UnsupportedCurrency)?;
    let multiple = if options.payout {
        rule.payout_multiple
    } else {
        rule.charge_multiple
    };
    to_integer(amount, rule.exponent, multiple, options.rounding, Sign::Any)
}

impl<C: Currency> Money<C> {
    /// The integer `amount` to send to Stripe: 5 ISK is 500.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] when Stripe needs a coarser amount and `options.rounding` is
    /// [`Rounding::Unnecessary`] (ISK and UGX need whole units; payouts of HUF and TWD too; the
    /// three-decimal currencies a last digit of 0); [`Error::UnsupportedCurrency`];
    /// [`Error::AmountTooLarge`] beyond 2^53 − 1.
    pub fn to_stripe_amount(&self, options: &StripeOptions) -> Result<i64, Error> {
        to_amount(&self.amount, C::CODE, options)
    }

    /// `{ amount, currency }` with Stripe's lowercase code.
    ///
    /// # Errors
    ///
    /// As [`Money::to_stripe_amount`].
    pub fn to_stripe(&self, options: &StripeOptions) -> Result<StripeAmount, Error> {
        Ok(StripeAmount {
            amount: self.to_stripe_amount(options)?,
            currency: C::CODE.as_str().to_ascii_lowercase(),
        })
    }

    /// Reads a Stripe amount (from a webhook, say): 500 ISK from Stripe is 5 ISK.
    ///
    /// # Errors
    ///
    /// [`Error::UnsupportedCurrency`].
    pub fn from_stripe(amount: i64) -> Result<Self, Error> {
        Ok(Self::from_amount(from_integer(
            amount,
            exponent(C::CODE.as_str())?,
            C::CODE,
        )))
    }
}

impl AnyMoney {
    /// As [`Money::to_stripe_amount`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_stripe_amount`].
    pub fn to_stripe_amount(&self, options: &StripeOptions) -> Result<i64, Error> {
        to_amount(&self.amount, self.currency(), options)
    }

    /// As [`Money::to_stripe`].
    ///
    /// # Errors
    ///
    /// As [`Money::to_stripe_amount`].
    pub fn to_stripe(&self, options: &StripeOptions) -> Result<StripeAmount, Error> {
        Ok(StripeAmount {
            amount: self.to_stripe_amount(options)?,
            currency: self.currency().as_str().to_ascii_lowercase(),
        })
    }

    /// As [`Money::from_stripe`], in `currency`.
    ///
    /// # Errors
    ///
    /// As [`Money::from_stripe`].
    pub fn from_stripe(amount: i64, currency: CurrencyCode) -> Result<Self, Error> {
        Ok(Self::from_parts(
            from_integer(amount, exponent(currency.as_str())?, currency),
            currency,
        ))
    }
}
