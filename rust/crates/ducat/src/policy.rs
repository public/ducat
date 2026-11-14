//! Rounding policies: a scale, an increment and a mode as one value, accepted wherever a rounding
//! mode is ("CHF cash", "4 decimals, half even").
//!
//! Every operation that takes a [`RoundingInput`](crate::RoundingInput) takes a policy too, by
//! value or by reference: the result is rounded once, straight to the policy's scale and
//! increment, never twice through the amount's own scale. Policies are passed explicitly, never
//! stored on amounts or set globally.
//!
//! ```
//! use ducat::{Money, Rounding};
//! use ducat::iso::{Chf, Eur};
//! use ducat::policy::RoundingPolicy;
//!
//! let unit_price = RoundingPolicy::new(Rounding::HalfEven).with_scale(4)?;
//! let ten: Money<Eur> = "10.00".parse()?;
//! assert_eq!(ten.divide(3, unit_price)?.to_string(), "3.3333 EUR");
//!
//! let down_to_hundreds = RoundingPolicy::new(Rounding::Floor).with_scale(0)?.with_increment(100)?;
//! let amount: Money<Chf> = "12345.60".parse()?;
//! assert_eq!(amount.round(down_to_hundreds)?.to_string(), "12300 CHF");
//! # Ok::<(), ducat::Error>(())
//! ```

use crate::amount::{Amount, check_scale};
use crate::{AnyMoney, Currency, CurrencyCode, Error, Int, Money, Rounding};

/// The largest increment a policy takes, as ducat's positive safe integers: 2^53 − 1.
pub const MAX_INCREMENT: u64 = (1 << 53) - 1;

/// A rounding policy: a scale (or the currency's exponent), an increment of 10^−scale units, a
/// mode, and optionally the one currency it is for (ducat's `roundingPolicy`).
///
/// A policy rounds an exact value once, to the nearest multiple of `increment × 10^−scale` by its
/// mode. Applying it to an amount in another currency than its own is
/// [`Error::CurrencyMismatch`]. The checks happen when it is built, so applying it needs none.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct RoundingPolicy {
    scale: Option<u16>,
    increment: u64,
    mode: Rounding,
    currency: Option<CurrencyCode>,
}

impl Default for RoundingPolicy {
    /// [`RoundingPolicy::ISO`].
    fn default() -> Self {
        Self::ISO
    }
}

impl RoundingPolicy {
    /// The currency's exponent, half up (ducat's `isoPolicy`): the policy most amounts should end
    /// with.
    pub const ISO: Self = Self::new(Rounding::HalfExpand);

    /// Rounding with `mode` to the currency's exponent, in steps of one unit, for any currency.
    #[must_use]
    pub const fn new(mode: Rounding) -> Self {
        Self {
            scale: None,
            increment: 1,
            mode,
            currency: None,
        }
    }

    /// The same policy at `scale` decimal places instead of the currency's exponent.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidScale`] for a scale beyond [`MAX_SCALE`](crate::MAX_SCALE).
    pub const fn with_scale(self, scale: u16) -> Result<Self, Error> {
        match check_scale(scale) {
            Ok(scale) => Ok(Self {
                scale: Some(scale),
                ..self
            }),
            Err(error) => Err(error),
        }
    }

    /// The same policy rounding to multiples of `increment` units of 10^−scale (5 for 0.05 at
    /// scale 2).
    ///
    /// # Errors
    ///
    /// [`Error::InvalidIncrement`] for an increment of 0 or beyond [`MAX_INCREMENT`].
    pub const fn with_increment(self, increment: u64) -> Result<Self, Error> {
        if increment == 0 || increment > MAX_INCREMENT {
            return Err(Error::InvalidIncrement);
        }
        Ok(Self { increment, ..self })
    }

    /// The same policy with another mode.
    #[must_use]
    pub const fn with_mode(self, mode: Rounding) -> Self {
        Self { mode, ..self }
    }

    /// The same policy restricted to `currency`: applying it to another one is
    /// [`Error::CurrencyMismatch`].
    #[must_use]
    pub const fn for_currency(self, currency: CurrencyCode) -> Self {
        Self {
            currency: Some(currency),
            ..self
        }
    }

    /// The scale, or `None` for the currency's exponent.
    #[must_use]
    pub const fn scale(&self) -> Option<u16> {
        self.scale
    }

    /// The increment, in units of 10^−scale.
    #[must_use]
    pub const fn increment(&self) -> u64 {
        self.increment
    }

    /// The rounding mode.
    #[must_use]
    pub const fn mode(&self) -> Rounding {
        self.mode
    }

    /// The one currency the policy is for, if any.
    #[must_use]
    pub const fn currency(&self) -> Option<CurrencyCode> {
        self.currency
    }

    /// The scale the policy rounds an amount of `currency` to, checking its currency.
    pub(crate) fn scale_for(&self, currency: CurrencyCode) -> Result<u16, Error> {
        if let Some(expected) = self.currency {
            if expected != currency {
                return Err(Error::CurrencyMismatch {
                    expected,
                    actual: currency,
                });
            }
        }
        Ok(self.scale.unwrap_or_else(|| u16::from(currency.exponent())))
    }

    /// `amount × num / den` (`den` positive, not necessarily reduced) in `currency`, rounded once
    /// by the policy: count whole increments (`amount × num / (den × increment)`, rounded at the
    /// policy's scale) and multiply back, which is rounding to the nearest multiple of the
    /// increment.
    pub(crate) fn round_product(
        &self,
        amount: &Amount,
        num: &Int,
        den: &Int,
        currency: CurrencyCode,
    ) -> Result<Amount, Error> {
        let scale = self.scale_for(currency)?;
        if self.increment == 1 {
            return amount.round_parts(num, den, scale, self.mode);
        }
        let increment = Int::from(self.increment);
        let steps = amount.round_parts(num, &(den * &increment), scale, self.mode)?;
        Ok(Amount {
            units: steps.units * increment,
            scale,
        })
    }

    /// Whether `amount` in `currency` is exactly what the policy produces (ducat's
    /// `assertScale`).
    fn check(&self, amount: &Amount, currency: CurrencyCode) -> Result<(), Error> {
        let scale = self.scale_for(currency)?;
        let on_increment = amount.units.div_rem(&Int::from(self.increment)).1.is_zero();
        if amount.scale == scale && on_increment {
            Ok(())
        } else {
            Err(Error::OffPolicy)
        }
    }
}

impl<C: Currency> Money<C> {
    /// Checks that the amount is exactly what `policy` produces, before it is booked or sent to a
    /// processor, say (ducat's `assertScale`): at the policy's scale and a whole number of its
    /// increments.
    ///
    /// ```
    /// use ducat::Money;
    /// use ducat::iso::Eur;
    /// use ducat::policy::RoundingPolicy;
    ///
    /// let precise = Money::<Eur>::from_units(1234, 3)?;
    /// assert!(precise.check_policy(&RoundingPolicy::ISO).is_err());
    /// assert!(precise.round(RoundingPolicy::ISO)?.check_policy(&RoundingPolicy::ISO).is_ok());
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::OffPolicy`] for another scale or an amount off the increment;
    /// [`Error::CurrencyMismatch`] when the policy is for another currency.
    pub fn check_policy(&self, policy: &RoundingPolicy) -> Result<(), Error> {
        policy.check(&self.amount, C::CODE)
    }
}

impl AnyMoney {
    /// As [`Money::check_policy`].
    ///
    /// # Errors
    ///
    /// As [`Money::check_policy`].
    pub fn check_policy(&self, policy: &RoundingPolicy) -> Result<(), Error> {
        policy.check(&self.amount, self.currency())
    }
}
