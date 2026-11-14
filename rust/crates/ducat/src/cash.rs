//! Cash rounding: rounding to a multiple of an increment, such as CHF 0.05.

use crate::amount::Amount;
use crate::rounding::{Rounding, rescale_ratio};
use crate::{AnyMoney, Currency, Error, Int, Money};

impl Amount {
    pub(crate) fn round_to_increment(
        &self,
        increment: &Self,
        rounding: Rounding,
    ) -> Result<Self, Error> {
        if !increment.units.is_positive() {
            return Err(Error::NotPositive);
        }
        let scale = self.scale.max(increment.scale);
        let value = self.rescale(scale, Rounding::Unnecessary)?.units;
        let step = increment.rescale(scale, Rounding::Unnecessary)?.units;
        let steps = rescale_ratio(&value, &Int::ONE, &step, 0, 0, rounding)?;
        Ok(Self {
            units: steps * &step,
            scale,
        })
    }
}

impl<C: Currency> Money<C> {
    /// The nearest multiple of `increment` by `rounding`, at the larger of the two scales: cash
    /// rounding, such as CHF 10.03 to 10.05 with an increment of 0.05.
    ///
    /// ```
    /// use ducat::{Money, Rounding};
    /// use ducat::iso::Chf;
    ///
    /// let price: Money<Chf> = "10.03".parse()?;
    /// let rounded = price.round_to_increment(&"0.05".parse()?, Rounding::HalfExpand)?;
    /// assert_eq!(rounded.to_string(), "10.05 CHF");
    /// # Ok::<(), ducat::Error>(())
    /// ```
    ///
    /// # Errors
    ///
    /// [`Error::NotPositive`] for an increment that isn't positive; [`Error::Rounding`] with
    /// [`Rounding::Unnecessary`] when the amount isn't a multiple.
    pub fn round_to_increment(&self, increment: &Self, rounding: Rounding) -> Result<Self, Error> {
        Ok(Self::from_amount(
            self.amount
                .round_to_increment(&increment.amount, rounding)?,
        ))
    }
}

impl AnyMoney {
    /// As [`Money::round_to_increment`].
    ///
    /// # Errors
    ///
    /// As [`Money::round_to_increment`], and [`Error::CurrencyMismatch`] for an increment in
    /// another currency.
    pub fn round_to_increment(&self, increment: &Self, rounding: Rounding) -> Result<Self, Error> {
        let increment = self.amount_in(increment)?;
        Ok(Self::from_parts(
            self.amount.round_to_increment(increment, rounding)?,
            self.currency(),
        ))
    }
}
