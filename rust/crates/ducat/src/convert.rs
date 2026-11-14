//! Exchange rates: exact rational rates pinned to a currency pair, their inverses and chains, and
//! conversions that round once.
//!
//! ```
//! use ducat::convert::Rate;
//! use ducat::iso::{Eur, Jpy, Usd};
//! use ducat::{Money, Rounding};
//!
//! let eur_usd: Rate<Eur, Usd> = Rate::parse("1.1165")?;
//! assert_eq!(eur_usd.inverse().to_string(), "2000/2233");
//! let euros: Money<Eur> = "100".parse()?;
//! assert_eq!(eur_usd.convert(&euros, Rounding::HalfEven)?.to_string(), "111.65 USD");
//!
//! let usd_jpy = eur_usd.inverse().and_then(&Rate::<Eur, Jpy>::parse("162.457")?);
//! let dollars: Money<Usd> = "111.65".parse()?;
//! let detailed = usd_jpy.convert_detailed(&dollars, Rounding::HalfEven)?;
//! assert_eq!(detailed.value.to_string(), "16246 JPY");
//! # Ok::<(), ducat::Error>(())
//! ```

use alloc::string::String;
use core::fmt;
use core::marker::PhantomData;

use crate::exact::{AnyExactMoney, ExactMoney, Rounded};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Factor, Int, Money, Ratio, Rounding};

/// The rate as text: the digits it was given, or its exact decimal when that terminates, or
/// `num/den`.
fn rate_text(f: &mut fmt::Formatter<'_>, ratio: &Ratio, given: Option<&str>) -> fmt::Result {
    if let Some(given) = given {
        return f.write_str(given);
    }
    match ratio.terminating_scale(0) {
        Some(scale) => {
            let units = ratio
                .round_to_units(scale, Rounding::Unnecessary)
                .map_err(|_| fmt::Error)?;
            let amount = crate::amount::Amount { units, scale };
            amount.write(f)
        }
        None => write!(f, "{ratio}"),
    }
}

fn positive(rate: Ratio) -> Result<Ratio, Error> {
    if rate.numer().is_positive() {
        Ok(rate)
    } else {
        Err(Error::NonPositiveRate)
    }
}

/// A decimal rate's text as given, when it is a plain decimal (not a fraction).
fn given_digits(text: &str) -> Option<String> {
    (!text.contains('/') && !text.contains(['e', 'E'])).then(|| text.trim_start_matches('+').into())
}

/// The rate rounded once to `places` decimals.
fn rounded(ratio: &Ratio, places: u16, rounding: Rounding) -> Result<(Ratio, String), Error> {
    let units = ratio.round_to_units(places, rounding)?;
    let amount = crate::amount::Amount {
        units: units.clone(),
        scale: crate::amount::check_scale(places)?,
    };
    let mut text = String::new();
    let _ = amount.write(&mut text);
    Ok((
        Ratio::new(units, Int::ONE.mul_pow10(u32::from(places)))?,
        text,
    ))
}

/// An exact exchange rate: one unit of `F` is worth `ratio` units of `T`.
///
/// Inverses and chains are exact; nothing is rounded until an amount is converted, once.
pub struct Rate<F: Currency, T: Currency> {
    ratio: Ratio,
    given: Option<String>,
    pair: PhantomData<(F, T)>,
}

impl<F: Currency, T: Currency> Clone for Rate<F, T> {
    fn clone(&self) -> Self {
        Self {
            ratio: self.ratio.clone(),
            given: self.given.clone(),
            pair: PhantomData,
        }
    }
}

impl<F: Currency, T: Currency> PartialEq for Rate<F, T> {
    /// By value: `"1.10"` equals `"1.1"`.
    fn eq(&self, other: &Self) -> bool {
        self.ratio == other.ratio
    }
}

impl<F: Currency, T: Currency> Eq for Rate<F, T> {}

impl<F: Currency, T: Currency> Rate<F, T> {
    const fn of(ratio: Ratio, given: Option<String>) -> Self {
        Self {
            ratio,
            given,
            pair: PhantomData,
        }
    }

    /// The rate `rate`, exactly.
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] unless it is positive, and whatever reading it fails with.
    pub fn new(rate: impl Factor) -> Result<Self, Error> {
        Ok(Self::of(positive(rate.to_ratio()?)?, None))
    }

    /// A rate from text (`"1.1165"`, `"2000/2233"`), keeping the digits it was given for
    /// display: `"136.80"` prints as `136.80`.
    ///
    /// # Errors
    ///
    /// As [`Rate::new`].
    pub fn parse(text: &str) -> Result<Self, Error> {
        Ok(Self::of(positive(text.parse()?)?, given_digits(text)))
    }

    /// The exact rate that took `presented` to `settled`: `settled ÷ presented`, to audit what a
    /// processor applied.
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] when the quotient isn't positive (a zero or negative amount).
    pub fn implied(presented: &Money<F>, settled: &Money<T>) -> Result<Self, Error> {
        let quotient = settled
            .exact()
            .value()
            .div(presented.exact().value())
            .map_err(|_| Error::NonPositiveRate)?;
        Ok(Self::of(positive(quotient)?, None))
    }

    /// The exact rate.
    #[must_use]
    pub const fn ratio(&self) -> &Ratio {
        &self.ratio
    }

    /// The source currency.
    #[must_use]
    pub const fn from(&self) -> CurrencyCode {
        F::CODE
    }

    /// The target currency.
    #[must_use]
    pub const fn to(&self) -> CurrencyCode {
        T::CODE
    }

    /// The exact reciprocal.
    #[must_use]
    pub fn inverse(&self) -> Rate<T, F> {
        // a positive ratio always has a reciprocal
        Rate::of(self.ratio.recip().unwrap_or(Ratio::ONE), None)
    }

    /// The exact composite of this rate and `next`: `F` → `T` → `N`. Nothing is rounded.
    #[must_use]
    pub fn and_then<N: Currency>(&self, next: &Rate<T, N>) -> Rate<F, N> {
        Rate::of(self.ratio.mul(&next.ratio), None)
    }

    /// This rate × (1 + `margin`), exactly: `with_margin("-0.02")` gives 2% less `T` per `F`.
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] when the result isn't positive; whatever reading `margin`
    /// fails with.
    pub fn with_margin(&self, margin: impl Factor) -> Result<Self, Error> {
        let factor = Ratio::ONE.add(&margin.to_ratio()?);
        Ok(Self::of(positive(self.ratio.mul(&factor))?, None))
    }

    /// A new rate rounded once to `places` decimals, for quoting rounded rates.
    ///
    /// # Errors
    ///
    /// [`Error::NonPositiveRate`] when it rounds to zero; [`Error::Rounding`] with
    /// [`Rounding::Unnecessary`] when inexact; [`Error::InvalidScale`].
    pub fn round(&self, places: u16, rounding: Rounding) -> Result<Self, Error> {
        let (ratio, text) = rounded(&self.ratio, places, rounding)?;
        Ok(Self::of(positive(ratio)?, Some(text)))
    }

    /// The rate with exactly `places` decimals, for display; the rate itself keeps every digit.
    ///
    /// # Errors
    ///
    /// As [`Rate::round`], except that a rate rounding to zero is fine here.
    pub fn to_decimal(&self, places: u16, rounding: Rounding) -> Result<String, Error> {
        Ok(rounded(&self.ratio, places, rounding)?.1)
    }

    /// Converts `money`, rounding once to `T`'s exponent.
    ///
    /// # Errors
    ///
    /// [`Error::Rounding`] with [`Rounding::Unnecessary`] when inexact.
    pub fn convert(&self, money: &Money<F>, rounding: Rounding) -> Result<Money<T>, Error> {
        money.convert(&self.ratio, rounding)
    }

    /// Converts as [`Rate::convert`] does, and returns what rounding left out: `value +
    /// residual` is exactly `money × rate`.
    ///
    /// # Errors
    ///
    /// As [`Rate::convert`].
    pub fn convert_detailed(
        &self,
        money: &Money<F>,
        rounding: Rounding,
    ) -> Result<Rounded<Money<T>, ExactMoney<T>>, Error> {
        self.convert_exact(&money.exact())
            .round_with_residual(rounding, None)
    }

    /// Converts an exact amount, rounding nothing.
    #[must_use]
    pub fn convert_exact(&self, exact: &ExactMoney<F>) -> ExactMoney<T> {
        ExactMoney::of(exact.value().mul(&self.ratio))
    }

    /// The same rate with run-time currencies.
    #[must_use]
    pub fn to_any(&self) -> AnyRate {
        AnyRate {
            from: F::CODE,
            to: T::CODE,
            ratio: self.ratio.clone(),
            given: self.given.clone(),
        }
    }
}

impl<F: Currency, T: Currency> fmt::Display for Rate<F, T> {
    /// The exact rate: the digits it was given (`136.80`), its decimal when that terminates,
    /// or `num/den` (`2000/2233`).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        rate_text(f, &self.ratio, self.given.as_deref())
    }
}

impl<F: Currency, T: Currency> fmt::Debug for Rate<F, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Rate({} → {}: {self})", F::CODE, T::CODE)
    }
}

/// An exchange rate between currencies known only at run time: as [`Rate`], with
/// [`Error::CurrencyMismatch`] for an amount or a next rate in the wrong currency.
#[derive(Clone)]
pub struct AnyRate {
    from: CurrencyCode,
    to: CurrencyCode,
    ratio: Ratio,
    given: Option<String>,
}

impl PartialEq for AnyRate {
    /// The same pair and the same value.
    fn eq(&self, other: &Self) -> bool {
        self.from == other.from && self.to == other.to && self.ratio == other.ratio
    }
}

impl Eq for AnyRate {}

impl AnyRate {
    /// The rate `rate` from `from` to `to`, exactly.
    ///
    /// # Errors
    ///
    /// As [`Rate::new`].
    pub fn new(from: CurrencyCode, to: CurrencyCode, rate: impl Factor) -> Result<Self, Error> {
        Ok(Self {
            from,
            to,
            ratio: positive(rate.to_ratio()?)?,
            given: None,
        })
    }

    /// As [`Rate::parse`].
    ///
    /// # Errors
    ///
    /// As [`Rate::new`].
    pub fn parse(from: CurrencyCode, to: CurrencyCode, text: &str) -> Result<Self, Error> {
        Ok(Self {
            from,
            to,
            ratio: positive(text.parse()?)?,
            given: given_digits(text),
        })
    }

    /// The exact rate.
    #[must_use]
    pub const fn ratio(&self) -> &Ratio {
        &self.ratio
    }

    /// The source currency.
    #[must_use]
    pub const fn from(&self) -> CurrencyCode {
        self.from
    }

    /// The target currency.
    #[must_use]
    pub const fn to(&self) -> CurrencyCode {
        self.to
    }

    /// The exact reciprocal.
    #[must_use]
    pub fn inverse(&self) -> Self {
        Self {
            from: self.to,
            to: self.from,
            ratio: self.ratio.recip().unwrap_or(Ratio::ONE),
            given: None,
        }
    }

    /// The exact composite of this rate and `next`.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] when `next` isn't from this rate's target.
    pub fn and_then(&self, next: &Self) -> Result<Self, Error> {
        if next.from != self.to {
            return Err(Error::CurrencyMismatch {
                expected: self.to,
                actual: next.from,
            });
        }
        Ok(Self {
            from: self.from,
            to: next.to,
            ratio: self.ratio.mul(&next.ratio),
            given: None,
        })
    }

    /// As [`Rate::with_margin`].
    ///
    /// # Errors
    ///
    /// As [`Rate::with_margin`].
    pub fn with_margin(&self, margin: impl Factor) -> Result<Self, Error> {
        let factor = Ratio::ONE.add(&margin.to_ratio()?);
        Ok(Self {
            ratio: positive(self.ratio.mul(&factor))?,
            given: None,
            ..self.clone()
        })
    }

    /// As [`Rate::round`].
    ///
    /// # Errors
    ///
    /// As [`Rate::round`].
    pub fn round(&self, places: u16, rounding: Rounding) -> Result<Self, Error> {
        let (ratio, text) = rounded(&self.ratio, places, rounding)?;
        Ok(Self {
            ratio: positive(ratio)?,
            given: Some(text),
            ..self.clone()
        })
    }

    /// As [`Rate::to_decimal`].
    ///
    /// # Errors
    ///
    /// As [`Rate::to_decimal`].
    pub fn to_decimal(&self, places: u16, rounding: Rounding) -> Result<String, Error> {
        Ok(rounded(&self.ratio, places, rounding)?.1)
    }

    fn check(&self, currency: CurrencyCode) -> Result<(), Error> {
        if currency == self.from {
            Ok(())
        } else {
            Err(Error::CurrencyMismatch {
                expected: self.from,
                actual: currency,
            })
        }
    }

    /// Converts `money`, rounding once to the target's exponent.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for money in another currency; otherwise as [`Rate::convert`].
    pub fn convert(&self, money: &AnyMoney, rounding: Rounding) -> Result<AnyMoney, Error> {
        self.check(money.currency())?;
        money.convert(self.to, &self.ratio, rounding)
    }

    /// As [`Rate::convert_detailed`].
    ///
    /// # Errors
    ///
    /// As [`AnyRate::convert`].
    pub fn convert_detailed(
        &self,
        money: &AnyMoney,
        rounding: Rounding,
    ) -> Result<Rounded<AnyMoney, AnyExactMoney>, Error> {
        self.convert_exact(&money.exact())?
            .round_with_residual(rounding, None)
    }

    /// Converts an exact amount, rounding nothing.
    ///
    /// # Errors
    ///
    /// [`Error::CurrencyMismatch`] for an amount in another currency.
    pub fn convert_exact(&self, exact: &AnyExactMoney) -> Result<AnyExactMoney, Error> {
        self.check(exact.currency())?;
        Ok(AnyExactMoney::of(exact.value().mul(&self.ratio), self.to))
    }
}

impl fmt::Display for AnyRate {
    /// As [`Rate`]'s.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        rate_text(f, &self.ratio, self.given.as_deref())
    }
}

impl fmt::Debug for AnyRate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "AnyRate({} → {}: {self})", self.from, self.to)
    }
}

impl<F: Currency, T: Currency> From<Rate<F, T>> for AnyRate {
    fn from(rate: Rate<F, T>) -> Self {
        rate.to_any()
    }
}
