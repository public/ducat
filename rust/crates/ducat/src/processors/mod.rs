//! Payment processors: the amount each processor's API expects, and back (ducat's `/stripe`,
//! `/adyen`, `/checkout`, `/paypal`, `/braintree` and `/klarna`), one module and feature each.
//!
//! The rules are each processor's own, generated from `data/<processor>.json`, not ISO 4217's
//! where they differ: Stripe sends ISK and UGX as two-decimal values ending in 00, Adyen gives IDR
//! no decimals and CLP two, PayPal sends HUF without decimals. Every conversion is exact:
//!
//! - **to the processor**, a conversion never rounds unless it is given a mode: with
//!   [`Rounding::Unnecessary`] (every default here) it refuses with
//!   [`Error::Rounding`] when the processor needs a coarser amount, and a
//!   mode rounds once to the processor's exponent, and once more to its multiple where it has one.
//!   Signs are checked after rounding, and an integer amount beyond 2^53 − 1 is
//!   [`Error::AmountTooLarge`], as in ducat, where amounts are JSON
//!   numbers;
//! - **from the processor**, the amount comes back at the currency's exponent when that is exact,
//!   and otherwise at the scale it came with, so a processor's extra precision is kept. Any `i64`
//!   is read: the 2^53 − 1 limit applies on the way to the processor only (ducat refuses only
//!   JavaScript numbers that aren't safe integers, and reads any `bigint`).
//!
//! ```
//! use ducat::Money;
//! use ducat::iso::{Isk, Usd};
//! use ducat::processors::stripe::StripeOptions;
//!
//! let five: Money<Isk> = "5".parse()?;
//! assert_eq!(five.to_stripe_amount(&StripeOptions::default())?, 500);
//! assert_eq!(Money::<Isk>::from_stripe(500)?.to_string(), "5 ISK");
//! let price: Money<Usd> = "10.99".parse()?;
//! assert_eq!(price.to_paypal_value(ducat::Rounding::Unnecessary)?, "10.99");
//! # Ok::<(), ducat::Error>(())
//! ```

#[cfg(feature = "adyen")]
pub mod adyen;
#[cfg(feature = "braintree")]
pub mod braintree;
#[cfg(feature = "checkout")]
pub mod checkout;
#[cfg(feature = "klarna")]
pub mod klarna;
#[cfg(feature = "paypal")]
pub mod paypal;
#[cfg(feature = "stripe")]
pub mod stripe;
#[rustfmt::skip] // generated: tests/it/processor_tables.rs checks it byte for byte
mod tables;

use crate::amount::Amount;
use crate::rounding::{Rounding, rescale_ratio};
use crate::{CurrencyCode, Error, Int};

/// A row of a processor's exponent table (ducat's `ADYEN_EXPONENTS`, `PAYPAL_EXPONENTS`,
/// `BRAINTREE_EXPONENTS` and `KLARNA_EXPONENTS`): a currency the processor lists and the exponent
/// its API uses for it.
#[cfg(any(
    feature = "adyen",
    feature = "braintree",
    feature = "klarna",
    feature = "paypal"
))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct ExponentEntry {
    /// The currency code, as the processor lists it (uppercase).
    pub code: &'static str,
    /// The exponent (number of decimals) the processor's API uses.
    pub exponent: u8,
}

/// The largest integer amount a processor is sent, 2^53 − 1: ducat's safe integers, since the
/// APIs take JSON numbers.
pub const MAX_INTEGER_AMOUNT: i64 = (1 << 53) - 1;

/// Which signs a processor field takes, checked after rounding.
#[derive(Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // each processor uses some of them
enum Sign {
    /// Negative amounts are documented (Klarna's discount lines).
    Any,
    /// Zero is documented but negatives aren't: refunds are sent as positive amounts.
    NonNegative,
    /// The processor refuses zero too (Braintree).
    Positive,
}

/// The entry of a table sorted by code for `code`, read case-insensitively unless `exact_case`.
fn lookup<'t, T>(
    table: &'t [T],
    code: &str,
    exact_case: bool,
    key: impl Fn(&T) -> &str,
) -> Option<&'t T> {
    let upper = code.to_ascii_uppercase();
    let wanted = if exact_case { code } else { upper.as_str() };
    table
        .binary_search_by(|entry| key(entry).cmp(wanted))
        .ok()
        .map(|index| &table[index])
}

/// The amount's units at the processor's exponent, then a multiple of `multiple`, rounding once
/// at each step with `rounding` ([`Rounding::Unnecessary`] refuses).
fn rescale(amount: &Amount, exponent: u8, multiple: u64, rounding: Rounding) -> Result<Int, Error> {
    let exponent = u16::from(exponent);
    let units = if exponent >= amount.scale {
        amount.units.mul_pow10(u32::from(exponent - amount.scale))
    } else {
        rescale_ratio(
            &amount.units,
            &Int::ONE,
            &Int::ONE,
            0,
            u32::from(amount.scale - exponent),
            rounding,
        )?
    };
    if multiple == 1 {
        return Ok(units);
    }
    let step = Int::from(multiple);
    if units.div_rem(&step).1.is_zero() {
        return Ok(units);
    }
    Ok(rescale_ratio(&units, &Int::ONE, &step, 0, 0, rounding)? * step)
}

fn check_sign(units: &Int, sign: Sign) -> Result<(), Error> {
    if sign != Sign::Any && units.is_negative() {
        return Err(Error::NegativeAmount);
    }
    if sign == Sign::Positive && units.is_zero() {
        return Err(Error::ZeroAmount);
    }
    Ok(())
}

/// The processor's integer amount: `amount` at `exponent`, a multiple of `multiple`.
#[allow(dead_code)] // the decimal-string processors don't use it
fn to_integer(
    amount: &Amount,
    exponent: u8,
    multiple: u64,
    rounding: Rounding,
    sign: Sign,
) -> Result<i64, Error> {
    let units = rescale(amount, exponent, multiple, rounding)?;
    let value = units
        .to_i64()
        .filter(|value| value.unsigned_abs() <= MAX_INTEGER_AMOUNT.unsigned_abs())
        .ok_or(Error::AmountTooLarge)?;
    check_sign(&units, sign)?;
    Ok(value)
}

/// The processor's decimal string: `amount` at `exponent`, with exactly that many decimals.
#[allow(dead_code)] // the integer processors don't use it
fn to_decimal(
    amount: &Amount,
    exponent: u8,
    rounding: Rounding,
    sign: Sign,
) -> Result<alloc::string::String, Error> {
    let units = rescale(amount, exponent, 1, rounding)?;
    check_sign(&units, sign)?;
    let mut text = alloc::string::String::new();
    // writing to a String can't fail
    let _ = crate::decimal::write_scaled(&mut text, &units, u16::from(exponent));
    Ok(text)
}

/// `units × 10^−scale` at the currency's exponent when that is exact, else at `scale`.
fn at_iso_scale_when_exact(units: Int, scale: u16, currency: CurrencyCode) -> Amount {
    let exponent = u16::from(currency.exponent());
    let amount = Amount { units, scale };
    if exponent >= scale {
        return Amount {
            units: amount.units.mul_pow10(u32::from(exponent - scale)),
            scale: exponent,
        };
    }
    amount
        .rescale(exponent, Rounding::Unnecessary)
        .unwrap_or(amount)
}

/// A processor's integer amount at `exponent`, back as an amount of `currency`.
#[allow(dead_code)] // the decimal-string processors don't use it
fn from_integer(value: i64, exponent: u8, currency: CurrencyCode) -> Amount {
    at_iso_scale_when_exact(Int::from(value), u16::from(exponent), currency)
}

/// A decimal string's digits and scale, the string already checked against the processor's
/// format: an optional minus sign, digits, and a point with digits (the whole part may be empty).
#[allow(dead_code)] // the integer processors don't use it
fn from_decimal(text: &str, currency: CurrencyCode) -> Result<Amount, Error> {
    let (negative, digits) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let (whole, fraction) = digits.split_once('.').unwrap_or((digits, ""));
    let joined = alloc::format!("{}{whole}{fraction}", if negative { "-" } else { "" });
    let units: Int = if whole.is_empty() && fraction.is_empty() {
        return Err(Error::Syntax);
    } else {
        joined.parse()?
    };
    let scale = u16::try_from(fraction.len()).map_err(|_| Error::Syntax)?;
    Ok(at_iso_scale_when_exact(
        units,
        crate::amount::check_scale(scale)?,
        currency,
    ))
}

/// Whether `text` is ASCII digits, at least one.
#[allow(dead_code)] // the integer processors don't use it
fn all_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}
